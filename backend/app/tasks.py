"""
Background jobs. Each job is a plain function (`*_job`) wrapped by a Celery
task, so the same code runs in the worker or -- when the worker/Redis is
down -- in a background thread inside the API process via `dispatch()`.
Every job is idempotent and records failures on the record itself, so the
UI can show "failed: <reason>" with a retry button instead of hanging.
"""

from __future__ import annotations

import logging
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from app.core.config import get_settings
from app.core.redis_client import redis_probe
from app.core.resilience import Probe
from app.worker import celery_app

log = logging.getLogger("lexintel.tasks")
settings = get_settings()


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def _check_worker() -> None:
    if not settings.celery_enabled:
        raise RuntimeError("disabled by CELERY_ENABLED=false")
    if not redis_probe.available():
        raise RuntimeError("redis unavailable")
    # limit=1 returns as soon as one worker answers; the first ping on a fresh
    # connection can take ~2s, so the ceiling is generous.
    if not celery_app.control.ping(timeout=4.0, limit=1):
        raise RuntimeError("no Celery worker replied")


worker_probe = Probe("celery_worker", _check_worker, ttl=30)


def dispatch(job_name: str, *args: str) -> str:
    """Queue on the worker if one is alive; otherwise run in a daemon thread. Returns 'queued' | 'inline'."""
    str_args = [str(a) for a in args]
    task = _TASKS[job_name]
    if worker_probe.available():
        try:
            task.apply_async(args=str_args, retry=False)
            return "queued"
        except Exception as exc:
            worker_probe.mark_down(exc)
    threading.Thread(target=_run_inline, args=(job_name, str_args), daemon=True, name=f"inline-{job_name}").start()
    return "inline"


def _run_inline(job_name: str, args: list[str]) -> None:
    try:
        _JOBS[job_name](*args)
    except Exception:
        log.exception("inline job %s failed", job_name)


# ---------------------------------------------------------------------------
# Complaint AI triage (Module 1)
# ---------------------------------------------------------------------------

def classify_complaint_job(complaint_id: str) -> None:
    from app.agents.graph_orchestrator import build_intake_graph, is_likely_duplicate, token_similarity
    from app.db import search
    from app.db.base import get_session
    from app.db.postgres_repository import ComplaintRepository
    from app.models.schemas import ComplaintStatus
    from app.services.indexing import index_complaint

    with get_session() as db:
        complaint = ComplaintRepository(db).get(complaint_id)
    if complaint is None:
        return

    def similar(text: str, top_k: int = 3) -> list[dict]:
        """Recent complaints plus Elasticsearch "more like this" hits, scored by meaning and wording."""
        from app.ai import embeddings

        with get_session() as db:
            rows = ComplaintRepository(db).recent_texts(exclude_id=complaint.id, limit=300)
        pool: dict[str, tuple[str, str | None]] = {str(cid): (desc or "", ref) for cid, desc, ref in rows}
        for h in search.more_like_this("complaints", text, exclude_id=complaint_id, limit=top_k * 3) or []:
            pool.setdefault(h["id"], (h["source"].get("body", ""), h["source"].get("reference_number")))
        if not pool:
            return []
        ids = list(pool)
        meanings = None
        try:
            vectors = embeddings.embed([text] + [pool[i][0] for i in ids])
            meanings = vectors[1:] @ vectors[0]
        except embeddings.ModelUnavailable:
            pass
        scored = []
        for n, cid in enumerate(ids):
            body, ref = pool[cid]
            wording = round(token_similarity(text, body), 2)
            meaning = round(float(meanings[n]), 2) if meanings is not None else None
            scored.append({"id": cid, "reference_number": ref, "meaning": meaning, "wording": wording,
                           "similarity": meaning if meaning is not None else wording})
        return sorted(scored, key=lambda c: c["similarity"], reverse=True)[:top_k]

    try:
        result = build_intake_graph(similar).invoke({
            "complaint_id": str(complaint.id),
            "raw_text": complaint.description,
            "citizen_category": complaint.case_type.value,
            "case_opened_on": complaint.submitted_at.date().isoformat(),
        })
        duplicates = result.get("duplicate_candidates") or []
        explanation = result.get("classification_reason", "")
        likely = next((c for c in duplicates if is_likely_duplicate(c)), None)
        if likely:
            top = likely
            basis = (f"same meaning {top['meaning']:.0%}" if top.get("meaning") is not None
                     else f"text overlap {top['similarity']:.0%}")
            explanation += f" Possible duplicate of {top.get('reference_number')} ({basis})."
        details = dict(result.get("classification_details") or {})
        details["priority_explanation"] = result.get("priority_explanation")
        with get_session() as db:
            updated = ComplaintRepository(db).update(
                complaint.id,
                ai_status="done" if result.get("classification_source") == "semantic" else "fallback",
                ai_details=details,
                ai_suggested_category=result.get("case_type"),
                ai_suggested_department=result.get("department"),
                ai_confidence=result.get("confidence"),
                ai_explanation=explanation.strip(),
                ai_priority_level=result.get("priority_level"),
                duplicate_candidates=duplicates,
                ai_duplicate_of=UUID(likely["id"]) if likely else None,
            )
        if updated:
            index_complaint(updated)
        if updated and updated.status == ComplaintStatus.RECEIVED:
            pass  # staff moves it to under_review from the triage screen
    except Exception as exc:
        log.exception("complaint classification failed")
        with get_session() as db:
            ComplaintRepository(db).update(complaint.id, ai_status="failed",
                                           ai_explanation=f"Automatic triage failed: {type(exc).__name__}. A clerk should classify it manually.")


