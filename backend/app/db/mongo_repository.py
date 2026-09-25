"""
Mongo-backed repositories for the naturally document-shaped records:
CourtroomSession, StatementRecord (transcripts + live segments) and the
extracted text/entities of evidence files.

Uses pymongo's synchronous API; tests pass a mongomock database, which
mirrors pymongo's API, so the classes below don't know which they got.
"""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from typing import Any

from app.core.config import get_settings
from app.core.resilience import Probe
from app.models.schemas import CourtroomSession, StatementRecord

settings = get_settings()


@lru_cache
def get_real_mongo_client():
    import pymongo

    return pymongo.MongoClient(
        settings.mongo_url,
        serverSelectionTimeoutMS=3000,
        connectTimeoutMS=3000,
        socketTimeoutMS=20000,
        uuidRepresentation="standard",
    )


def get_mongo_db(client=None):
    """The database named in MONGO_URL's path (e.g. .../lexintel), so tests can
    point at a separate lexintel_test database."""
    if client is None:
        client = get_real_mongo_client()
    return client.get_default_database(default="lexintel")


def _check() -> None:
    get_real_mongo_client().admin.command("ping")


mongo_probe = Probe("mongo", _check)


def _session_to_doc(session: CourtroomSession) -> dict:
    doc = session.model_dump(mode="json")
    doc["_id"] = str(session.id)
    return doc


def _doc_to_session(doc: dict) -> CourtroomSession:
    doc = dict(doc)
    doc.pop("_id", None)
    return CourtroomSession.model_validate(doc)


def _statement_to_doc(statement: StatementRecord) -> dict:
    doc = statement.model_dump(mode="json")
    doc["_id"] = str(statement.id)
    return doc


def _doc_to_statement(doc: dict) -> StatementRecord:
    doc = dict(doc)
    doc.pop("_id", None)
    return StatementRecord.model_validate(doc)


class SessionRepository:
    def __init__(self, db):
        self.col = db["courtroom_sessions"]

    def get(self, session_id: str) -> CourtroomSession | None:
        doc = self.col.find_one({"_id": str(session_id)})
        return _doc_to_session(doc) if doc else None

    def upsert(self, session: CourtroomSession) -> CourtroomSession:
        doc = _session_to_doc(session)
        self.col.replace_one({"_id": doc["_id"]}, doc, upsert=True)
        return session

    def active_for_hearing(self, hearing_id: str) -> CourtroomSession | None:
        doc = self.col.find_one(
            {"hearing_id": str(hearing_id), "session_closed_at": None},
            sort=[("session_started_at", -1)],
        )
        return _doc_to_session(doc) if doc else None

    def list_for_hearing(self, hearing_id: str) -> list[CourtroomSession]:
        docs = self.col.find({"hearing_id": str(hearing_id)}).sort("session_started_at", 1)
        return [_doc_to_session(d) for d in docs]


class StatementRepository:
    def __init__(self, db):
        self.col = db["statements"]

    def get(self, statement_id: str) -> StatementRecord | None:
        doc = self.col.find_one({"_id": str(statement_id)})
        return _doc_to_statement(doc) if doc else None

    def upsert(self, statement: StatementRecord) -> StatementRecord:
        doc = _statement_to_doc(statement)
        self.col.replace_one({"_id": doc["_id"]}, doc, upsert=True)
        return statement

    def append_segment(self, statement_id: str, segment: dict) -> None:
        self.col.update_one({"_id": str(statement_id)}, {"$push": {"live_segments": segment}})

    def list_for_hearing(self, hearing_id: str) -> list[StatementRecord]:
        docs = self.col.find({"hearing_id": str(hearing_id)}).sort("sequence_number", 1)
        return [_doc_to_statement(d) for d in docs]

    def list_for_case(self, case_id: str) -> list[StatementRecord]:
        docs = self.col.find({"case_id": str(case_id)}).sort([("started_at", 1)])
        return [_doc_to_statement(d) for d in docs]

    def count(self) -> int:
        return self.col.count_documents({})

    def search_text(self, q: str, limit: int = 10) -> list[StatementRecord]:
        import re

        pattern = re.compile(re.escape(q), re.IGNORECASE)
        docs = self.col.find({"transcript": {"$regex": pattern}}).limit(limit)
        return [_doc_to_statement(d) for d in docs]


class EvidenceTextRepository:
    """Full extracted text + entities for an evidence file."""

    def __init__(self, db):
        self.col = db["evidence_text"]

    def upsert(self, evidence_id: str, case_id: str, text: str, pages: list[str] | None,
               entities: list[dict[str, Any]], charges: list[str], meta: dict[str, Any]) -> None:
        self.col.replace_one(
            {"_id": str(evidence_id)},
            {
                "_id": str(evidence_id), "case_id": str(case_id), "text": text, "pages": pages or [],
                "entities": entities, "charges": charges, "meta": meta, "updated_at": datetime.utcnow(),
            },
            upsert=True,
        )

    def get(self, evidence_id: str) -> dict | None:
        return self.col.find_one({"_id": str(evidence_id)})

    def delete(self, evidence_id: str) -> None:
        self.col.delete_one({"_id": str(evidence_id)})

    def search_text(self, q: str, limit: int = 10) -> list[dict]:
        import re

        pattern = re.compile(re.escape(q), re.IGNORECASE)
        return list(self.col.find({"text": {"$regex": pattern}}, {"text": 1, "case_id": 1}).limit(limit))
