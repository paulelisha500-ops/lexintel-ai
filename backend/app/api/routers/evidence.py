"""
Evidence -- Module 3 (document processing / OCR) and Module 9 (signature
verification). Upload -> SHA-256 on the way in -> background OCR/transcription
-> case intelligence -> timeline + search index. Every view and download is
written to the audit log as chain-of-custody.
"""

from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import EVIDENCE_SUBMITTERS, STAFF, audit, parse_uuid_or_404, require_role
from app.core.config import get_settings
from app.core.storage import resolve_stored, save_upload, sha256_of_file
from app.db import search
from app.db.base import get_db
from app.db.mongo_repository import EvidenceTextRepository, get_mongo_db, mongo_probe
from app.db.postgres_repository import AuditRepository, CaseRepository, EvidenceRepository
from app.ingestion.document_processing import (
    AUDIO_VIDEO_EXTENSIONS, IMAGE_EXTENSIONS, TEXT_EXTENSIONS, extract_text, run_ocr, verify_signature,
)
from app.models.auth_models import UserAccount
from app.models.schemas import Evidence, EvidenceType
from app.tasks import dispatch

router = APIRouter(tags=["evidence"])
settings = get_settings()

ALLOWED = IMAGE_EXTENSIONS | TEXT_EXTENSIONS | AUDIO_VIDEO_EXTENSIONS | {"pdf", "docx", "doc", "xlsx", "zip", "eml", "msg"}


def _evidence_or_404(db: Session, evidence_id: str) -> Evidence:
    ev = EvidenceRepository(db).get(parse_uuid_or_404(evidence_id, "Evidence"))
    if not ev:
        raise HTTPException(404, "Evidence not found.")
    return ev


def _guess_type(ext: str, declared: Optional[EvidenceType]) -> EvidenceType:
    if declared:
        return declared
    if ext in IMAGE_EXTENSIONS:
        return EvidenceType.IMAGE
    if ext in {"mp4", "mov", "mkv", "webm"}:
        return EvidenceType.VIDEO
    if ext in AUDIO_VIDEO_EXTENSIONS:
        return EvidenceType.AUDIO
    return EvidenceType.DOCUMENT


@router.get("/cases/{case_id}/evidence")
def list_evidence(case_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    cid = parse_uuid_or_404(case_id, "Case")
    if not CaseRepository(db).get(cid):
        raise HTTPException(404, "Case not found.")
    return [e.model_dump(mode="json") for e in EvidenceRepository(db).list_for_case(cid)]


@router.post("/cases/{case_id}/evidence", status_code=201)
async def upload_evidence(
    case_id: str,
    request: Request,
    file: UploadFile = File(...),
    label: str = Form(default="", max_length=255),
    evidence_type: Optional[EvidenceType] = Form(default=None),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*EVIDENCE_SUBMITTERS)),
):
    cid = parse_uuid_or_404(case_id, "Case")
    if not CaseRepository(db).get(cid):
        raise HTTPException(404, "Case not found.")
    max_mb = settings.max_recording_mb if Path(file.filename or "").suffix.lower().lstrip(".") in AUDIO_VIDEO_EXTENSIONS \
        else settings.max_document_mb
    stored = await save_upload(file, f"evidence/{cid}", max_mb, ALLOWED)
    kind = _guess_type(stored.extension, evidence_type)
    processable = stored.extension in (IMAGE_EXTENSIONS | TEXT_EXTENSIONS | AUDIO_VIDEO_EXTENSIONS | {"pdf"})
    evidence = EvidenceRepository(db).create(Evidence(
        case_id=cid, label=label.strip() or stored.original_filename, evidence_type=kind,
        original_filename=stored.original_filename, content_type=stored.content_type, size_bytes=stored.size_bytes,
        sha256=stored.sha256, uploaded_by=user.id, processing_status="queued" if processable else "skipped",
        processing_error=None if processable else f"Automatic text extraction isn't available for .{stored.extension} files.",
    ), stored.path)
    audit(db, request, user, "evidence.uploaded", "evidence", evidence.id,
          {"case_id": str(cid), "sha256": stored.sha256, "size": stored.size_bytes, "file": stored.original_filename})
    audit(db, request, user, "case.evidence_added", "case", cid, {"evidence_id": str(evidence.id), "label": evidence.label})
    db.commit()
    mode = dispatch("process_evidence", str(evidence.id)) if processable else None
    data = evidence.model_dump(mode="json")
    data["processing_mode"] = mode
    return data