# ---------------------------------------------------------------------------
# Evidence processing (Modules 2, 3)
# ---------------------------------------------------------------------------

def process_evidence_job(evidence_id: str) -> None:
    from app.agents.arabic_ner import is_arabic
    from app.agents.case_intelligence_agent import run_case_intelligence
    from app.db.base import get_session
    from app.db.mongo_repository import EvidenceTextRepository, get_mongo_db, mongo_probe
    from app.db.postgres_repository import CaseRepository, EvidenceRepository
    from app.ingestion.document_processing import AUDIO_VIDEO_EXTENSIONS, extract_text
    from app.models.schemas import TimelineEvent
    from app.services.indexing import index_evidence
    from app.stt import transcription

    with get_session() as db:
        repo = EvidenceRepository(db)
        row = repo.row(evidence_id)
        if row is None or row.processing_status == "done":
            return
        row.processing_status = "processing"
        row.processing_error = None
        path, label, case_id = row.storage_path, row.label, str(row.case_id)
        ext = Path(row.storage_path).suffix.lower().lstrip(".")

    warnings: list[str] = []
    try:
        text, pages, confidence, page_count, method = "", [], None, None, "none"
        if ext in AUDIO_VIDEO_EXTENSIONS:
            if transcription.available():
                result = transcription.transcribe_file(path)
                text, method = result["text"], "speech_to_text"
                confidence = result["language_probability"]
            else:
                warnings.append("Speech-to-text is unavailable; the recording was stored without a transcript.")
        else:
            extracted = extract_text(path, ext)
            text, pages, confidence = extracted.text, extracted.pages, extracted.mean_confidence
            page_count, method = extracted.page_count, extracted.method
            warnings.extend(extracted.warnings)

        intelligence = {"entities": [], "charges_mentioned": [], "offence_mentions": [], "legal_references": [],
                        "timeline_events": [], "warnings": []}
        ai_summary = None
        if text.strip():
            from app.ai.summarize import extractive_summary

            intelligence = run_case_intelligence(case_id, text, label)
            warnings.extend(intelligence.get("warnings", []))
            ai_summary = {
                "summary": extractive_summary(text, max_sentences=5),
                "offence_mentions": intelligence.get("offence_mentions", []),
                "legal_references": intelligence.get("legal_references", [])[:20],
            }

        stored_in_mongo = False
        if mongo_probe.available():
            try:
                EvidenceTextRepository(get_mongo_db()).upsert(
                    evidence_id, case_id, text, pages, intelligence["entities"], intelligence["charges_mentioned"],
                    {"method": method, "warnings": warnings},
                )
                stored_in_mongo = True
            except Exception as exc:
                mongo_probe.mark_down(exc)

        with get_session() as db:
            evidence = EvidenceRepository(db).update(
                evidence_id,
                processing_status="done",
                processed_at=datetime.now(timezone.utc),
                processing_error="; ".join(warnings)[:2000] or None,
                ocr_confidence=confidence,
                ocr_language=("ar" if is_arabic(text) else "en") if text.strip() else None,
                page_count=page_count,
                text_length=len(text),
                entity_count=len(intelligence["entities"]),
                ai_summary=ai_summary,
                ocr_text_fallback=None if stored_in_mongo else text[:1_000_000],
            )
            events = []
            for ev in intelligence.get("timeline_events", [])[:60]:
                try:
                    event_date = date.fromisoformat(ev["event_date"]) if ev.get("event_date") else None
                except ValueError:
                    event_date = None
                events.append(TimelineEvent(case_id=UUID(case_id), event_date=event_date,
                                            description=ev["description"][:1000], entity_type="event",
                                            source_document_id=UUID(evidence_id), source_label=label))
            if events:
                CaseRepository(db).add_timeline_events(case_id, events)
        if evidence and text.strip():
            index_evidence(evidence, text)
    except Exception as exc:
        log.exception("evidence processing failed")
        with get_session() as db:
            EvidenceRepository(db).update(evidence_id, processing_status="failed",
                                          processing_error=f"{type(exc).__name__}: {exc}"[:2000])


