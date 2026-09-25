"""
LexIntel -- FastAPI entrypoint.

Run locally with:
    uvicorn app.main:app --reload --port 8005
"""

from __future__ import annotations

import logging
import threading
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.api.auth_routes import router as auth_router
from app.api.routes import router
from app.core import messages
from app.core.config import get_settings
from app.db.base import init_db, postgres_probe

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("lexintel")
# Dependency clients log full tracebacks for every refused connection; the
# resilience probes already report outages in one line.
for noisy in ("elastic_transport", "elasticsearch", "neo4j", "urllib3"):
    logging.getLogger(noisy).setLevel(logging.ERROR)
settings = get_settings()

app = FastAPI(
    title="LexIntel",
    description=(
        "Decision-support platform for courts, prosecutors, and lawyers. "
        "Organizes cases, evidence, and research -- humans decide outcomes."
    ),
    version="1.0.0",
)

class _GZipExceptStreams(GZipMiddleware):
    """Drafts stream token by token as server-sent events; gzip would hold them back."""

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path", "").endswith("/stream"):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


app.add_middleware(_GZipExceptStreams, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Request-ID"],
)


@app.middleware("http")
async def request_id_and_security_headers(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


def _error(status: int, detail, request: Request, headers: dict | None = None) -> JSONResponse:
    """Every error leaves through here, so it is also where the message is put
    into the reader's language (app/core/messages.py)."""
    lang = messages.language_of(request.headers.get("accept-language"))
    return JSONResponse(status_code=status, headers=headers, content={
        "detail": messages.translate(detail, lang),
        "request_id": getattr(request.state, "request_id", None),
    })


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    # Registered explicitly: Starlette's own handler would answer first and
    # would neither translate the message nor include the request id.
    return _error(exc.status_code, exc.detail, request, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    lang = messages.language_of(request.headers.get("accept-language"))
    parts = []
    for err in exc.errors():
        field = ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query", "path", "form"))
        msg = err.get("msg", "Invalid value").removeprefix("Value error, ")
        # Translate the sentence on its own: with the field name glued on the
        # front it would never match an entry in the table.
        msg = messages.translate(msg, lang)
        parts.append(f"{field}: {msg}" if field else msg)
    joined = "; ".join(parts) or messages.translate("Invalid request.", lang)
    return JSONResponse(status_code=422, content={"detail": joined,
                                                  "errors": jsonable_errors(exc)})


def jsonable_errors(exc: RequestValidationError) -> list[dict]:
    return [{"loc": list(e.get("loc", [])), "msg": str(e.get("msg", ""))} for e in exc.errors()]


@app.exception_handler(OperationalError)
async def database_unavailable(request: Request, exc: OperationalError):
    postgres_probe.mark_down(exc)
    log.error("database unavailable: %s", exc)
    return _error(503, "The database is temporarily unavailable. Please retry in a moment.", request)


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, exc: SQLAlchemyError):
    log.exception("database error", exc_info=exc)
    return _error(500, "A database error occurred. The request was not saved.", request)


@app.exception_handler(ValueError)
async def bad_value(request: Request, exc: ValueError):
    # PostgreSQL text can't hold a NUL byte, and the driver reports that as a
    # bare ValueError from whichever endpoint stored the text. It is a
    # problem with what was sent, not a fault on our side, so it is a 422 for
    # every endpoint at once rather than a 500 for each.
    if "NUL" in str(exc):
        return _error(422, "The text contains a character that can't be stored.", request)
    return await unhandled(request, exc)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return _error(exc.status_code, exc.detail, request)
    log.exception("unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return _error(500, "Something went wrong on our side. The error has been logged.", request)


app.include_router(auth_router, prefix="/api/v1")
app.include_router(router, prefix="/api/v1")


def _warm_up() -> None:
    """Create search indices and load the meaning model in the background, so startup
    never waits on them and the first request doesn't pay a cold model load. (The model
    unloads again after `model_idle_unload_seconds` if nobody uses it.)"""
    try:
        from app.db import search

        search.ensure_indices()
    except Exception:
        log.exception("search warm-up failed")
    try:
        from app.ai import embeddings

        embeddings.warm_in_background()
    except Exception:
        log.exception("embedding warm-up failed")


def _init_db_until_ready() -> None:
    import time

    delay = 3
    while True:
        try:
            init_db()
            log.info("database ready")
            return
        except Exception as exc:
            log.warning("database initialisation failed (%s); retrying in %ss", type(exc).__name__, delay)
            time.sleep(delay)
            delay = min(delay * 2, 60)


@app.on_event("startup")
def on_startup() -> None:
    # The API starts even if Postgres isn't up yet: requests get a clear 503
    # and initialisation keeps retrying in the background.
    try:
        init_db()
    except Exception:
        log.exception("database initialisation failed at startup; retrying in background")
        threading.Thread(target=_init_db_until_ready, daemon=True).start()
    threading.Thread(target=_warm_up, daemon=True).start()


@app.get("/health")
def health():
    return {"status": "ok" if postgres_probe.available() else "degraded", "app": settings.app_name,
            "environment": settings.environment}
