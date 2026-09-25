"""
FastAPI dependencies: authentication, role checks, Mongo access, audit log.

require_role() is the actual access-control mechanism used by every router --
most importantly on the ruling endpoint, where require_role(SystemRole.JUDGE)
makes "only a judge can enter a ruling" a runtime-enforced fact.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.base import get_db
from app.db.mongo_repository import get_mongo_db, mongo_probe
from app.db.postgres_repository import AuditRepository, UserRepository, as_uuid
from app.models.auth_models import SystemRole, UserAccount

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

STAFF = (SystemRole.JUDGE, SystemRole.PROSECUTOR, SystemRole.CLERK, SystemRole.CASE_OFFICER, SystemRole.ADMIN)
CASE_BUILDERS = (SystemRole.CASE_OFFICER, SystemRole.CLERK, SystemRole.ADMIN)
CASE_EDITORS = (SystemRole.CASE_OFFICER, SystemRole.CLERK, SystemRole.ADMIN, SystemRole.JUDGE)
EVIDENCE_SUBMITTERS = (SystemRole.CASE_OFFICER, SystemRole.CLERK, SystemRole.PROSECUTOR, SystemRole.ADMIN)
COURTROOM_STAFF = (SystemRole.CLERK, SystemRole.JUDGE)
SCHEDULERS = (SystemRole.CLERK, SystemRole.CASE_OFFICER, SystemRole.JUDGE, SystemRole.ADMIN)
LIBRARIANS = (SystemRole.CLERK, SystemRole.CASE_OFFICER, SystemRole.PROSECUTOR, SystemRole.JUDGE, SystemRole.ADMIN)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> UserAccount:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Your session has expired. Please sign in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
    except JWTError:
        raise credentials_error

    user_id = as_uuid(payload.get("sub"))
    if user_id is None:
        raise credentials_error
    repo = UserRepository(db)
    user = repo.get(user_id)
    if user is None or not user.is_active:
        raise credentials_error

    # Tokens issued before the latest password change are no longer valid.
    changed = repo.password_changed_at(user_id)
    issued_at = payload.get("iat")
    if changed is not None and issued_at is not None and int(issued_at) < int(changed.timestamp()) - 1:
        raise credentials_error
    return user


def require_role(*allowed_roles: SystemRole):
    def _check(user: UserAccount = Depends(get_current_user)) -> UserAccount:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of these roles: {', '.join(r.value for r in allowed_roles)}.",
            )
        return user
    return _check


def get_mongo():
    """Mongo database handle, or a clear 503 when Mongo is unreachable."""
    if not mongo_probe.available():
        raise HTTPException(
            status_code=503,
            detail="The courtroom record store (MongoDB) is temporarily unavailable. Please retry in a moment.",
        )
    return get_mongo_db()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def audit(db: Session, request: Request | None, user: UserAccount | None, action: str,
          entity_type: str | None = None, entity_id: Any = None, detail: dict | None = None) -> None:
    AuditRepository(db).record(
        action=action, user=user, entity_type=entity_type, entity_id=entity_id, detail=detail,
        ip=client_ip(request) if request is not None else None,
    )


def parse_uuid_or_404(value: str, what: str = "Record"):
    parsed = as_uuid(value)
    if parsed is None:
        raise HTTPException(status_code=404, detail=f"{what} not found.")
    return parsed