# ---------------------------------------------------------------------------
# Law Library ingestion (Module 6)
# ---------------------------------------------------------------------------

def ingest_law_document_job(law_document_id: str) -> None:
    from app.core.storage import extension_of
    from app.db.base import get_session
    from app.db.postgres_repository import LawDocumentRepository
    from app.ingestion import law_library
    from app.ingestion.document_processing import extract_text

    with get_session() as db:
        row = LawDocumentRepository(db).row(law_document_id)
        if row is None or row.status == "indexed":
            return
        row.status, row.error = "processing", None
        doc = {
            "id": str(row.id), "title": row.title, "jurisdiction": row.jurisdiction, "language": row.language,
            "source_url": row.source_url, "law_number": row.law_number, "year": row.year,
            "effective_from": row.effective_from.isoformat() if row.effective_from else None,
            "effective_to": row.effective_to.isoformat() if row.effective_to else None,
            "legislation_state": row.legislation_state,
        }
        path, ext, old_ids = row.storage_path, extension_of(row.original_filename), row.vector_ids

    try:
        extracted = extract_text(path, ext)
        if len(extracted.text.strip()) < 50:
            raise ValueError("No readable text was found in this file (it may be an image-only scan the OCR could not read).")
        articles, mode = law_library.parse_articles(extracted.text)
        if not articles:
            raise ValueError("The text could not be split into articles or sections.")
        if old_ids:
            law_library.remove_articles(law_document_id, old_ids)
        vector_ids = law_library.add_articles(doc, articles, mode)
        notes = list(extracted.warnings)
        if mode == "sections":
            notes.append("No 'Article (N)' / 'المادة (N)' markers were found, so the text was indexed as numbered sections.")
        with get_session() as db:
            LawDocumentRepository(db).update(
                law_document_id, status="indexed", article_count=len(articles), parse_mode=mode,
                vector_ids=vector_ids, indexed_at=datetime.now(timezone.utc), error="; ".join(notes) or None,
            )
    except Exception as exc:
        log.exception("law ingestion failed")
        with get_session() as db:
            LawDocumentRepository(db).update(law_document_id, status="failed",
                                             error=f"{type(exc).__name__}: {exc}"[:2000])


