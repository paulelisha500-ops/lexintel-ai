"""
Idempotent, additive schema migrations for databases created before a
column existed. `Base.metadata.create_all()` creates missing TABLES but never
alters existing ones, so every column added to a pre-existing table in
orm_models.py must also be listed here.

Everything here is safe to run on every startup: ADD COLUMN IF NOT EXISTS,
CREATE INDEX IF NOT EXISTS, and backfills that only touch NULL rows. Runs
under a Postgres advisory lock so the API and worker containers starting
together can't race each other.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection

log = logging.getLogger("lexintel.migrations")

_ADVISORY_LOCK_KEY = 804_2026

_COLUMNS: list[tuple[str, str, str]] = [
    ("users", "last_login_at", "TIMESTAMPTZ"),
    ("users", "password_changed_at", "TIMESTAMPTZ"),
    ("cases", "description", "TEXT"),
    ("cases", "priority_signals", "JSONB"),
    ("cases", "priority_updated_at", "TIMESTAMPTZ"),
    ("cases", "assigned_judge_id", "UUID"),
    ("cases", "source_complaint_id", "UUID"),
    ("cases", "updated_at", "TIMESTAMPTZ DEFAULT now()"),
    ("cases", "closed_at", "TIMESTAMPTZ"),
    ("timeline_events", "source_label", "VARCHAR(255)"),
    ("timeline_events", "created_at", "TIMESTAMPTZ DEFAULT now()"),
    ("complaints", "reference_number", "VARCHAR(32)"),
    ("complaints", "tracking_code_hash", "VARCHAR(128)"),
    ("complaints", "complainant_name", "VARCHAR(255)"),
    ("complaints", "complainant_phone", "VARCHAR(64)"),
    ("complaints", "complainant_email", "VARCHAR(255)"),
    ("complaints", "preferred_language", "VARCHAR(8)"),
    ("complaints", "status", "VARCHAR(32) NOT NULL DEFAULT 'received'"),
    ("complaints", "updated_at", "TIMESTAMPTZ DEFAULT now()"),
    ("complaints", "ai_status", "VARCHAR(16) NOT NULL DEFAULT 'pending'"),
    ("complaints", "ai_explanation", "TEXT"),
    ("complaints", "ai_priority_level", "VARCHAR(16)"),
    ("complaints", "duplicate_candidates", "JSONB"),
    ("complaints", "assigned_department", "VARCHAR(128)"),
    ("complaints", "staff_notes", "TEXT"),
    ("complaints", "case_id", "UUID"),
    ("complaints", "ai_details", "JSONB"),
    ("complaints", "category_confirmed", "BOOLEAN NOT NULL DEFAULT false"),
    ("evidence", "ai_summary", "JSONB"),
    ("people", "emirates_id_last4", "VARCHAR(4)"),
    ("people", "created_at", "TIMESTAMPTZ DEFAULT now()"),
    ("hearings", "duration_minutes", "INTEGER NOT NULL DEFAULT 60"),
    ("hearings", "hearing_type", "VARCHAR(64)"),
    ("hearings", "notes", "TEXT"),
    ("hearings", "updated_at", "TIMESTAMPTZ DEFAULT now()"),
]

_INDEXES = [
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_complaints_reference_number ON complaints (reference_number)",
    "CREATE INDEX IF NOT EXISTS ix_complaints_status ON complaints (status)",
    "CREATE INDEX IF NOT EXISTS ix_hearings_scheduled_at ON hearings (scheduled_at)",
    "CREATE INDEX IF NOT EXISTS ix_hearings_case_id ON hearings (case_id)",
    "CREATE INDEX IF NOT EXISTS ix_timeline_events_case_id ON timeline_events (case_id)",
    "CREATE INDEX IF NOT EXISTS ix_people_full_name ON people (full_name)",
]


def _table_exists(conn: Connection, table: str) -> bool:
    return bool(conn.execute(text("SELECT to_regclass(:t)"), {"t": f"public.{table}"}).scalar())


def _sync_enum_types(conn: Connection) -> None:
    """SAEnum columns store member NAMES in native Postgres enum types. A member
    added to a Python enum later (e.g. HearingStatus.ADJOURNED) must be added to
    the database type too, or every query mentioning it fails."""
    from app.models.auth_models import SystemRole
    from app.models.schemas import CaseStatus, CaseType, HearingRole, HearingStatus, PriorityLevel

    for type_name, enum_cls in (
        ("system_role", SystemRole), ("case_type", CaseType), ("case_status", CaseStatus),
        ("priority_level", PriorityLevel), ("hearing_role", HearingRole), ("hearing_status", HearingStatus),
    ):
        existing = conn.execute(
            text("SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = :n"),
            {"n": type_name},
        ).scalars().all()
        if not existing:
            continue  # type not created yet; create_all will create it complete
        for member in enum_cls:
            if member.name not in existing:
                conn.execute(text(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{member.name}'"))
                log.info("added %s to enum type %s", member.name, type_name)


def run_migrations(conn: Connection) -> None:
    conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _ADVISORY_LOCK_KEY})
    _sync_enum_types(conn)

    for table, column, ddl in _COLUMNS:
        if _table_exists(conn, table):
            conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "{column}" {ddl}'))

    for stmt in _INDEXES:
        conn.execute(text(stmt))

    # Backfill reference numbers for complaints filed before references existed.
    rows = conn.execute(
        text("SELECT id, submitted_at FROM complaints WHERE reference_number IS NULL ORDER BY submitted_at")
    ).fetchall()
    for row in rows:
        year = (row.submitted_at or datetime.utcnow()).year
        ref = f"CMP-{year}-{secrets.token_hex(3).upper()}"
        conn.execute(text("UPDATE complaints SET reference_number = :r WHERE id = :i"), {"r": ref, "i": row.id})

    # Backfill case_parties from the legacy cases.parties JSONB list.
    if _table_exists(conn, "case_parties"):
        conn.execute(text("""
            INSERT INTO case_parties (case_id, person_id, role, added_at)
            SELECT c.id, p.id, COALESCE(lower(p.role_in_case::text), 'witness'), now()
            FROM cases c
            CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(c.parties, '[]'::jsonb)) AS party(pid)
            JOIN people p ON p.id::text = party.pid
            ON CONFLICT DO NOTHING
        """))

    if rows:
        log.info("backfilled %d complaint reference numbers", len(rows))
