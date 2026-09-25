"""
Module 6 -- Legal research + the Law Library that feeds it.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agents import legal_research_agent
from app.api.deps import LIBRARIANS, STAFF, audit, parse_uuid_or_404, require_role
from app.api.streaming import event_stream, sse
from app.core import ratelimit
from app.core.config import get_settings
from app.core.storage import delete_file, resolve_stored, save_upload
from app.db.base import get_db
from app.db.postgres_repository import LawDocumentRepository
from app.ingestion import law_library
from app.models.auth_models import SystemRole, UserAccount
from app.models.schemas import Jurisdiction, LawDocument
from app.tasks import dispatch

router = APIRouter(tags=["research"])
settings = get_settings()
log = logging.getLogger("lexintel.research")


class ResearchQuery(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    as_of_date: Optional[date] = None
    jurisdiction: Optional[Jurisdiction] = None


class ResearchAskQuery(ResearchQuery):
    write: bool = True   # also write a checked draft with the local model (slow on CPU)


@router.post("/research/ask")
async def ask_legal_research(query: ResearchAskQuery, request: Request, db: Session = Depends(get_db),
                             user: UserAccount = Depends(require_role(*STAFF))):
    if not ratelimit.hit(f"research:{user.id}", 60, 3600):
        raise HTTPException(429, "Research limit reached for this hour. Please try again later.")
    result = await run_in_threadpool(
        legal_research_agent.ask,
        query.question.strip(),
        query.as_of_date.isoformat() if query.as_of_date else None,
        query.jurisdiction.value if query.jurisdiction else None,
        query.write,
    )
    audit(db, request, user, "research.asked", "research", None,
          {"question": query.question[:300], "status": result.get("answer_status"),
           "citations": len(result.get("citations", []))})
    return result


@router.post("/research/ask/stream")
def ask_legal_research_stream(query: ResearchQuery, request: Request, db: Session = Depends(get_db),
                              user: UserAccount = Depends(require_role(*STAFF))):
    """
    Server-sent events: `status` (phase changes), `sources` (citations + key
    passages, sent as soon as retrieval finishes), `token` (draft text as the
    local model writes it) and one `final` (the checked result). The stream
    always ends with `final`, even when the model is off, busy or fails.
    """
    if not ratelimit.hit(f"research:{user.id}", 60, 3600):
        raise HTTPException(429, "Research limit reached for this hour. Please try again later.")
    question = query.question.strip()
    audit(db, request, user, "research.asked", "research", None, {"question": question[:300], "stream": True})
    db.commit()
    as_of = query.as_of_date.isoformat() if query.as_of_date else None
    jurisdiction = query.jurisdiction.value if query.jurisdiction else None

    def events():
        yield sse("status", {"phase": "retrieving"})
        try:
            prepared = legal_research_agent.prepare(question, as_of, jurisdiction)
        except Exception:
            log.exception("research retrieval failed")
            yield sse("final", {"status": "error", "answer_status": "error", "citations": [], "key_passages": [],
                                "answer": "", "needs_human_review": True,
                                "review_reason": "The law library could not be searched just now. Please try again."})
            return
        yield sse("sources", legal_research_agent.public(prepared))
        try:
            for kind, payload in legal_research_agent.stream_answer(prepared):
                yield sse(kind, payload)
        except Exception:
            log.exception("research draft failed")
            yield sse("final", legal_research_agent.public(prepared))

    return event_stream(events())


@router.get("/library/documents")
def list_law_documents(db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    return [d.model_dump(mode="json") for d in LawDocumentRepository(db).list_all()]


@router.get("/library/stats")
def library_stats(db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    docs = LawDocumentRepository(db).list_all()
    by_jurisdiction: dict[str, int] = {}
    for d in docs:
        if d.status == "indexed":
            by_jurisdiction[d.jurisdiction] = by_jurisdiction.get(d.jurisdiction, 0) + (d.article_count or 0)
    return {
        "documents": len(docs),
        "indexed_documents": sum(1 for d in docs if d.status == "indexed"),
        "processing": sum(1 for d in docs if d.status in ("queued", "processing")),
        "failed": sum(1 for d in docs if d.status == "failed"),
        "articles": sum(by_jurisdiction.values()),
        "articles_by_jurisdiction": by_jurisdiction,
        "corpus_available": legal_research_agent.corpus_available(),
    }


@router.post("/library/documents", status_code=201)
async def upload_law_document(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(..., min_length=3, max_length=500),
    jurisdiction: Jurisdiction = Form(...),
    language: str = Form(default="en", pattern=r"^(ar|en)$"),
    law_number: Optional[str] = Form(default=None, max_length=64),
    year: Optional[int] = Form(default=None, ge=1900, le=2100),
    effective_from: Optional[date] = Form(default=None),
    effective_to: Optional[date] = Form(default=None),
    legislation_state: str = Form(default="active", pattern=r"^(active|amended|repealed)$"),
    source_url: Optional[str] = Form(default=None, max_length=1000),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*LIBRARIANS)),
):
    if source_url and not source_url.startswith(("https://", "http://")):
        raise HTTPException(422, "Source URL must start with http:// or https://")
    if effective_from and effective_to and effective_to < effective_from:
        raise HTTPException(422, "'In force until' can't be earlier than 'in force from'.")
    stored = await save_upload(file, "library", settings.max_law_pdf_mb, {"pdf", "txt"})
    repo = LawDocumentRepository(db)
    existing = repo.find_by_sha(stored.sha256)
    if existing:
        delete_file(stored.path)
        raise HTTPException(409, f"This exact file is already in the library as '{existing.title}'.")
    doc = repo.create(LawDocument(
        title=title.strip(), law_number=law_number, year=year, jurisdiction=jurisdiction.value, language=language,
        effective_from=effective_from, effective_to=effective_to, legislation_state=legislation_state,
        source_url=source_url, original_filename=stored.original_filename, sha256=stored.sha256,
        size_bytes=stored.size_bytes, uploaded_by=user.id,
    ), stored.path)
    audit(db, request, user, "library.document_uploaded", "law_document", doc.id,
          {"title": doc.title, "jurisdiction": doc.jurisdiction, "sha256": stored.sha256})
    db.commit()
    data = doc.model_dump(mode="json")
    data["processing_mode"] = dispatch("ingest_law_document", str(doc.id))
    return data


@router.get("/library/documents/{doc_id}")
def get_law_document(doc_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    doc = LawDocumentRepository(db).get(parse_uuid_or_404(doc_id, "Law document"))
    if not doc:
        raise HTTPException(404, "Law document not found.")
    return doc.model_dump(mode="json")


@router.get("/library/documents/{doc_id}/articles")
async def law_document_articles(doc_id: str, db: Session = Depends(get_db),
                                _user: UserAccount = Depends(require_role(*STAFF))):
    doc = LawDocumentRepository(db).get(parse_uuid_or_404(doc_id, "Law document"))
    if not doc:
        raise HTTPException(404, "Law document not found.")
    articles = await run_in_threadpool(law_library.articles_for_document, str(doc.id))
    return {"document": doc.model_dump(mode="json"), "articles": articles}


@router.get("/library/documents/{doc_id}/file")
def download_law_document(doc_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    repo = LawDocumentRepository(db)
    row = repo.row(parse_uuid_or_404(doc_id, "Law document"))
    path = resolve_stored(row.storage_path) if row else None
    if path is None:
        raise HTTPException(404, "File not found.")
    return FileResponse(path, filename=row.original_filename, content_disposition_type="inline",
                        media_type="application/pdf" if path.suffix == ".pdf" else "text/plain")


@router.post("/library/documents/{doc_id}/reindex")
def reindex_law_document(doc_id: str, request: Request, db: Session = Depends(get_db),
                         user: UserAccount = Depends(require_role(*LIBRARIANS))):
    did = parse_uuid_or_404(doc_id, "Law document")
    if not LawDocumentRepository(db).update(did, status="queued", error=None):
        raise HTTPException(404, "Law document not found.")
    audit(db, request, user, "library.document_reindex", "law_document", did)
    db.commit()
    return {"status": "queued", "mode": dispatch("ingest_law_document", str(did))}


@router.delete("/library/documents/{doc_id}", status_code=204)
async def delete_law_document(doc_id: str, request: Request, db: Session = Depends(get_db),
                              user: UserAccount = Depends(require_role(SystemRole.ADMIN, SystemRole.CLERK,
                                                                       SystemRole.CASE_OFFICER))):
    repo = LawDocumentRepository(db)
    row = repo.row(parse_uuid_or_404(doc_id, "Law document"))
    if not row:
        raise HTTPException(404, "Law document not found.")
    if row.status == "processing":
        raise HTTPException(409, "This document is being indexed right now. Try again when it finishes.")
    doc_id_str, vector_ids, path, title = str(row.id), row.vector_ids, row.storage_path, row.title
    await run_in_threadpool(law_library.remove_articles, doc_id_str, vector_ids)
    repo.delete(row.id)
    delete_file(path)
    audit(db, request, user, "library.document_deleted", "law_document", doc_id_str, {"title": title})
