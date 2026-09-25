"""
Search-index document builders. Every function is best-effort: if
Elasticsearch is down it returns False and the nightly `reindex_all` job
catches the record up later.
"""

from __future__ import annotations

from app.db import search
from app.models.schemas import Case, Complaint, Evidence, Person, StatementRecord


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def case_semantic_text(case: Case) -> str:
    """What a case is about, for its meaning vector (party names left out on purpose:
    two cases are not "similar" because the same person appears in both)."""
    return "\n".join(filter(None, [case.title, case.description or "",
                                   "\n".join(t.description for t in case.timeline[:60])]))


def case_vector(case: Case, load: bool = False) -> list[float] | None:
    """The case's meaning vector, or None. Without `load`, only computed if the model is
    already in memory, so saving a case never waits for a model to load; the worker's
    backfill job fills the gap within minutes."""
    from app.ai import embeddings

    if not load and not embeddings.ready(warm=False):
        return None
    try:
        return embeddings.embed_document(case_semantic_text(case)).tolist()
    except embeddings.ModelUnavailable:
        return None


def index_case(case: Case, party_names: list[str] | None = None, vector: list[float] | None = None) -> bool:
    body = "\n".join(filter(None, [
        case.description or "",
        " ".join(party_names or []),
        "\n".join(t.description for t in case.timeline[:200]),
    ]))
    return search.index_doc("cases", case.id, {
        "title": case.title, "body": body, "case_number": case.case_number,
        "case_type": case.case_type.value, "status": case.status.value, "created_at": _iso(case.created_at),
        "vector": vector if vector is not None else case_vector(case),
    })


def index_complaint(c: Complaint) -> bool:
    return search.index_doc("complaints", c.id, {
        "title": f"{c.reference_number or ''} {c.location or ''}".strip(),
        "body": c.description, "reference_number": c.reference_number,
        "case_type": (c.ai_suggested_category or c.case_type.value), "status": c.status.value,
        "created_at": _iso(c.submitted_at),
    })


def index_person(p: Person) -> bool:
    return search.index_doc("people", p.id, {
        "title": p.full_name,
        "body": " ".join(filter(None, [p.role_in_case.value if p.role_in_case else "", p.contact_phone or ""])),
    })


def index_evidence(e: Evidence, text: str) -> bool:
    return search.index_doc("evidence", e.id, {
        "title": f"{e.label} ({e.original_filename})", "body": text[:200_000], "case_id": str(e.case_id),
    })


def index_statement(s: StatementRecord) -> bool:
    return search.index_doc("statements", s.id, {
        "title": f"{s.person_name or 'Statement'} - {s.role.value}",
        "body": s.transcript or "", "case_id": str(s.case_id) if s.case_id else None,
        "hearing_id": str(s.hearing_id),
    })
