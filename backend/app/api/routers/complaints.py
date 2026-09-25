"""
Module 1 (Complaint Management) + Module 11 (Citizen Portal).

Public (no account): file a complaint, track it with reference number +
tracking code. Staff: triage list, AI suggestion review, status updates,
open a case from a complaint.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.agents.prioritization_agent import score_case
from app.api.deps import CASE_BUILDERS, audit, client_ip, parse_uuid_or_404, require_role
from app.core import ratelimit
from app.core.config import get_settings
from app.core.security import hash_tracking_code, new_tracking_code, tracking_code_matches
from app.db.base import get_db
from app.db.neo4j_repository import safe_graph_call
from app.db.postgres_repository import CaseRepository, ComplaintRepository, PersonRepository
from app.models.auth_models import UserAccount
from app.models.schemas import Case, CaseType, Complaint, ComplaintStatus, HearingRole, Person
from app.services.indexing import index_case, index_complaint
from app.tasks import dispatch

router = APIRouter(tags=["complaints"])
settings = get_settings()


class ComplaintCreate(BaseModel):
    case_type: CaseType
    description: str = Field(min_length=20, max_length=8000)
    location: Optional[str] = Field(default=None, max_length=300)
    complainant_name: Optional[str] = Field(default=None, max_length=200)
    complainant_phone: Optional[str] = Field(default=None, max_length=40)
    complainant_email: Optional[str] = Field(default=None, max_length=254)
    preferred_language: Optional[str] = Field(default=None, pattern=r"^(ar|en)$")

    @field_validator("description")
    @classmethod
    def _described(cls, v):
        # min_length counts spaces, so 20 spaces would otherwise be a complaint.
        if len(v.strip()) < 20:
            raise ValueError("Please describe what happened in at least 20 characters.")
        return v.strip()

    @field_validator("complainant_email")
    @classmethod
    def _email(cls, v):
        if v is None or not v.strip():
            return None
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", v.strip()):
            raise ValueError("Enter a valid email address.")
        return v.strip()

    @field_validator("complainant_phone")
    @classmethod
    def _phone(cls, v):
        if v and not re.fullmatch(r"[+\d][\d\s\-()]{6,39}", v.strip()):
            raise ValueError("Enter a valid phone number.")
        return v.strip() if v else v


PUBLIC_STATUS_TEXT = {
    "received": "Received -- waiting for review",
    "under_review": "Under review by a case officer",
    "case_opened": "A case has been opened",
    "resolved": "Resolved",
    "rejected": "Closed without further action",
    "duplicate": "Merged with an earlier complaint",
}


@router.post("/complaints", status_code=201)
def submit_complaint(payload: ComplaintCreate, request: Request, db: Session = Depends(get_db)):
    """Public Citizen Portal intake -- no auth, rate-limited per IP."""
    if not ratelimit.hit(f"complaint:{client_ip(request)}", settings.public_complaints_per_hour, 3600):
        raise HTTPException(status_code=429, detail="Too many complaints from this connection. Please try again later.")

    code = new_tracking_code()
    complaint = Complaint(
        submitted_by=uuid4(),
        case_type=payload.case_type,
        description=payload.description.strip(),
        location=(payload.location or "").strip() or None,
        complainant_name=(payload.complainant_name or "").strip() or None,
        complainant_phone=payload.complainant_phone,
        complainant_email=payload.complainant_email,
        preferred_language=payload.preferred_language,
    )
    created = ComplaintRepository(db).create(complaint, tracking_code_hash=hash_tracking_code(code))
    audit(db, request, None, "complaint.submitted", "complaint", created.id, {"reference": created.reference_number})
    db.commit()

    index_complaint(created)
    dispatch("classify_complaint", str(created.id))
    return {
        "id": str(created.id),
        "reference_number": created.reference_number,
        "tracking_code": code,
        "status": created.status.value,
        "status_text": PUBLIC_STATUS_TEXT[created.status.value],
        "submitted_at": created.submitted_at,
    }


class TrackRequest(BaseModel):
    reference: str = Field(min_length=6, max_length=32)
    code: str = Field(min_length=6, max_length=16)


@router.post("/complaints/track")
def track_complaint(req: TrackRequest, request: Request, db: Session = Depends(get_db)):
    """
    Public status lookup. Needs both the reference and the tracking code; no
    internal notes are exposed. POST so the tracking code never lands in URLs
    or access logs.
    """
    if not ratelimit.hit(f"track:{client_ip(request)}", 30, 600):
        raise HTTPException(status_code=429, detail="Too many lookups. Please wait a few minutes.")
    repo = ComplaintRepository(db)
    row = repo.get_row_by_reference(req.reference.strip().upper())
    if row is None or not tracking_code_matches(req.code.strip(), row.tracking_code_hash):
        raise HTTPException(status_code=404, detail="No complaint matches that reference number and tracking code.")
    complaint = repo.get(row.id)
    case_number = None
    if complaint.case_id:
        case = CaseRepository(db).get(complaint.case_id)
        case_number = case.case_number if case else None
    return {
        "reference_number": complaint.reference_number,
        "status": complaint.status.value,
        "status_text": PUBLIC_STATUS_TEXT.get(complaint.status.value, complaint.status.value),
        "case_type": complaint.case_type.value,
        "submitted_at": complaint.submitted_at,
        "updated_at": complaint.updated_at,
        "assigned_department": complaint.assigned_department,
        "case_number": case_number,
    }


@router.get("/complaints")
def list_complaints(
    status: Optional[ComplaintStatus] = None,
    case_type: Optional[CaseType] = None,
    q: Optional[str] = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*CASE_BUILDERS)),
):
    items, total = ComplaintRepository(db).search(status=status, case_type=case_type, q=q, limit=limit, offset=offset)
    return {"items": [c.model_dump(mode="json") for c in items], "total": total}


@router.get("/complaints/{complaint_id}")
def get_complaint(complaint_id: str, db: Session = Depends(get_db),
                  _user: UserAccount = Depends(require_role(*CASE_BUILDERS))):
    complaint = ComplaintRepository(db).get(parse_uuid_or_404(complaint_id, "Complaint"))
    if not complaint:
        raise HTTPException(404, "Complaint not found.")
    return complaint.model_dump(mode="json")


class ComplaintUpdate(BaseModel):
    status: Optional[ComplaintStatus] = None
    assigned_department: Optional[str] = Field(default=None, max_length=128)
    staff_notes: Optional[str] = Field(default=None, max_length=8000)
    case_type: Optional[CaseType] = None


@router.patch("/complaints/{complaint_id}")
def update_complaint(complaint_id: str, req: ComplaintUpdate, request: Request, db: Session = Depends(get_db),
                     user: UserAccount = Depends(require_role(*CASE_BUILDERS))):
    cid = parse_uuid_or_404(complaint_id, "Complaint")
    fields = req.model_dump(exclude_unset=True)
    if fields.get("status") == ComplaintStatus.CASE_OPENED:
        raise HTTPException(400, "Use 'Open case' to move a complaint to case_opened.")
    if fields.get("case_type") is not None:
        fields["category_confirmed"] = True  # staff's decision -> classifier learns from it
    updated = ComplaintRepository(db).update(cid, **fields)
    if not updated:
        raise HTTPException(404, "Complaint not found.")
    audit(db, request, user, "complaint.updated", "complaint", cid, req.model_dump(exclude_unset=True, mode="json"))
    db.commit()
    index_complaint(updated)
    return updated.model_dump(mode="json")


@router.post("/complaints/{complaint_id}/reclassify")
def reclassify(complaint_id: str, request: Request, db: Session = Depends(get_db),
               user: UserAccount = Depends(require_role(*CASE_BUILDERS))):
    cid = parse_uuid_or_404(complaint_id, "Complaint")
    if not ComplaintRepository(db).update(cid, ai_status="pending"):
        raise HTTPException(404, "Complaint not found.")
    audit(db, request, user, "complaint.reclassify_requested", "complaint", cid)
    db.commit()
    return {"status": "pending", "mode": dispatch("classify_complaint", str(cid))}


class OpenCaseRequest(BaseModel):
    title: str = Field(min_length=4, max_length=500)
    case_type: Optional[CaseType] = None
    statutory_deadline: Optional[date] = None
    add_complainant_as: Optional[HearingRole] = HearingRole.PLAINTIFF


@router.post("/complaints/{complaint_id}/open-case", status_code=201)
def open_case_from_complaint(complaint_id: str, req: OpenCaseRequest, request: Request,
                             db: Session = Depends(get_db),
                             user: UserAccount = Depends(require_role(*CASE_BUILDERS))):
    cid = parse_uuid_or_404(complaint_id, "Complaint")
    complaints = ComplaintRepository(db)
    complaint = complaints.get(cid)
    if not complaint:
        raise HTTPException(404, "Complaint not found.")
    if complaint.case_id:
        raise HTTPException(409, "A case has already been opened for this complaint.")

    case_type = req.case_type or complaint.case_type
    case_repo = CaseRepository(db)
    case = case_repo.create(Case(
        case_number="", case_type=case_type, title=req.title.strip(),
        description=f"Opened from citizen complaint {complaint.reference_number}.\n\n{complaint.description}",
        statutory_deadline=req.statutory_deadline, source_complaint_id=complaint.id,
    ))
    signals = {"case_id": str(case.id), "case_opened_on": complaint.submitted_at.date().isoformat(),
               "statutory_deadline": req.statutory_deadline.isoformat() if req.statutory_deadline else None,
               "public_safety_flag": complaint.ai_priority_level == "high", "vulnerable_victim": False,
               "missing_critical_evidence": False}
    case = case_repo.update_priority(case.id, score_case(signals), signals)

    party_names = []
    if complaint.complainant_name and req.add_complainant_as:
        person = PersonRepository(db).create(Person(
            full_name=complaint.complainant_name, role_in_case=req.add_complainant_as,
            contact_phone=complaint.complainant_phone, preferred_language=complaint.preferred_language or "ar",
        ))
        case_repo.add_party(case.id, person.id, req.add_complainant_as.value)
        party_names.append(person.full_name)
        safe_graph_call("link_person_to_case", person.id, case.id, req.add_complainant_as.value,
                        person.full_name, case.case_number)

    complaints.update(cid, status=ComplaintStatus.CASE_OPENED, case_id=case.id, case_type=case_type,
                      category_confirmed=True)
    audit(db, request, user, "case.created_from_complaint", "case", case.id,
          {"complaint": complaint.reference_number, "case_number": case.case_number})
    db.commit()

    safe_graph_call("link_complaint_to_case", complaint.id, case.id)
    index_case(case_repo.get(case.id), party_names)
    updated_complaint = complaints.get(cid)
    if updated_complaint:
        index_complaint(updated_complaint)
    return {"case": case_repo.get(case.id).model_dump(mode="json")}
