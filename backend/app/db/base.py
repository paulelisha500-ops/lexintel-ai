"""
SQLAlchemy engine + session setup for the Postgres-backed repositories.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import get_settings
from app.core.resilience import Probe

log = logging.getLogger("lexintel.db")
settings = get_settings()

engine = create_engine(
    settings.postgres_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    pool_recycle=1800,
    connect_args={"connect_timeout": 5},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)

Base = declarative_base()


def _check() -> None:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))


postgres_probe = Probe("postgres", _check, ttl=10)


def init_db() -> None:
    """Create missing tables and apply additive migrations. Safe to call repeatedly."""
    from app.db import orm_models  # noqa: F401  (registers models on Base)
    from app.db.migrations import run_migrations

    with engine.begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(8042026)"))
        Base.metadata.create_all(bind=conn)
    with engine.begin() as conn:
        run_migrations(conn)


@contextmanager
def get_session() -> Iterator[Session]:
    """Context-manager form, for scripts, tasks and tests."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency form: `db: Session = Depends(get_db)`."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