@router.get("/evidence/{evidence_id}")
def get_evidence(evidence_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    return _evidence_or_404(db, evidence_id).model_dump(mode="json")


@router.get("/evidence/{evidence_id}/text")
def get_evidence_text(evidence_id: str, request: Request, db: Session = Depends(get_db),
                      user: UserAccount = Depends(require_role(*STAFF))):
    ev = _evidence_or_404(db, evidence_id)
    doc = None
    if mongo_probe.available():
        try:
            doc = EvidenceTextRepository(get_mongo_db()).get(str(ev.id))
        except Exception as exc:
            mongo_probe.mark_down(exc)
    if doc is None:
        row = EvidenceRepository(db).row(ev.id)
        doc = {"text": row.ocr_text_fallback or "", "entities": [], "charges": [], "meta": {}}
    audit(db, request, user, "evidence.text_viewed", "evidence", ev.id)
    return {"evidence_id": str(ev.id), "text": doc.get("text", ""), "entities": doc.get("entities", []),
            "charges": doc.get("charges", []), "meta": doc.get("meta", {})}


@router.get("/evidence/{evidence_id}/file")
def download_evidence(evidence_id: str, request: Request, db: Session = Depends(get_db),
                      user: UserAccount = Depends(require_role(*STAFF))):
    ev = _evidence_or_404(db, evidence_id)
    row = EvidenceRepository(db).row(ev.id)
    path = resolve_stored(row.storage_path)
    if path is None:
        raise HTTPException(410, "The stored file is missing. This has been recorded in the audit log.")
    audit(db, request, user, "evidence.downloaded", "evidence", ev.id)
    db.commit()
    return FileResponse(path, media_type=ev.content_type, filename=ev.original_filename,
                        content_disposition_type="inline")


@router.post("/evidence/{evidence_id}/verify-integrity")
def verify_integrity(evidence_id: str, request: Request, db: Session = Depends(get_db),
                     user: UserAccount = Depends(require_role(*STAFF))):
    ev = _evidence_or_404(db, evidence_id)
    path = resolve_stored(EvidenceRepository(db).row(ev.id).storage_path)
    if path is None:
        result = {"intact": False, "reason": "Stored file is missing."}
    else:
        current = sha256_of_file(str(path))
        result = {"intact": current == ev.sha256, "stored_sha256": ev.sha256, "current_sha256": current}
    audit(db, request, user, "evidence.integrity_checked", "evidence", ev.id, result)
    return result


@router.post("/evidence/{evidence_id}/reprocess")
def reprocess(evidence_id: str, request: Request, db: Session = Depends(get_db),
              user: UserAccount = Depends(require_role(*EVIDENCE_SUBMITTERS))):
    ev = _evidence_or_404(db, evidence_id)
    EvidenceRepository(db).update(ev.id, processing_status="queued", processing_error=None)
    audit(db, request, user, "evidence.reprocess_requested", "evidence", ev.id)
    db.commit()
    return {"processing_status": "queued", "mode": dispatch("process_evidence", str(ev.id))}


class ReviewRequest(BaseModel):
    review_status: str = Field(pattern=r"^(reviewed|flagged|pending_review)$")
    note: Optional[str] = Field(default=None, max_length=4000)


@router.post("/evidence/{evidence_id}/review")
def review_evidence(evidence_id: str, req: ReviewRequest, request: Request, db: Session = Depends(get_db),
                    user: UserAccount = Depends(require_role(*STAFF))):
    ev = _evidence_or_404(db, evidence_id)
    updated = EvidenceRepository(db).update(
        ev.id, review_status=req.review_status, review_note=req.note, reviewed_by=user.id,
        reviewed_at=datetime.now(timezone.utc),
    )
    audit(db, request, user, f"evidence.{req.review_status}", "evidence", ev.id, {"note": (req.note or "")[:300]})
    return updated.model_dump(mode="json")


@router.post("/evidence/{evidence_id}/signature-check")
async def signature_check(evidence_id: str, request: Request, reference: Optional[UploadFile] = File(default=None),
                          db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*EVIDENCE_SUBMITTERS))):
    ev = _evidence_or_404(db, evidence_id)
    row = EvidenceRepository(db).row(ev.id)
    path = resolve_stored(row.storage_path)
    ext = path.suffix.lower().lstrip(".") if path else ""
    if path is None or ext not in (IMAGE_EXTENSIONS | {"pdf"}):
        raise HTTPException(422, "Signature checks work on scanned documents (images or PDF).")
    ref_path = None
    try:
        if reference is not None and reference.filename:
            stored = await save_upload(reference, "tmp", 15, IMAGE_EXTENSIONS | {"pdf"})
            ref_path = stored.path
        try:
            result = verify_signature(str(path), ref_path)
        except Exception as exc:
            raise HTTPException(422, f"The document image couldn't be analysed ({type(exc).__name__}).")
    finally:
        if ref_path:
            Path(ref_path).unlink(missing_ok=True)
    updated = EvidenceRepository(db).update(ev.id, signature_check=result.model_dump(mode="json"))
    audit(db, request, user, "evidence.signature_checked", "evidence", ev.id,
          {"present": result.signature_present, "score": result.match_score})
    return updated.model_dump(mode="json")