# ---------------------------------------------------------------------------
# Courtroom recordings: full-quality transcription after step-down
# ---------------------------------------------------------------------------

def finalize_statement_job(statement_id: str) -> None:
    from app.agents.case_intelligence_agent import run_case_intelligence
    from app.db.base import get_session
    from app.db.mongo_repository import StatementRepository, get_mongo_db
    from app.db.postgres_repository import CaseRepository
    from app.models.schemas import TimelineEvent
    from app.services.indexing import index_statement
    from app.stt import transcription

    repo = StatementRepository(get_mongo_db())
    statement = repo.get(statement_id)
    if statement is None:
        return

    update: dict = {}
    if statement.recording_path and transcription.available():
        repo.col.update_one({"_id": statement_id}, {"$set": {"transcript_status": "processing"}})
        try:
            result = transcription.transcribe_file(statement.recording_path)
            latest = repo.get(statement_id)
            update["transcript_language"] = result["language"]
            update["transcript_confidence"] = result["language_probability"]
            if result["text"] and latest and latest.transcript_source != "edited":
                update["transcript"] = result["text"]
                update["transcript_source"] = "final"
            update["transcript_status"] = "done"
        except Exception as exc:
            log.exception("final transcription failed")
            update["transcript_status"] = "failed"
            update["transcript_error"] = f"{type(exc).__name__}: {exc}"[:500]
    else:
        update["transcript_status"] = "done" if statement.transcript else "none"

    transcript = update.get("transcript") or statement.transcript or ""
    if transcript.strip():
        from app.ai.summarize import extractive_summary

        update["summary"] = extractive_summary(transcript, max_sentences=4, max_chars=1000)
    if transcript.strip() and statement.case_id:
        intelligence = run_case_intelligence(str(statement.case_id), transcript,
                                             f"statement of {statement.person_name or 'party'}")
        update["extracted_entities"] = intelligence["entities"][:300]
        update["offence_mentions"] = intelligence.get("offence_mentions", [])
        events = []
        for ev in intelligence.get("timeline_events", [])[:40]:
            try:
                event_date = date.fromisoformat(ev["event_date"]) if ev.get("event_date") else None
            except ValueError:
                event_date = None
            events.append(TimelineEvent(
                case_id=statement.case_id, event_date=event_date, description=ev["description"][:1000],
                entity_type="event", source_document_id=statement.id,
                source_label=f"Statement: {statement.person_name or statement.role.value}",
            ))
        if events:
            with get_session() as db:
                CaseRepository(db).add_timeline_events(statement.case_id, events)

    repo.col.update_one({"_id": statement_id}, {"$set": update})
    refreshed = repo.get(statement_id)
    if refreshed and (refreshed.transcript or "").strip():
        index_statement(refreshed)


def summarize_statement_job(statement_id: str) -> None:
    """Refresh a statement's key sentences and offence mentions (after step-down or a clerk's edit)."""
    from app.ai.offences import offence_mentions
    from app.ai.summarize import extractive_summary
    from app.db.mongo_repository import StatementRepository, get_mongo_db

    repo = StatementRepository(get_mongo_db())
    statement = repo.get(statement_id)
    if statement is None or not (statement.transcript or "").strip():
        return
    repo.col.update_one({"_id": statement_id}, {"$set": {
        "summary": extractive_summary(statement.transcript, max_sentences=4, max_chars=1000),
        "offence_mentions": offence_mentions(statement.transcript)["mentions"],
    }})


# ---------------------------------------------------------------------------
# Maintenance (Celery beat)
# ---------------------------------------------------------------------------

