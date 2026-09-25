"""
Module 7 (court scheduling): hearings with courtroom/judge conflict detection,
plus the people registry used by case parties and the courtroom stand.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import CASE_EDITORS, SCHEDULERS, STAFF, audit, parse_uuid_or_404, require_role
from app.db.base import get_db
from app.db.postgres_repository import CaseRepository, HearingRepository, PersonRepository, UserRepository
from app.models.auth_models import SystemRole, UserAccount
from app.models.schemas import CaseStatus, Hearing, HearingStatus
from app.services.indexing import index_person

router = APIRouter(tags=["scheduling"])

UAE_TZ = timezone(timedelta(hours=4))


def _enrich(db: Session, hearings: list[Hearing]) -> list[dict]:
    case_repo, user_repo = CaseRepository(db), UserRepository(db)
    cases: dict = {}
    judges: dict = {}
    out = []
    for h in hearings:
        if h.case_id not in cases:
            cases[h.case_id] = case_repo.get(h.case_id)
        if h.presiding_judge_id and h.presiding_judge_id not in judges:
            judges[h.presiding_judge_id] = user_repo.get(h.presiding_judge_id)
        case = cases[h.case_id]
        judge = judges.get(h.presiding_judge_id) if h.presiding_judge_id else None
        data = h.model_dump(mode="json")
        data.update(
            case_number=case.case_number if case else None,
            case_title=case.title if case else None,
            case_type=case.case_type.value if case else None,
            judge_name=judge.full_name if judge else None,
            ends_at=(h.scheduled_at + timedelta(minutes=h.duration_minutes)).isoformat(),
        )
        out.append(data)
    return out


def _conflict_detail(db: Session, conflicts: list[Hearing]) -> dict:
    return {
        "message": "This time overlaps another hearing in the same courtroom or with the same judge.",
        "conflicts": _enrich(db, conflicts),
    }


@router.get("/hearings")
def list_hearings(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    day: Optional[date] = None,
    case_id: Optional[UUID] = None,
    courtroom: Optional[str] = Query(default=None, max_length=64),
    status: Optional[HearingStatus] = None,
    mine: bool = False,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*STAFF)),
):
    if day:
        start = datetime.combine(day, time.min, tzinfo=UAE_TZ)
        end = start + timedelta(days=1)
    judge_id = user.id if mine and user.role == SystemRole.JUDGE else None
    hearings = HearingRepository(db).search(start=start, end=end, case_id=case_id, courtroom=courtroom,
                                            status=status, judge_id=judge_id)
    return _enrich(db, hearings)


class HearingCreate(BaseModel):
    case_id: UUID
    scheduled_at: datetime
    duration_minutes: int = Field(default=60, ge=5, le=600)
    hearing_type: Optional[str] = Field(default=None, max_length=64)
    courtroom: Optional[str] = Field(default=None, max_length=64)
    presiding_judge_id: Optional[UUID] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    force: bool = False


def _validate_judge(db: Session, judge_id: Optional[UUID]) -> None:
    if judge_id:
        judge = UserRepository(db).get(judge_id)
        if not judge or judge.role != SystemRole.JUDGE or not judge.is_active:
            raise HTTPException(422, "The presiding judge must be an active judge account.")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UAE_TZ)


@router.post("/hearings", status_code=201)
def create_hearing(payload: HearingCreate, request: Request, db: Session = Depends(get_db),
                   user: UserAccount = Depends(require_role(*SCHEDULERS))):
    case = CaseRepository(db).get(payload.case_id)
    if not case:
        raise HTTPException(404, "Case not found.")
    _validate_judge(db, payload.presiding_judge_id)
    scheduled_at = _aware(payload.scheduled_at)
    repo = HearingRepository(db)
    conflicts = repo.conflicts(scheduled_at, payload.duration_minutes, payload.courtroom, payload.presiding_judge_id)
    if conflicts and not payload.force:
        raise HTTPException(409, _conflict_detail(db, conflicts))
    hearing = repo.create(Hearing(
        case_id=case.id, scheduled_at=scheduled_at, duration_minutes=payload.duration_minutes,
        hearing_type=payload.hearing_type, courtroom=(payload.courtroom or "").strip() or None,
        presiding_judge_id=payload.presiding_judge_id or case.assigned_judge_id, notes=payload.notes,
    ))
    if case.status in (CaseStatus.INTAKE, CaseStatus.UNDER_INVESTIGATION):
        CaseRepository(db).update(case.id, status=CaseStatus.READY_FOR_HEARING)
    audit(db, request, user, "hearing.scheduled", "case", case.id,
          {"hearing_id": str(hearing.id), "at": scheduled_at.isoformat(), "forced": bool(conflicts)})
    return _enrich(db, [hearing])[0]


class HearingUpdate(BaseModel):
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = Field(default=None, ge=5, le=600)
    hearing_type: Optional[str] = Field(default=None, max_length=64)
    courtroom: Optional[str] = Field(default=None, max_length=64)
    presiding_judge_id: Optional[UUID] = None
    status: Optional[HearingStatus] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    force: bool = False


@router.get("/hearings/{hearing_id}")
def get_hearing(hearing_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    hearing = HearingRepository(db).get(parse_uuid_or_404(hearing_id, "Hearing"))
    if not hearing:
        raise HTTPException(404, "Hearing not found.")
    return _enrich(db, [hearing])[0]


@router.patch("/hearings/{hearing_id}")
def update_hearing(hearing_id: str, req: HearingUpdate, request: Request, db: Session = Depends(get_db),
                   user: UserAccount = Depends(require_role(*SCHEDULERS))):
    hid = parse_uuid_or_404(hearing_id, "Hearing")
    repo = HearingRepository(db)
    hearing = repo.get(hid)
    if not hearing:
        raise HTTPException(404, "Hearing not found.")
    fields = req.model_dump(exclude_unset=True, exclude={"force"})
    if "presiding_judge_id" in fields:
        _validate_judge(db, fields["presiding_judge_id"])
    if "scheduled_at" in fields and fields["scheduled_at"]:
        fields["scheduled_at"] = _aware(fields["scheduled_at"])
    if {"scheduled_at", "duration_minutes", "courtroom", "presiding_judge_id"} & set(fields):
        conflicts = repo.conflicts(
            fields.get("scheduled_at", hearing.scheduled_at),
            fields.get("duration_minutes", hearing.duration_minutes),
            fields.get("courtroom", hearing.courtroom),
            fields.get("presiding_judge_id", hearing.presiding_judge_id),
            exclude_id=hid,
        )
        if conflicts and not req.force and fields.get("status") != HearingStatus.CANCELLED:
            raise HTTPException(409, _conflict_detail(db, conflicts))
    updated = repo.update(hid, **fields)
    audit(db, request, user, "hearing.updated", "case", hearing.case_id,
          {"hearing_id": str(hid), **req.model_dump(exclude_unset=True, exclude={"force"}, mode="json")})
    return _enrich(db, [updated])[0]


# ---------------------------------------------------------------------------
# People registry
# ---------------------------------------------------------------------------

@router.get("/people")
def list_people(q: Optional[str] = Query(default=None, max_length=200), db: Session = Depends(get_db),
                _user: UserAccount = Depends(require_role(*STAFF))):
    return [p.model_dump(mode="json") for p in PersonRepository(db).list_all(q=q, limit=100)]


@router.get("/people/{person_id}")
def get_person(person_id: str, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    pid = parse_uuid_or_404(person_id, "Person")
    person = PersonRepository(db).get(pid)
    if not person:
        raise HTTPException(404, "Person not found.")
    data = person.model_dump(mode="json")
    data["cases"] = CaseRepository(db).cases_for_person(pid)
    return data


class PersonCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    emirates_id: Optional[str] = Field(default=None, max_length=24)
    role_in_case: Optional[str] = None
    contact_phone: Optional[str] = Field(default=None, max_length=40)
    preferred_language: str = Field(default="ar", pattern=r"^(ar|en)$")
    case_id: Optional[UUID] = None


@router.post("/people", status_code=201)
def create_person(payload: PersonCreate, request: Request, db: Session = Depends(get_db),
                  user: UserAccount = Depends(require_role(*CASE_EDITORS))):
    from app.api.routers.cases import NewPerson, create_person_from
    from app.db.neo4j_repository import safe_graph_call
    from app.models.schemas import HearingRole

    try:
        role = HearingRole(payload.role_in_case) if payload.role_in_case else HearingRole.WITNESS
    except ValueError:
        raise HTTPException(422, "Unknown role.")
    person = create_person_from(db, NewPerson(full_name=payload.full_name, emirates_id=payload.emirates_id,
                                              contact_phone=payload.contact_phone,
                                              preferred_language=payload.preferred_language), role)
    if payload.case_id:
        case = CaseRepository(db).add_party(payload.case_id, person.id, role.value)
        if not case:
            raise HTTPException(404, "Case not found.")
        safe_graph_call("link_person_to_case", person.id, case.id, role.value, person.full_name, case.case_number)
    audit(db, request, user, "person.created", "person", person.id)
    db.commit()
    index_person(person)
    return person.model_dump(mode="json")


class PersonUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    contact_phone: Optional[str] = Field(default=None, max_length=40)
    preferred_language: Optional[str] = Field(default=None, pattern=r"^(ar|en)$")


@router.patch("/people/{person_id}")
def update_person(person_id: str, req: PersonUpdate, request: Request, db: Session = Depends(get_db),
                  user: UserAccount = Depends(require_role(*CASE_EDITORS))):
    pid = parse_uuid_or_404(person_id, "Person")
    updated = PersonRepository(db).update(pid, **req.model_dump(exclude_unset=True))
    if not updated:
        raise HTTPException(404, "Person not found.")
    audit(db, request, user, "person.updated", "person", pid, req.model_dump(exclude_unset=True))
    db.commit()
    index_person(updated)
    return updated.model_dump(mode="json")