@router.get("/evidence/{evidence_id}/custody")
def custody_log(evidence_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    ev = _evidence_or_404(db, evidence_id)
    entries, _ = AuditRepository(db).search(entity_type="evidence", entity_id=str(ev.id), limit=500)
    return [e.model_dump(mode="json") for e in entries]


# ---------------------------------------------------------------------------
# One-off document tools (no case attached): quick OCR and signature check.
# Temporary files are always deleted.
# ---------------------------------------------------------------------------

@router.post("/documents/ocr")
async def ocr_document(file: UploadFile = File(...), user: UserAccount = Depends(require_role(*EVIDENCE_SUBMITTERS))):
    stored = await save_upload(file, "tmp", settings.max_document_mb, IMAGE_EXTENSIONS | TEXT_EXTENSIONS | {"pdf"})
    try:
        extracted = extract_text(stored.path, stored.extension)
        return {"text": extracted.text, "confidence": extracted.mean_confidence, "method": extracted.method,
                "pages": extracted.page_count, "warnings": extracted.warnings}
    except Exception as exc:
        raise HTTPException(422, f"Couldn't read that document ({type(exc).__name__}).")
    finally:
        Path(stored.path).unlink(missing_ok=True)


@router.post("/documents/verify-signature")
async def verify_signature_endpoint(document: UploadFile = File(...), reference: Optional[UploadFile] = File(default=None),
                                    user: UserAccount = Depends(require_role(*EVIDENCE_SUBMITTERS))):
    doc = await save_upload(document, "tmp", 15, IMAGE_EXTENSIONS | {"pdf"})
    ref = None
    try:
        if reference is not None and reference.filename:
            ref = await save_upload(reference, "tmp", 15, IMAGE_EXTENSIONS | {"pdf"})
        try:
            return verify_signature(doc.path, ref.path if ref else None).model_dump(mode="json")
        except Exception as exc:
            raise HTTPException(422, f"The image couldn't be analysed ({type(exc).__name__}).")
    finally:
        Path(doc.path).unlink(missing_ok=True)
        if ref:
            Path(ref.path).unlink(missing_ok=True)