def rescore_priorities_job() -> None:
    from app.agents.prioritization_agent import score_case
    from app.db.base import get_session
    from app.db.postgres_repository import CaseRepository

    with get_session() as db:
        repo = CaseRepository(db)
        cases, _ = repo.search(open_only=True, limit=5000)
        for case in cases:
            signals = dict(case.priority_signals or {})
            signals["case_id"] = str(case.id)
            signals.setdefault("case_opened_on", case.created_at.date().isoformat())
            if case.statutory_deadline and not signals.get("statutory_deadline"):
                signals["statutory_deadline"] = case.statutory_deadline.isoformat()
            repo.update_priority(case.id, score_case(signals), signals)


def reindex_all_job() -> None:
    from app.db import search
    from app.db.base import get_session
    from app.db.mongo_repository import EvidenceTextRepository, StatementRepository, get_mongo_db, mongo_probe
    from app.db.neo4j_repository import safe_graph_call
    from app.db.postgres_repository import CaseRepository, ComplaintRepository, EvidenceRepository, PersonRepository
    from app.ingestion import law_library
    from app.services import indexing

    with get_session() as db:
        case_repo = CaseRepository(db)
        for case in case_repo.list_all():
            parties = case_repo.parties(case.id)
            indexing.index_case(case, [p.person.full_name for p in parties],
                                vector=indexing.case_vector(case, load=True))
            for party in parties:
                safe_graph_call("link_person_to_case", party.person.id, case.id, party.role,
                                party.person.full_name, case.case_number)
            if case.source_complaint_id:
                safe_graph_call("link_complaint_to_case", case.source_complaint_id, case.id)
        for complaint in ComplaintRepository(db).list_all():
            indexing.index_complaint(complaint)
        for person in PersonRepository(db).list_all(limit=100_000):
            indexing.index_person(person)
        evidence_rows = []
        for case in case_repo.list_all():
            evidence_rows.extend(EvidenceRepository(db).list_for_case(case.id))

    if mongo_probe.available():
        mongo = get_mongo_db()
        text_repo = EvidenceTextRepository(mongo)
        for evidence in evidence_rows:
            doc = text_repo.get(str(evidence.id))
            if doc and doc.get("text"):
                indexing.index_evidence(evidence, doc["text"])
        for statement in StatementRepository(mongo).col.find({"transcript": {"$nin": [None, ""]}}):
            from app.db.mongo_repository import _doc_to_statement

            indexing.index_statement(_doc_to_statement(statement))

    store = law_library.load_store()
    if store is not None:
        batch = []
        for vector_id, doc in store.docstore._dict.items():
            batch.append((vector_id, {**doc.metadata, "body": doc.page_content}))
            if len(batch) >= 500:
                search.bulk_index("law", batch)
                batch = []
        if batch:
            search.bulk_index("law", batch)


def backfill_case_vectors_job(limit: int = 200) -> None:
    """Give indexed cases that lack a meaning vector one (the API skips it when the model isn't loaded)."""
    from app.db import search
    from app.db.base import get_session
    from app.db.postgres_repository import CaseRepository
    from app.services.indexing import case_vector

    missing = search.ids_missing_vectors("cases", limit=limit)
    if not missing:
        return
    done = 0
    with get_session() as db:
        repo = CaseRepository(db)
        for case_id in missing:
            case = repo.get(case_id)
            if case is None:
                continue
            vector = case_vector(case, load=True)
            if vector is None:
                return  # model unavailable; try again next round
            done += search.set_vector("cases", case_id, vector)
    log.info("added meaning vectors to %d case(s)", done)


