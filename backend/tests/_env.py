"""
Test environment. Import this FIRST in every test script, before any `app`
import: it points Postgres and Mongo at separate *_test databases (created if
missing), sends uploads and the law index to /tmp, and switches off the
optional services so tests exercise the documented fallbacks deterministically.

Safety: `assert_test_database()` refuses to run destructive setup against any
database whose name doesn't end in "_test". A test once truncated the real
development database; this makes that impossible.
"""
from __future__ import annotations

import os
import sys
from urllib.parse import urlparse, urlunparse

sys.path.insert(0, ".")

_base_pg = os.environ.get("POSTGRES_URL", "postgresql://lexintel:lexintel@postgres:5432/lexintel")
_parsed = urlparse(_base_pg)
TEST_PG_URL = urlunparse(_parsed._replace(path="/lexintel_test"))
_mongo = urlparse(os.environ.get("MONGO_URL", "mongodb://mongo:27017/lexintel"))
TEST_MONGO_URL = urlunparse(_mongo._replace(path="/lexintel_test"))

os.environ.update({
    "POSTGRES_URL": TEST_PG_URL,
    "MONGO_URL": TEST_MONGO_URL,
    "UPLOAD_DIR": "/tmp/lexintel-test-uploads",
    "FAISS_INDEX_PATH": "/tmp/lexintel-test-faiss",
    "ELASTICSEARCH_ENABLED": "false",
    "NEO4J_ENABLED": "false",
    "CELERY_ENABLED": "false",
    "WHISPER_ENABLED": "false",
    # The writing model is off so results are deterministic; the small task
    # models (embeddings) stay on. tests/test_ai_live.py covers drafting.
    "LLM_PROVIDER": "none",
    "PUBLIC_COMPLAINTS_PER_HOUR": "1000",
})
# Borrow the running API's embedding model (same code, same vectors) instead of
# loading another ~500 MB copy; falls back to a local copy if the API is down.
os.environ.setdefault("EMBEDDINGS_URL", "http://localhost:8005/api/v1/internal/embed")


def _ensure_database() -> None:
    import psycopg2

    admin = psycopg2.connect(_base_pg.replace("postgresql+psycopg2://", "postgresql://"))
    admin.autocommit = True
    with admin.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = 'lexintel_test'")
        if not cur.fetchone():
            cur.execute("CREATE DATABASE lexintel_test")
    admin.close()


def assert_test_database() -> None:
    from app.core.config import get_settings

    name = urlparse(get_settings().postgres_url).path.lstrip("/")
    mongo_name = urlparse(get_settings().mongo_url).path.lstrip("/")
    if not name.endswith("_test") or not mongo_name.endswith("_test"):
        raise SystemExit(f"Refusing to run: '{name}' / '{mongo_name}' are not *_test databases.")


def reset_databases() -> None:
    """Empty every table and collection in the TEST databases."""
    assert_test_database()
    from sqlalchemy import text

    from app.db.base import SessionLocal, init_db
    from app.db.mongo_repository import get_mongo_db

    init_db()
    with SessionLocal() as db:
        tables = ", ".join([
            "audit_log", "research_notes", "evidence", "law_documents", "case_parties", "hearings",
            "people", "timeline_events", "case_rulings", "complaints", "cases", "users",
        ])
        db.execute(text(f"TRUNCATE {tables} CASCADE"))
        db.commit()
    mongo = get_mongo_db()
    for name in mongo.list_collection_names():
        mongo[name].delete_many({})
    # The law index and uploads live on disk, not in the databases: clear the
    # test copies too, or vectors from a previous run survive the TRUNCATE.
    import shutil

    for path in (os.environ["FAISS_INDEX_PATH"], os.environ["UPLOAD_DIR"]):
        assert path.startswith("/tmp/lexintel-test"), path
        shutil.rmtree(path, ignore_errors=True)


_ensure_database()
