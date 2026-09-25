"""
Module 10 (legal analytics), global search, and admin/system endpoints.
"""

from __future__ import annotations

import shutil
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import STAFF, require_role
from app.core.config import get_settings
from app.core.llm import llm_description, llm_probe
from app.core.redis_client import redis_probe
from app.core.storage import upload_root
from app.db import search as es
from app.db.base import get_db, postgres_probe
from app.db.mongo_repository import EvidenceTextRepository, StatementRepository, get_mongo_db, mongo_probe
from app.db.neo4j_repository import neo4j_probe
from app.db.orm_models import CaseORM, ComplaintORM, EvidenceORM, HearingORM, LawDocumentORM
from app.db.postgres_repository import (
    AuditRepository, CaseRepository, ComplaintRepository, EvidenceRepository, PersonRepository, RulingRepository,
)
from app.ingestion import law_library
from app.models.auth_models import SystemRole, UserAccount
from app.models.schemas import OPEN_CASE_STATUSES, HearingStatus
from app.stt import transcription

router = APIRouter(tags=["insights"])
settings = get_settings()
UAE_TZ = timezone(timedelta(hours=4))


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


@router.get("/analytics/overview")
def analytics_overview(db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    now = datetime.now(UAE_TZ)
    today_start = datetime.combine(now.date(), time.min, tzinfo=UAE_TZ)
    week_end = today_start + timedelta(days=7)
    unavailable: list[str] = []

    case_rows = db.execute(select(CaseORM.status, CaseORM.case_type, CaseORM.priority_level,
                                  CaseORM.priority_requires_human_review, CaseORM.created_at,
                                  CaseORM.statutory_deadline)).all()
    by_status = Counter(_enum_value(r.status) for r in case_rows)
    by_type = Counter(_enum_value(r.case_type) for r in case_rows)
    open_rows = [r for r in case_rows if r.status in OPEN_CASE_STATUSES]
    by_priority = Counter(_enum_value(r.priority_level) or "unscored" for r in open_rows)
    deadlines_14d = sum(1 for r in open_rows if r.statutory_deadline and
                        0 <= (r.statutory_deadline - now.date()).days <= 14)
    overdue = sum(1 for r in open_rows if r.statutory_deadline and r.statutory_deadline < now.date())

    weeks = []
    for i in range(11, -1, -1):
        start = today_start - timedelta(days=now.weekday() + 7 * i)
        end = start + timedelta(days=7)
        opened = sum(1 for r in case_rows if r.created_at and start <= r.created_at.astimezone(UAE_TZ) < end)
        weeks.append({"week_start": start.date().isoformat(), "cases_opened": opened})

    hearing_rows = db.execute(select(HearingORM.scheduled_at, HearingORM.status)
                              .where(HearingORM.scheduled_at >= today_start - timedelta(days=1),
                                     HearingORM.scheduled_at < week_end)).all()
    active_statuses = (HearingStatus.SCHEDULED, HearingStatus.IN_PROGRESS)
    hearings_today = sum(1 for h in hearing_rows if today_start <= h.scheduled_at.astimezone(UAE_TZ) < today_start + timedelta(days=1)
                         and h.status != HearingStatus.CANCELLED)
    hearings_week = sum(1 for h in hearing_rows if h.scheduled_at.astimezone(UAE_TZ) >= today_start and h.status in active_statuses)

    complaint_rows = db.execute(select(ComplaintORM.status, ComplaintORM.ai_suggested_category, ComplaintORM.case_type,
                                       ComplaintORM.ai_status, ComplaintORM.submitted_at)).all()
    complaints_by_status = Counter(r.status for r in complaint_rows)
    complaints_by_category = Counter(r.ai_suggested_category or _enum_value(r.case_type) for r in complaint_rows)
    days = []
    for i in range(29, -1, -1):
        day = (now - timedelta(days=i)).date()
        days.append({"date": day.isoformat(),
                     "complaints": sum(1 for r in complaint_rows if r.submitted_at and r.submitted_at.astimezone(UAE_TZ).date() == day)})

    evidence_counts = EvidenceRepository(db).status_counts()
    rulings_count, avg_days = RulingRepository(db).count_and_avg_days()

    statements_total = None
    if mongo_probe.available():
        try:
            statements_total = StatementRepository(get_mongo_db()).count()
        except Exception as exc:
            mongo_probe.mark_down(exc)
            unavailable.append("mongo")
    else:
        unavailable.append("mongo")

    return {
        "generated_at": now.isoformat(),
        "cases": {
            "total": len(case_rows), "open": len(open_rows), "by_status": dict(by_status), "by_type": dict(by_type),
            "open_by_priority": dict(by_priority),
            "needs_review": sum(1 for r in open_rows if r.priority_requires_human_review),
            "deadlines_next_14_days": deadlines_14d, "overdue_deadlines": overdue,
            "opened_per_week": weeks,
        },
        "hearings": {"today": hearings_today, "next_7_days": hearings_week},
        "complaints": {
            "total": len(complaint_rows), "by_status": dict(complaints_by_status),
            "by_category": dict(complaints_by_category), "awaiting_triage": complaints_by_status.get("received", 0),
            "ai_status": dict(Counter(r.ai_status for r in complaint_rows)), "per_day_30": days,
        },
        "evidence": {
            "total": sum(evidence_counts["processing"].values()),
            "pending_review": evidence_counts["review"].get("pending_review", 0),
            "flagged": evidence_counts["review"].get("flagged", 0),
            "processing": evidence_counts["processing"].get("queued", 0) + evidence_counts["processing"].get("processing", 0),
            "failed": evidence_counts["processing"].get("failed", 0),
        },
        "rulings": {"total": rulings_count, "avg_days_to_ruling": avg_days},
        "statements": {"total": statements_total},
        "unavailable": unavailable,
    }


# ---------------------------------------------------------------------------
# Global search
# ---------------------------------------------------------------------------

@router.get("/search")
def global_search(q: str = Query(min_length=2, max_length=200), db: Session = Depends(get_db),
                  user: UserAccount = Depends(require_role(*STAFF))):
    kinds = ["cases", "people", "evidence", "statements", "law"]
    if user.role in (SystemRole.CASE_OFFICER, SystemRole.CLERK, SystemRole.ADMIN):
        kinds.append("complaints")
    results: dict[str, list[dict]] = {k: [] for k in kinds}
    hits = es.search(q, kinds=kinds, limit=6)

    if hits is not None:
        source = "elasticsearch"
        for kind, items in hits.items():
            for h in items:
                s = h["source"]
                results[kind].append({
                    "id": h["id"], "title": s.get("title") or s.get("reference_number") or "",
                    "subtitle": s.get("case_number") or s.get("reference_number") or s.get("article_label")
                    or s.get("jurisdiction") or "",
                    "snippet": h.get("highlight") or (s.get("body") or "")[:160],
                    "case_id": s.get("case_id") if kind in ("evidence", "statements") else (h["id"] if kind == "cases" else None),
                    "law_document_id": s.get("law_document_id"),
                })
    else:
        source = "fallback"
        cases, _ = CaseRepository(db).search(q=q, limit=6)
        results["cases"] = [{"id": str(c.id), "title": c.title, "subtitle": c.case_number,
                             "snippet": (c.description or "")[:160], "case_id": str(c.id)} for c in cases]
        results["people"] = [{"id": str(p.id), "title": p.full_name,
                              "subtitle": p.role_in_case.value if p.role_in_case else "", "snippet": ""}
                             for p in PersonRepository(db).list_all(q=q, limit=6)]
        if "complaints" in results:
            complaints, _ = ComplaintRepository(db).search(q=q, limit=6)
            results["complaints"] = [{"id": str(c.id), "title": c.reference_number or "", "subtitle": c.status.value,
                                      "snippet": c.description[:160]} for c in complaints]
        if mongo_probe.available():
            try:
                mongo = get_mongo_db()
                results["statements"] = [{"id": str(s.id), "title": s.person_name or "Statement",
                                          "subtitle": s.role.value, "snippet": (s.transcript or "")[:160],
                                          "case_id": str(s.case_id) if s.case_id else None}
                                         for s in StatementRepository(mongo).search_text(q, 6)]
                results["evidence"] = [{"id": d["_id"], "title": "Evidence text match", "subtitle": "",
                                        "snippet": (d.get("text") or "")[:160], "case_id": d.get("case_id")}
                                       for d in EvidenceTextRepository(mongo).search_text(q, 6)]
            except Exception as exc:
                mongo_probe.mark_down(exc)
    return {"query": q, "source": source, "results": results}


# ---------------------------------------------------------------------------
# Admin: system health + audit log
# ---------------------------------------------------------------------------

@router.get("/admin/system")
def system_status(refresh: bool = False, db: Session = Depends(get_db),
                  _admin: UserAccount = Depends(require_role(SystemRole.ADMIN))):
    from app.tasks import worker_probe

    services = [p.status(refresh=refresh) for p in
                (postgres_probe, mongo_probe, redis_probe, es.es_probe, neo4j_probe, worker_probe, llm_probe)]
    for s in services:
        if s["name"] == "llm":
            s["detail"] = llm_description()
    services.append(transcription.status())

    try:
        disk = shutil.disk_usage(upload_root())
        storage = {"path": str(upload_root()), "free_gb": round(disk.free / 1e9, 1), "total_gb": round(disk.total / 1e9, 1)}
    except OSError:
        storage = None

    law_articles = int(db.execute(select(func.coalesce(func.sum(LawDocumentORM.article_count), 0))
                                  .where(LawDocumentORM.status == "indexed")).scalar() or 0)
    return {
        "services": services,
        "ai_models": ai_models(db),
        "memory": memory_status(),
        "storage": storage,
        "corpus": {"indexed_articles": law_articles, "faiss_index_present": law_library.index_exists(),
                   "search_index_articles": es.doc_count("law")},
        "fallbacks": {
            "elasticsearch": "Search uses database queries; similar-case matching uses word overlap.",
            "neo4j": "Related cases are computed from case parties in Postgres.",
            "celery_worker": "Background jobs run inside the API process.",
            "llm": "Research shows the in-force articles and key passages without a written draft; case briefs show the quoted key facts.",
            "speech_to_text": "Clerks type or correct the statement transcript by hand.",
            "mongo": "Courtroom sessions are unavailable until MongoDB is back; everything else keeps working.",
        },
    }


def memory_status() -> dict:
    """Free memory on the machine and what that currently allows. The models are
    skipped rather than loaded when memory is short (app/ai/memory.py)."""
    from app.ai import memory

    from app.core import llm

    free = memory.available_mb()
    loaded = bool(llm.server_status().get("loaded"))
    return {
        "free_mb": free,
        "writing_model_needs_mb": memory.WRITING_MODEL_MB,
        "embeddings_need_mb": memory.EMBEDDINGS_MB,
        "writing_model_loaded": loaded,
        # Already in memory means a draft costs no new allocation, so it runs
        # whatever the free figure says.
        "can_start_writing_model": loaded or memory.enough_for(memory.WRITING_MODEL_MB),
    }


def ai_models(db: Session) -> list[dict]:
    """Every model LexIntel runs, what it is for, and whether it is in memory right now (this API process)."""
    from app.agents import case_intelligence_agent
    from app.ai import embeddings
    from app.ai.classifier import SEED_EXAMPLES
    from app.core import llm
    from app.db.postgres_repository import ComplaintRepository

    try:
        learned = len(ComplaintRepository(db).staff_labelled(limit=400))
    except Exception:
        learned = None
    writer = llm.server_status()
    writer.update(available=llm.enabled() and llm_probe.available(),
                  error=None if not llm.enabled() or llm_probe.available() else llm_probe.status().get("error"))
    return [
        {"key": "embeddings", "runtime": "sentence-transformers, CPU",
         **embeddings.slot.status(), "name": settings.embedding_model},
        {"key": "classifier", "name": "Nearest-neighbour complaint classifier", "runtime": "uses the embeddings model",
         "available": embeddings.available(), "loaded": embeddings.slot.loaded(),
         "examples": sum(len(v) for v in SEED_EXAMPLES.values()), "learned_examples": learned},
        {"key": "writer", "runtime": "Ollama, CPU", **writer, "name": settings.ollama_model},
        {"key": "speech_to_text", "name": f"faster-whisper {settings.whisper_model}", "runtime": "CTranslate2, CPU, int8",
         **{k: v for k, v in transcription.slot.status().items() if k != "name"}},
        {"key": "ner_en", "name": settings.spacy_model, "runtime": "spaCy, CPU",
         "available": not case_intelligence_agent._NLP_FAILED, "loaded": case_intelligence_agent._NLP is not None},
        {"key": "ocr", "name": "Tesseract (Arabic + English)", "runtime": "tesseract-ocr, CPU",
         "available": shutil.which("tesseract") is not None, "loaded": None},
    ]


@router.post("/admin/ai/writer/{action}")
def control_writer(action: str, _admin: UserAccount = Depends(require_role(SystemRole.ADMIN))):
    """Load the writing model now (so the next draft starts at once) or unload it to free memory."""
    from app.core import llm

    if action not in ("load", "unload"):
        raise HTTPException(404, "Unknown action.")
    try:
        return llm.load_model(unload=action == "unload")
    except llm.LLMUnavailable as exc:
        raise HTTPException(503, f"The writing model could not be {action}ed: {exc}") from exc


@router.get("/admin/audit")
def audit_log(action: Optional[str] = Query(default=None, max_length=64),
              entity_type: Optional[str] = Query(default=None, max_length=64),
              entity_id: Optional[str] = Query(default=None, max_length=64),
              username: Optional[str] = Query(default=None, max_length=64),
              limit: int = Query(default=50, ge=1, le=500), offset: int = Query(default=0, ge=0),
              db: Session = Depends(get_db), _admin: UserAccount = Depends(require_role(SystemRole.ADMIN))):
    items, total = AuditRepository(db).search(action=action, entity_type=entity_type, entity_id=entity_id,
                                              username=username, limit=limit, offset=offset)
    return {"items": [i.model_dump(mode="json") for i in items], "total": total}


@router.post("/admin/reindex")
def trigger_reindex(_admin: UserAccount = Depends(require_role(SystemRole.ADMIN))):
    from app.tasks import dispatch

    return {"mode": dispatch("reindex_all")}