def rebuild_law_index_if_model_changed_job() -> None:
    """Re-embed every indexed law document after EMBEDDING_MODEL changes."""
    from sqlalchemy import select, update

    from app.db.base import get_session
    from app.db.orm_models import LawDocumentORM
    from app.ingestion import law_library

    if not law_library.index_model_mismatch():
        return
    log.warning("embedding model changed; rebuilding the law library index")
    law_library.reset_index()
    with get_session() as db:
        db.execute(update(LawDocumentORM).where(LawDocumentORM.status == "indexed")
                   .values(status="queued", vector_ids=None))
        ids = [str(i) for i in db.execute(
            select(LawDocumentORM.id).where(LawDocumentORM.status == "queued")).scalars()]
    for doc_id in ids:
        ingest_law_document_job(doc_id)


def retry_stuck_jobs_job() -> None:
    from sqlalchemy import select

    from app.db.base import get_session
    from app.db.orm_models import ComplaintORM
    from app.db.postgres_repository import EvidenceRepository, LawDocumentRepository

    rebuild_law_index_if_model_changed_job()
    try:
        backfill_case_vectors_job()
    except Exception:
        log.exception("case vector backfill failed")
    with get_session() as db:
        evidence_ids = EvidenceRepository(db).stuck(15)
        law_ids = LawDocumentRepository(db).stuck(30)
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
        complaint_ids = db.execute(
            select(ComplaintORM.id).where(ComplaintORM.ai_status == "pending", ComplaintORM.submitted_at < cutoff)
        ).scalars().all()
    for eid in evidence_ids:
        with get_session() as db:
            EvidenceRepository(db).update(eid, processing_status="queued")
        process_evidence_job(str(eid))
    for lid in law_ids:
        with get_session() as db:
            LawDocumentRepository(db).update(lid, status="queued")
        ingest_law_document_job(str(lid))
    for cid in complaint_ids:
        classify_complaint_job(str(cid))


# ---------------------------------------------------------------------------
# Celery registration
# ---------------------------------------------------------------------------

@celery_app.task(name="lexintel.classify_complaint")
def classify_complaint(complaint_id: str) -> None:
    classify_complaint_job(complaint_id)


@celery_app.task(name="lexintel.process_evidence")
def process_evidence(evidence_id: str) -> None:
    process_evidence_job(evidence_id)


@celery_app.task(name="lexintel.ingest_law_document")
def ingest_law_document(law_document_id: str) -> None:
    ingest_law_document_job(law_document_id)


@celery_app.task(name="lexintel.finalize_statement")
def finalize_statement(statement_id: str) -> None:
    finalize_statement_job(statement_id)


@celery_app.task(name="lexintel.summarize_statement")
def summarize_statement(statement_id: str) -> None:
    summarize_statement_job(statement_id)


@celery_app.task(name="lexintel.backfill_case_vectors")
def backfill_case_vectors() -> None:
    backfill_case_vectors_job()


@celery_app.task(name="lexintel.rescore_priorities")
def rescore_priorities() -> None:
    rescore_priorities_job()


@celery_app.task(name="lexintel.reindex_all")
def reindex_all() -> None:
    reindex_all_job()


@celery_app.task(name="lexintel.retry_stuck_jobs")
def retry_stuck_jobs() -> None:
    retry_stuck_jobs_job()


_TASKS = {
    "classify_complaint": classify_complaint,
    "process_evidence": process_evidence,
    "ingest_law_document": ingest_law_document,
    "finalize_statement": finalize_statement,
    "summarize_statement": summarize_statement,
    "backfill_case_vectors": backfill_case_vectors,
    "rescore_priorities": rescore_priorities,
    "reindex_all": reindex_all,
    "retry_stuck_jobs": retry_stuck_jobs,
}

_JOBS = {
    "classify_complaint": classify_complaint_job,
    "process_evidence": process_evidence_job,
    "ingest_law_document": ingest_law_document_job,
    "finalize_statement": finalize_statement_job,
    "summarize_statement": summarize_statement_job,
    "backfill_case_vectors": backfill_case_vectors_job,
    "rescore_priorities": rescore_priorities_job,
    "reindex_all": reindex_all_job,
    "retry_stuck_jobs": retry_stuck_jobs_job,
}
