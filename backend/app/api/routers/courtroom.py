"""
Courtroom stand -- "single camera, one person at a time".

Flow: clerk opens (or resumes) the session for a scheduled hearing -> calls a
party to the stand (identity confirmed by the clerk; face verification is a
consented 1:1 plug-in point that falls back to manual confirmation) -> the
browser records the microphone (and camera, if present), streaming short
audio chunks for a live transcript -> step down closes the statement -> the
full recording uploads and is transcribed again at full quality.

Nothing here analyzes expression, tone, or affect. See docs/DESIGN_DECISIONS.md.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agents.courtroom_session import next_sequence_number, verify_identity
from app.api.deps import COURTROOM_STAFF, STAFF, audit, get_mongo, parse_uuid_or_404, require_role
from app.api.routers.cases import NewPerson, create_person_from
from app.core.config import get_settings
from app.core.storage import resolve_stored, save_upload
from app.db.base import get_db
from app.db.mongo_repository import SessionRepository, StatementRepository
from app.db.neo4j_repository import safe_graph_call
from app.db.postgres_repository import CaseRepository, HearingRepository, PersonRepository
from app.ingestion.document_processing import AUDIO_VIDEO_EXTENSIONS
from app.models.auth_models import UserAccount
from app.models.schemas import (
    CaseStatus, CourtroomSession, HearingRole, HearingStatus, IdentityVerificationStatus, StatementRecord,
)
from app.services.indexing import index_statement
from app.stt import transcription
from app.tasks import dispatch

router = APIRouter(prefix="/courtroom", tags=["courtroom"])
settings = get_settings()


def _statement_view(s: StatementRecord) -> dict:
    return s.model_dump(mode="json", exclude={"recording_path"}) | {"has_recording": bool(s.recording_path)}


def _session_view(mongo, session: CourtroomSession) -> dict:
    statements = StatementRepository(mongo).list_for_hearing(str(session.hearing_id))
    statements = [s for s in statements if s.session_id in (None, session.id)] or statements
    active = next((s for s in statements if s.id == session.active_statement_id), None)
    return {
        "session": session.model_dump(mode="json"),
        "active_statement": _statement_view(active) if active else None,
        "statements": [_statement_view(s) for s in statements if s.id != session.active_statement_id],
        "stt": transcription.status(),
    }


@router.post("/hearings/{hearing_id}/session")
def open_or_resume_session(hearing_id: str, request: Request, db: Session = Depends(get_db), mongo=Depends(get_mongo),
                           user: UserAccount = Depends(require_role(*COURTROOM_STAFF))):
    hid = parse_uuid_or_404(hearing_id, "Hearing")
    hearing = HearingRepository(db).get(hid)
    if not hearing:
        raise HTTPException(404, "Hearing not found.")
    if hearing.status == HearingStatus.CANCELLED:
        raise HTTPException(409, "This hearing was cancelled.")
    repo = SessionRepository(mongo)
    session = repo.active_for_hearing(str(hid))
    if session is None:
        session = CourtroomSession(hearing_id=hid, case_id=hearing.case_id, opened_by=user.id)
        repo.upsert(session)
        HearingRepository(db).update(hid, status=HearingStatus.IN_PROGRESS)
        case = CaseRepository(db).get(hearing.case_id)
        if case and case.status in (CaseStatus.INTAKE, CaseStatus.UNDER_INVESTIGATION, CaseStatus.READY_FOR_HEARING):
            CaseRepository(db).update(case.id, status=CaseStatus.IN_HEARING)
        audit(db, request, user, "courtroom.session_opened", "case", hearing.case_id,
              {"hearing_id": str(hid), "session_id": str(session.id)})
    return _session_view(mongo, session)


@router.get("/sessions/{session_id}")
def get_session_state(session_id: str, mongo=Depends(get_mongo), _user: UserAccount = Depends(require_role(*STAFF))):
    session = SessionRepository(mongo).get(session_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    return _session_view(mongo, session)


class CallToStandRequest(BaseModel):
    role: HearingRole
    person_id: Optional[UUID] = None
    new_person: Optional[NewPerson] = None
    identity_confirmed_by_clerk: bool = True


@router.post("/sessions/{session_id}/call-to-stand")
def call_to_stand(session_id: str, req: CallToStandRequest, request: Request, db: Session = Depends(get_db),
                  mongo=Depends(get_mongo), user: UserAccount = Depends(require_role(*COURTROOM_STAFF))):
    session_repo, statement_repo = SessionRepository(mongo), StatementRepository(mongo)
    session = session_repo.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    if session.session_closed_at:
        raise HTTPException(409, "This session has been closed.")
    if session.active_statement_id:
        active = statement_repo.get(str(session.active_statement_id))
        raise HTTPException(409, f"{(active.person_name if active else None) or 'Someone'} is still at the stand. Step them down first.")

    if req.person_id:
        person = PersonRepository(db).get(req.person_id)
        if not person:
            raise HTTPException(404, "Person not found.")
    elif req.new_person:
        person = create_person_from(db, req.new_person, req.role)
    else:
        raise HTTPException(422, "Choose a party or enter the person's details.")

    case_id = session.case_id
    if case_id is None:
        hearing = HearingRepository(db).get(session.hearing_id)
        case_id = hearing.case_id if hearing else None
    if case_id:
        case = CaseRepository(db).add_party(case_id, person.id, req.role.value)
        if case:
            safe_graph_call("link_person_to_case", person.id, case_id, req.role.value, person.full_name, case.case_number)

    # Face verification needs a consented reference photo on file; otherwise the
    # clerk's manual confirmation is the (correct) path.
    status, _score = verify_identity(live_frame=None, reference_embedding=None)
    if req.identity_confirmed_by_clerk or not person.reference_photo_on_file:
        status = IdentityVerificationStatus.MANUAL_CONFIRM

    statement = StatementRecord(
        hearing_id=session.hearing_id, case_id=case_id, session_id=session.id, person_id=person.id,
        person_name=person.full_name, role=req.role, identity_verification=status,
        started_at=datetime.utcnow(), sequence_number=next_sequence_number(session),
        transcript_status="live",
    )
    statement_repo.upsert(statement)
    session.active_statement_id = statement.id
    session_repo.upsert(session)
    audit(db, request, user, "courtroom.called_to_stand", "case", case_id,
          {"person": person.full_name, "role": req.role.value, "statement_id": str(statement.id)})
    return _session_view(mongo, session)


@router.post("/statements/{statement_id}/live-chunk")
async def live_chunk(statement_id: str, seq: int = Form(..., ge=0, le=100000), language: Optional[str] = Form(default=None),
                     audio: UploadFile = File(...), mongo=Depends(get_mongo),
                     _user: UserAccount = Depends(require_role(*COURTROOM_STAFF))):
    """A few seconds of microphone audio -> transcribed text appended to the live transcript."""
    repo = StatementRepository(mongo)
    statement = repo.get(statement_id)
    if not statement:
        raise HTTPException(404, "Statement not found.")
    if statement.ended_at:
        return {"seq": seq, "text": "", "ignored": True}
    if not transcription.available():
        return {"seq": seq, "text": "", "stt_available": False}
    stored = await save_upload(audio, "tmp", 20, AUDIO_VIDEO_EXTENSIONS | {"bin", ""})
    try:
        result = await run_in_threadpool(transcription.transcribe_file, stored.path, language, True)
    except Exception as exc:
        return {"seq": seq, "text": "", "stt_available": transcription.available(), "error": type(exc).__name__}
    finally:
        Path(stored.path).unlink(missing_ok=True)
    text = result["text"].strip()
    if text:
        repo.append_segment(statement_id, {"seq": seq, "text": text, "language": result["language"],
                                           "received_at": datetime.utcnow().isoformat()})
    return {"seq": seq, "text": text, "language": result["language"], "stt_available": True}


class StepDownRequest(BaseModel):
    transcript: Optional[str] = Field(default=None, max_length=500_000)


@router.post("/sessions/{session_id}/step-down")
def step_down(session_id: str, req: StepDownRequest, request: Request, db: Session = Depends(get_db),
              mongo=Depends(get_mongo), user: UserAccount = Depends(require_role(*COURTROOM_STAFF))):
    session_repo, statement_repo = SessionRepository(mongo), StatementRepository(mongo)
    session = session_repo.get(session_id)
    if not session or not session.active_statement_id:
        raise HTTPException(409, "No one is currently at the stand in this session.")
    statement = statement_repo.get(str(session.active_statement_id))
    if statement is None:
        session.active_statement_id = None
        session_repo.upsert(session)
        raise HTTPException(409, "The active statement record was missing; the stand has been cleared.")

    live_text = " ".join(seg.text for seg in sorted(statement.live_segments, key=lambda s: s.seq)).strip()
    statement.ended_at = datetime.utcnow()
    if req.transcript is not None and req.transcript.strip() and req.transcript.strip() != live_text:
        statement.transcript, statement.transcript_source = req.transcript.strip(), "edited"
    elif live_text:
        statement.transcript, statement.transcript_source = live_text, "live"
    statement.transcript_status = "done" if statement.transcript else "none"
    statement_repo.upsert(statement)

    session.statements.append(statement.id)
    session.active_statement_id = None
    session_repo.upsert(session)
    audit(db, request, user, "courtroom.stepped_down", "case", statement.case_id,
          {"statement_id": str(statement.id), "person": statement.person_name,
           "duration_seconds": int((statement.ended_at - statement.started_at).total_seconds()) if statement.started_at else None})
    if statement.transcript:
        index_statement(statement)
        dispatch("summarize_statement", str(statement.id))
    return _session_view(mongo, session)


@router.post("/statements/{statement_id}/recording")
async def upload_recording(statement_id: str, request: Request, recording: UploadFile = File(...),
                           db: Session = Depends(get_db), mongo=Depends(get_mongo),
                           user: UserAccount = Depends(require_role(*COURTROOM_STAFF))):
    repo = StatementRepository(mongo)
    statement = repo.get(statement_id)
    if not statement:
        raise HTTPException(404, "Statement not found.")
    stored = await save_upload(recording, f"recordings/{statement.hearing_id}", settings.max_recording_mb,
                               AUDIO_VIDEO_EXTENSIONS)
    is_video = (stored.content_type or "").startswith("video/")
    repo.col.update_one({"_id": statement_id}, {"$set": {
        "recording_path": stored.path, "recording_content_type": stored.content_type,
        "recording_size_bytes": stored.size_bytes, "recording_sha256": stored.sha256,
        "video_uri" if is_video else "audio_uri": f"lexintel://statements/{statement_id}/recording",
        "transcript_status": "queued" if transcription.available() else (statement.transcript_status or "none"),
    }})
    audit(db, request, user, "courtroom.recording_uploaded", "case", statement.case_id,
          {"statement_id": statement_id, "sha256": stored.sha256, "size": stored.size_bytes})
    db.commit()
    mode = dispatch("finalize_statement", statement_id)
    return {"statement_id": statement_id, "size_bytes": stored.size_bytes, "sha256": stored.sha256, "mode": mode}


@router.get("/statements/{statement_id}")
def get_statement(statement_id: str, mongo=Depends(get_mongo), _user: UserAccount = Depends(require_role(*STAFF))):
    statement = StatementRepository(mongo).get(statement_id)
    if not statement:
        raise HTTPException(404, "Statement not found.")
    return _statement_view(statement)


@router.get("/statements/{statement_id}/recording")
def download_recording(statement_id: str, request: Request, db: Session = Depends(get_db), mongo=Depends(get_mongo),
                       user: UserAccount = Depends(require_role(*STAFF))):
    statement = StatementRepository(mongo).get(statement_id)
    if not statement:
        raise HTTPException(404, "Statement not found.")
    path = resolve_stored(statement.recording_path)
    if path is None:
        raise HTTPException(404, "No recording is stored for this statement.")
    audit(db, request, user, "courtroom.recording_viewed", "case", statement.case_id, {"statement_id": statement_id})
    db.commit()
    return FileResponse(path, media_type=statement.recording_content_type or "application/octet-stream",
                        filename=f"statement-{statement.sequence_number}{path.suffix}", content_disposition_type="inline")


class TranscriptEdit(BaseModel):
    transcript: str = Field(max_length=500_000)


@router.patch("/statements/{statement_id}")
def edit_transcript(statement_id: str, req: TranscriptEdit, request: Request, db: Session = Depends(get_db),
                    mongo=Depends(get_mongo), user: UserAccount = Depends(require_role(*COURTROOM_STAFF))):
    repo = StatementRepository(mongo)
    statement = repo.get(statement_id)
    if not statement:
        raise HTTPException(404, "Statement not found.")
    repo.col.update_one({"_id": statement_id}, {"$set": {
        "transcript": req.transcript.strip(), "transcript_source": "edited", "transcript_status": "done",
    }})
    audit(db, request, user, "courtroom.transcript_edited", "case", statement.case_id,
          {"statement_id": statement_id, "length": len(req.transcript)})
    db.commit()
    updated = repo.get(statement_id)
    if updated and updated.transcript:
        index_statement(updated)
        dispatch("summarize_statement", statement_id)
    return _statement_view(updated)


@router.post("/sessions/{session_id}/close")
def close_session(session_id: str, request: Request, db: Session = Depends(get_db), mongo=Depends(get_mongo),
                  user: UserAccount = Depends(require_role(*COURTROOM_STAFF))):
    repo = SessionRepository(mongo)
    session = repo.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    if session.active_statement_id:
        raise HTTPException(409, "Step the current person down before closing the session.")
    session.session_closed_at = datetime.utcnow()
    repo.upsert(session)
    HearingRepository(db).update(session.hearing_id, status=HearingStatus.COMPLETED)
    audit(db, request, user, "courtroom.session_closed", "case", session.case_id,
          {"session_id": session_id, "statements": len(session.statements)})
    return _session_view(mongo, session)


@router.get("/stt-status")
def stt_status(_user: UserAccount = Depends(require_role(*STAFF))):
    return transcription.status()
