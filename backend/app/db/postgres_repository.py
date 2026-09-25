"""
Postgres repositories. Each method takes/returns the Pydantic domain models
from app/models/schemas.py -- the ORM layer is an implementation detail
hidden behind these classes.
"""

from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, NamedTuple, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.orm_models import (
    AuditLogORM, CaseORM, CasePartyORM, CaseRulingORM, ComplaintORM, EvidenceORM, HearingORM,
    LawDocumentORM, PersonORM, ResearchNoteORM, TimelineEventORM, UserAccountORM,
)
from app.models.auth_models import SystemRole, UserAccount
from app.models.schemas import (
    AuditEntry, Case, CaseParty, CaseRuling, CaseStatus, CaseType, Complaint, Evidence, Hearing, HearingRole,
    HearingStatus, LawDocument, OPEN_CASE_STATUSES, Person, PriorityAssessment, PriorityLevel, ResearchNote,
    TimelineEvent,
)


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def enum_or_none(enum_cls, value):
    """SAEnum columns store member NAMES, so a raw string like "intake" must be
    turned into the enum member before it reaches a filter or assignment."""
    if value is None or value == "":
        return None
    if isinstance(value, enum_cls):
        return value
    try:
        return enum_cls(str(value).lower())
    except ValueError:
        try:
            return enum_cls[str(value).upper()]
        except KeyError:
            return None


def as_uuid(value: UUID | str | None) -> UUID | None:
    if value is None or value == "":
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------

CASE_PREFIX = {
    CaseType.CRIMINAL: "CR", CaseType.CIVIL: "CV", CaseType.CYBERCRIME: "CY",
    CaseType.TRAFFIC: "TR", CaseType.GRIEVANCE: "GR",
}


def _case_to_pydantic(row: CaseORM) -> Case:
    priority = None
    if row.priority_level is not None:
        priority = PriorityAssessment(
            case_id=row.id,
            level=row.priority_level,
            score=row.priority_score or 0.0,
            factors=row.priority_factors or {},
            explanation=row.priority_explanation or "",
            requires_human_review=row.priority_requires_human_review,
            generated_at=row.priority_updated_at or row.created_at,
        )
    return Case(
        id=row.id,
        case_number=row.case_number,
        case_type=row.case_type,
        status=row.status,
        title=row.title,
        description=row.description,
        parties=[p for p in (as_uuid(x) for x in (row.parties or [])) if p],
        evidence=[e for e in (as_uuid(x) for x in (row.evidence or [])) if e],
        timeline=[
            TimelineEvent(
                id=t.id, case_id=t.case_id, event_date=t.event_date, description=t.description,
                source_document_id=t.source_document_id, source_label=t.source_label,
                entity_type=t.entity_type, created_at=t.created_at,
            )
            for t in row.timeline
        ],
        priority=priority,
        priority_signals=row.priority_signals,
        assigned_judge_id=row.assigned_judge_id,
        source_complaint_id=row.source_complaint_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        closed_at=row.closed_at,
        statutory_deadline=row.statutory_deadline,
    )


class CaseRepository:
    def __init__(self, db: Session):
        self.db = db

    def _row(self, case_id: UUID | str) -> CaseORM | None:
        cid = as_uuid(case_id)
        return self.db.get(CaseORM, cid) if cid else None

    def get(self, case_id: UUID | str) -> Case | None:
        row = self._row(case_id)
        return _case_to_pydantic(row) if row else None

    def get_by_number(self, case_number: str) -> Case | None:
        row = self.db.execute(select(CaseORM).where(CaseORM.case_number == case_number)).scalar_one_or_none()
        return _case_to_pydantic(row) if row else None

    def next_case_number(self, case_type: CaseType) -> str:
        prefix = f"{CASE_PREFIX.get(case_type, 'CS')}-{date.today().year}-"
        existing = self.db.execute(
            select(CaseORM.case_number).where(CaseORM.case_number.like(f"{prefix}%"))
        ).scalars().all()
        highest = 0
        for number in existing:
            tail = number[len(prefix):]
            if tail.isdigit():
                highest = max(highest, int(tail))
        return f"{prefix}{highest + 1:05d}"

    def create(self, case: Case) -> Case:
        for attempt in range(6):
            number = case.case_number or self.next_case_number(case.case_type)
            if attempt > 0 and not case.case_number:
                number = f"{number[:-5]}{int(number[-5:]) + attempt:05d}"
            row = CaseORM(
                id=case.id, case_number=number, case_type=case.case_type, status=case.status,
                title=case.title, description=case.description,
                parties=[str(p) for p in case.parties], evidence=[str(e) for e in case.evidence],
                created_at=_utc(case.created_at), statutory_deadline=case.statutory_deadline,
                assigned_judge_id=case.assigned_judge_id, source_complaint_id=case.source_complaint_id,
                priority_signals=case.priority_signals,
            )
            if case.priority:
                self._apply_priority(row, case.priority)
            try:
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
                return _case_to_pydantic(row)
            except IntegrityError:
                if case.case_number:
                    raise
        raise RuntimeError("Could not allocate a unique case number")

    @staticmethod
    def _apply_priority(row: CaseORM, assessment: PriorityAssessment) -> None:
        row.priority_level = assessment.level
        row.priority_score = assessment.score
        row.priority_factors = assessment.factors
        row.priority_explanation = assessment.explanation
        row.priority_requires_human_review = assessment.requires_human_review
        row.priority_updated_at = datetime.now(timezone.utc)

    def update(self, case_id: UUID | str, **fields: Any) -> Case | None:
        row = self._row(case_id)
        if not row:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        if "status" in fields:
            status = fields["status"]
            if status in (CaseStatus.RESOLVED, CaseStatus.CLOSED) and not row.closed_at:
                row.closed_at = datetime.now(timezone.utc)
            elif status in OPEN_CASE_STATUSES:
                row.closed_at = None
        row.updated_at = datetime.now(timezone.utc)
        self.db.flush()
        return _case_to_pydantic(row)

    def update_priority(self, case_id: UUID | str, assessment: PriorityAssessment, signals: dict | None = None) -> Case | None:
        row = self._row(case_id)
        if not row:
            return None
        self._apply_priority(row, assessment)
        if signals is not None:
            row.priority_signals = signals
        self.db.flush()
        return _case_to_pydantic(row)

    def add_timeline_events(self, case_id: UUID | str, events: list[TimelineEvent]) -> Case | None:
        row = self._row(case_id)
        if not row:
            return None
        seen = {(t.description.strip().lower(), t.event_date) for t in row.timeline}
        for e in events:
            key = (e.description.strip().lower(), e.event_date)
            if not e.description.strip() or key in seen:
                continue
            seen.add(key)
            row.timeline.append(TimelineEventORM(
                id=e.id, case_id=row.id, event_date=e.event_date, description=e.description.strip()[:4000],
                source_document_id=e.source_document_id, source_label=e.source_label,
                entity_type=e.entity_type,
            ))
        self.db.flush()
        return _case_to_pydantic(row)

    def delete_timeline_event(self, case_id: UUID | str, event_id: UUID | str) -> bool:
        cid, eid = as_uuid(case_id), as_uuid(event_id)
        row = self.db.get(TimelineEventORM, eid) if eid else None
        if not row or row.case_id != cid:
            return False
        self.db.delete(row)
        self.db.flush()
        return True

    def list_all(self) -> list[Case]:
        rows = self.db.execute(select(CaseORM).order_by(CaseORM.created_at.desc())).scalars().all()
        return [_case_to_pydantic(r) for r in rows]

    def search(
        self,
        status: Optional[str] = None,
        case_type: Optional[str] = None,
        priority: Optional[str] = None,
        q: Optional[str] = None,
        open_only: bool = False,
        judge_id: Optional[UUID] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> tuple[list[Case], int]:
        stmt = select(CaseORM)
        conds = []
        if enum_or_none(CaseStatus, status):
            conds.append(CaseORM.status == enum_or_none(CaseStatus, status))
        if open_only:
            conds.append(CaseORM.status.in_(list(OPEN_CASE_STATUSES)))
        if enum_or_none(CaseType, case_type):
            conds.append(CaseORM.case_type == enum_or_none(CaseType, case_type))
        if priority == "unscored":
            conds.append(CaseORM.priority_level.is_(None))
        elif enum_or_none(PriorityLevel, priority):
            conds.append(CaseORM.priority_level == enum_or_none(PriorityLevel, priority))
        if judge_id:
            conds.append(CaseORM.assigned_judge_id == judge_id)
        if q:
            like = f"%{q.strip()}%"
            conds.append(or_(CaseORM.title.ilike(like), CaseORM.case_number.ilike(like), CaseORM.description.ilike(like)))
        if conds:
            stmt = stmt.where(and_(*conds))
        total = self.db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
        stmt = stmt.order_by(
            CaseORM.priority_score.desc().nulls_last(), CaseORM.created_at.desc()
        ).limit(limit).offset(offset)
        rows = self.db.execute(stmt).scalars().all()
        return [_case_to_pydantic(r) for r in rows], total

    # --- parties -----------------------------------------------------------

    def add_party(self, case_id: UUID | str, person_id: UUID | str, role: str | None = None) -> Case | None:
        row = self._row(case_id)
        pid = as_uuid(person_id)
        if not row or not pid:
            return None
        person = self.db.get(PersonORM, pid)
        if not person:
            return None
        effective_role = role or (person.role_in_case.value if person.role_in_case else "witness")
        link = self.db.get(CasePartyORM, (row.id, pid))
        if link:
            link.role = effective_role
        else:
            self.db.add(CasePartyORM(case_id=row.id, person_id=pid, role=effective_role))
        if str(pid) not in (row.parties or []):
            row.parties = [*(row.parties or []), str(pid)]
        self.db.flush()
        return _case_to_pydantic(row)

    def remove_party(self, case_id: UUID | str, person_id: UUID | str) -> bool:
        row = self._row(case_id)
        pid = as_uuid(person_id)
        if not row or not pid:
            return False
        link = self.db.get(CasePartyORM, (row.id, pid))
        if link:
            self.db.delete(link)
        row.parties = [p for p in (row.parties or []) if p != str(pid)]
        self.db.flush()
        return True

    def parties(self, case_id: UUID | str) -> list[CaseParty]:
        cid = as_uuid(case_id)
        if not cid:
            return []
        rows = self.db.execute(
            select(PersonORM, CasePartyORM.role, CasePartyORM.added_at)
            .join(CasePartyORM, CasePartyORM.person_id == PersonORM.id)
            .where(CasePartyORM.case_id == cid)
            .order_by(CasePartyORM.added_at)
        ).all()
        return [
            CaseParty(person=Person.model_validate(p, from_attributes=True), role=role, added_at=added)
            for p, role, added in rows
        ]

    def cases_for_person(self, person_id: UUID | str) -> list[dict]:
        pid = as_uuid(person_id)
        if not pid:
            return []
        rows = self.db.execute(
            select(CaseORM.id, CaseORM.case_number, CaseORM.title, CaseORM.status, CasePartyORM.role)
            .join(CasePartyORM, CasePartyORM.case_id == CaseORM.id)
            .where(CasePartyORM.person_id == pid)
        ).all()
        return [
            {"case_id": str(r.id), "case_number": r.case_number, "title": r.title,
             "status": r.status.value if hasattr(r.status, "value") else r.status, "role": r.role}
            for r in rows
        ]

    def counts_for(self, case_ids: list[UUID]) -> dict[UUID, dict]:
        """Party / evidence / next-hearing summary for list views, in three queries."""
        if not case_ids:
            return {}
        out: dict[UUID, dict] = {cid: {"party_count": 0, "evidence_count": 0, "next_hearing": None} for cid in case_ids}
        for cid, n in self.db.execute(
            select(CasePartyORM.case_id, func.count()).where(CasePartyORM.case_id.in_(case_ids)).group_by(CasePartyORM.case_id)
        ).all():
            out[cid]["party_count"] = n
        for cid, n in self.db.execute(
            select(EvidenceORM.case_id, func.count()).where(EvidenceORM.case_id.in_(case_ids)).group_by(EvidenceORM.case_id)
        ).all():
            out[cid]["evidence_count"] = n
        now = datetime.now(timezone.utc) - timedelta(hours=4)
        for cid, at in self.db.execute(
            select(HearingORM.case_id, func.min(HearingORM.scheduled_at))
            .where(HearingORM.case_id.in_(case_ids), HearingORM.scheduled_at >= now,
                   HearingORM.status.in_([HearingStatus.SCHEDULED, HearingStatus.IN_PROGRESS]))
            .group_by(HearingORM.case_id)
        ).all():
            out[cid]["next_hearing"] = at
        return out


# ---------------------------------------------------------------------------
# Complaints
# ---------------------------------------------------------------------------

def _complaint(row: ComplaintORM) -> Complaint:
    return Complaint.model_validate(row, from_attributes=True)


class ComplaintRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, complaint_id: UUID | str) -> Complaint | None:
        cid = as_uuid(complaint_id)
        row = self.db.get(ComplaintORM, cid) if cid else None
        return _complaint(row) if row else None

    def get_row_by_reference(self, reference: str) -> ComplaintORM | None:
        return self.db.execute(
            select(ComplaintORM).where(ComplaintORM.reference_number == reference.strip().upper())
        ).scalar_one_or_none()

    def create(self, complaint: Complaint, tracking_code_hash: str | None = None) -> Complaint:
        for _ in range(6):
            reference = complaint.reference_number or f"CMP-{date.today().year}-{secrets.token_hex(3).upper()}"
            data = complaint.model_dump()
            data["reference_number"] = reference
            data["status"] = complaint.status.value
            data["submitted_at"] = _utc(complaint.submitted_at)
            row = ComplaintORM(**data, tracking_code_hash=tracking_code_hash)
            try:
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
                return _complaint(row)
            except IntegrityError:
                if complaint.reference_number:
                    raise
        raise RuntimeError("Could not allocate a unique complaint reference")

    def update(self, complaint_id: UUID | str, **fields: Any) -> Complaint | None:
        cid = as_uuid(complaint_id)
        row = self.db.get(ComplaintORM, cid) if cid else None
        if not row:
            return None
        for key, value in fields.items():
            if not hasattr(row, key):
                continue
            if key == "case_type":
                value = enum_or_none(CaseType, value) or row.case_type
            elif hasattr(value, "value"):
                value = value.value
            setattr(row, key, value)
        row.updated_at = datetime.now(timezone.utc)
        self.db.flush()
        return _complaint(row)

    def list_all(self) -> list[Complaint]:
        rows = self.db.execute(select(ComplaintORM).order_by(ComplaintORM.submitted_at.desc())).scalars().all()
        return [_complaint(r) for r in rows]

    def search(self, status: Optional[str] = None, case_type: Optional[str] = None, q: Optional[str] = None,
               limit: int = 200, offset: int = 0) -> tuple[list[Complaint], int]:
        stmt = select(ComplaintORM)
        conds = []
        if status:
            conds.append(ComplaintORM.status == str(getattr(status, "value", status)))
        ct = enum_or_none(CaseType, case_type)
        if ct:
            conds.append(or_(ComplaintORM.case_type == ct, ComplaintORM.ai_suggested_category == ct.value))
        if q:
            like = f"%{q.strip()}%"
            conds.append(or_(ComplaintORM.description.ilike(like), ComplaintORM.reference_number.ilike(like),
                             ComplaintORM.complainant_name.ilike(like), ComplaintORM.location.ilike(like)))
        if conds:
            stmt = stmt.where(and_(*conds))
        total = self.db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
        rows = self.db.execute(stmt.order_by(ComplaintORM.submitted_at.desc()).limit(limit).offset(offset)).scalars().all()
        return [_complaint(r) for r in rows], total

    def staff_labelled(self, limit: int = 400) -> list[tuple[str, str]]:
        """(description, category) for complaints whose category a person confirmed --
        picked in triage or used to open a case (the case's type wins). Classifier training data."""
        stmt = (
            select(ComplaintORM.description, ComplaintORM.case_type, CaseORM.case_type)
            .outerjoin(CaseORM, CaseORM.id == ComplaintORM.case_id)
            .where(or_(ComplaintORM.category_confirmed.is_(True), ComplaintORM.case_id.is_not(None)))
            .where(ComplaintORM.status.notin_(["rejected", "duplicate"]))
            .order_by(ComplaintORM.updated_at.desc().nullslast())
            .limit(limit)
        )
        out = []
        for description, complaint_type, case_type in self.db.execute(stmt).all():
            category = case_type or complaint_type
            if description and category is not None:
                out.append((description, getattr(category, "value", str(category))))
        return out

    def recent_texts(self, exclude_id: UUID | None, limit: int = 500) -> list[tuple[UUID, str, str | None]]:
        stmt = select(ComplaintORM.id, ComplaintORM.description, ComplaintORM.reference_number).order_by(
            ComplaintORM.submitted_at.desc()
        ).limit(limit)
        if exclude_id:
            stmt = stmt.where(ComplaintORM.id != exclude_id)
        return [(r.id, r.description, r.reference_number) for r in self.db.execute(stmt).all()]


# ---------------------------------------------------------------------------
# Rulings
# ---------------------------------------------------------------------------

class RulingRepository:
    """The judge-only write path. routes' require_role(SystemRole.JUDGE) runs
    before this is ever called. See docs/DESIGN_DECISIONS.md."""

    def __init__(self, db: Session):
        self.db = db

    def get(self, case_id: UUID | str) -> CaseRuling | None:
        cid = as_uuid(case_id)
        row = self.db.get(CaseRulingORM, cid) if cid else None
        return CaseRuling.model_validate(row, from_attributes=True) if row else None

    def create(self, ruling: CaseRuling) -> CaseRuling:
        data = ruling.model_dump()
        data["entered_at"] = _utc(ruling.entered_at)
        self.db.merge(CaseRulingORM(**data))  # merge: an amended ruling overwrites
        self.db.flush()
        return ruling

    def count_and_avg_days(self) -> tuple[int, float | None]:
        rows = self.db.execute(
            select(CaseRulingORM.entered_at, CaseORM.created_at).join(CaseORM, CaseORM.id == CaseRulingORM.case_id)
        ).all()
        if not rows:
            return 0, None
        days = [max(0.0, (_utc(e) - _utc(c)).total_seconds() / 86400) for e, c in rows if e and c]
        return len(rows), (round(sum(days) / len(days), 1) if days else None)


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------

class PersonRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, person_id: UUID | str) -> Person | None:
        pid = as_uuid(person_id)
        row = self.db.get(PersonORM, pid) if pid else None
        return Person.model_validate(row, from_attributes=True) if row else None

    def get_by_emirates_id_hash(self, eid_hash: str) -> Person | None:
        row = self.db.execute(select(PersonORM).where(PersonORM.emirates_id_hash == eid_hash)).scalars().first()
        return Person.model_validate(row, from_attributes=True) if row else None

    def create(self, person: Person) -> Person:
        row = PersonORM(
            id=person.id, full_name=person.full_name.strip(), emirates_id_hash=person.emirates_id_hash,
            emirates_id_last4=person.emirates_id_last4, role_in_case=person.role_in_case,
            reference_photo_on_file=person.reference_photo_on_file, contact_phone=person.contact_phone,
            preferred_language=person.preferred_language or "ar",
        )
        self.db.add(row)
        self.db.flush()
        return Person.model_validate(row, from_attributes=True)

    def update(self, person_id: UUID | str, **fields: Any) -> Person | None:
        pid = as_uuid(person_id)
        row = self.db.get(PersonORM, pid) if pid else None
        if not row:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self.db.flush()
        return Person.model_validate(row, from_attributes=True)

    def list_all(self, q: Optional[str] = None, limit: int = 200) -> list[Person]:
        stmt = select(PersonORM)
        if q:
            stmt = stmt.where(PersonORM.full_name.ilike(f"%{q.strip()}%"))
        rows = self.db.execute(stmt.order_by(PersonORM.full_name).limit(limit)).scalars().all()
        return [Person.model_validate(r, from_attributes=True) for r in rows]


# ---------------------------------------------------------------------------
# Hearings
# ---------------------------------------------------------------------------

class HearingRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, hearing_id: UUID | str) -> Hearing | None:
        hid = as_uuid(hearing_id)
        row = self.db.get(HearingORM, hid) if hid else None
        return Hearing.model_validate(row, from_attributes=True) if row else None

    def create(self, hearing: Hearing) -> Hearing:
        data = hearing.model_dump()
        data["scheduled_at"] = _utc(hearing.scheduled_at)
        data["created_at"] = _utc(hearing.created_at)
        row = HearingORM(**data)
        self.db.add(row)
        self.db.flush()
        return Hearing.model_validate(row, from_attributes=True)

    def update(self, hearing_id: UUID | str, **fields: Any) -> Hearing | None:
        hid = as_uuid(hearing_id)
        row = self.db.get(HearingORM, hid) if hid else None
        if not row:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, _utc(value) if isinstance(value, datetime) else value)
        row.updated_at = datetime.now(timezone.utc)
        self.db.flush()
        return Hearing.model_validate(row, from_attributes=True)

    def list_all(self) -> list[Hearing]:
        rows = self.db.execute(select(HearingORM).order_by(HearingORM.scheduled_at)).scalars().all()
        return [Hearing.model_validate(r, from_attributes=True) for r in rows]

    def list_for_case(self, case_id: UUID | str) -> list[Hearing]:
        cid = as_uuid(case_id)
        if not cid:
            return []
        rows = self.db.execute(
            select(HearingORM).where(HearingORM.case_id == cid).order_by(HearingORM.scheduled_at)
        ).scalars().all()
        return [Hearing.model_validate(r, from_attributes=True) for r in rows]

    def search(self, start: datetime | None = None, end: datetime | None = None, case_id: UUID | None = None,
               courtroom: str | None = None, status: str | None = None, judge_id: UUID | None = None,
               limit: int = 500) -> list[Hearing]:
        stmt = select(HearingORM)
        conds = []
        if start:
            conds.append(HearingORM.scheduled_at >= _utc(start))
        if end:
            conds.append(HearingORM.scheduled_at < _utc(end))
        if case_id:
            conds.append(HearingORM.case_id == case_id)
        if courtroom:
            conds.append(HearingORM.courtroom == courtroom)
        if enum_or_none(HearingStatus, status):
            conds.append(HearingORM.status == enum_or_none(HearingStatus, status))
        if judge_id:
            conds.append(HearingORM.presiding_judge_id == judge_id)
        if conds:
            stmt = stmt.where(and_(*conds))
        rows = self.db.execute(stmt.order_by(HearingORM.scheduled_at).limit(limit)).scalars().all()
        return [Hearing.model_validate(r, from_attributes=True) for r in rows]

    def conflicts(self, scheduled_at: datetime, duration_minutes: int, courtroom: str | None,
                  judge_id: UUID | None, exclude_id: UUID | None = None) -> list[Hearing]:
        """Hearings that overlap in the same courtroom or with the same judge."""
        if not courtroom and not judge_id:
            return []
        start = _utc(scheduled_at)
        end = start + timedelta(minutes=duration_minutes)
        window = select(HearingORM).where(
            HearingORM.status.notin_([HearingStatus.CANCELLED, HearingStatus.COMPLETED, HearingStatus.ADJOURNED]),
            HearingORM.scheduled_at < end,
            HearingORM.scheduled_at > start - timedelta(hours=12),
        )
        who = []
        if courtroom:
            who.append(HearingORM.courtroom == courtroom)
        if judge_id:
            who.append(HearingORM.presiding_judge_id == judge_id)
        window = window.where(or_(*who))
        if exclude_id:
            window = window.where(HearingORM.id != exclude_id)
        out = []
        for row in self.db.execute(window).scalars().all():
            row_end = _utc(row.scheduled_at) + timedelta(minutes=row.duration_minutes or 60)
            if row_end > start:
                out.append(Hearing.model_validate(row, from_attributes=True))
        return out


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------

class EvidenceRepository:
    def __init__(self, db: Session):
        self.db = db

    def row(self, evidence_id: UUID | str) -> EvidenceORM | None:
        eid = as_uuid(evidence_id)
        return self.db.get(EvidenceORM, eid) if eid else None

    def get(self, evidence_id: UUID | str) -> Evidence | None:
        row = self.row(evidence_id)
        return Evidence.model_validate(row, from_attributes=True) if row else None

    def create(self, evidence: Evidence, storage_path: str) -> Evidence:
        data = evidence.model_dump()
        data["uploaded_at"] = _utc(evidence.uploaded_at)
        data["evidence_type"] = evidence.evidence_type.value
        row = EvidenceORM(**data, storage_path=storage_path)
        self.db.add(row)
        case = self.db.get(CaseORM, evidence.case_id)
        if case is not None and str(evidence.id) not in (case.evidence or []):
            case.evidence = [*(case.evidence or []), str(evidence.id)]
        self.db.flush()
        return Evidence.model_validate(row, from_attributes=True)

    def update(self, evidence_id: UUID | str, **fields: Any) -> Evidence | None:
        row = self.row(evidence_id)
        if not row:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self.db.flush()
        return Evidence.model_validate(row, from_attributes=True)

    def list_for_case(self, case_id: UUID | str) -> list[Evidence]:
        cid = as_uuid(case_id)
        if not cid:
            return []
        rows = self.db.execute(
            select(EvidenceORM).where(EvidenceORM.case_id == cid).order_by(EvidenceORM.uploaded_at.desc())
        ).scalars().all()
        return [Evidence.model_validate(r, from_attributes=True) for r in rows]

    def stuck(self, older_than_minutes: int = 15) -> list[UUID]:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
        return list(self.db.execute(
            select(EvidenceORM.id).where(EvidenceORM.processing_status.in_(["queued", "processing"]),
                                         EvidenceORM.uploaded_at < cutoff)
        ).scalars().all())

    def status_counts(self) -> dict[str, dict[str, int]]:
        processing = dict(self.db.execute(
            select(EvidenceORM.processing_status, func.count()).group_by(EvidenceORM.processing_status)).all())
        review = dict(self.db.execute(
            select(EvidenceORM.review_status, func.count()).group_by(EvidenceORM.review_status)).all())
        return {"processing": processing, "review": review}


# ---------------------------------------------------------------------------
# Law library
# ---------------------------------------------------------------------------

class LawDocumentRepository:
    def __init__(self, db: Session):
        self.db = db

    def row(self, doc_id: UUID | str) -> LawDocumentORM | None:
        did = as_uuid(doc_id)
        return self.db.get(LawDocumentORM, did) if did else None

    def get(self, doc_id: UUID | str) -> LawDocument | None:
        row = self.row(doc_id)
        return LawDocument.model_validate(row, from_attributes=True) if row else None

    def find_by_sha(self, sha256: str) -> LawDocument | None:
        row = self.db.execute(select(LawDocumentORM).where(LawDocumentORM.sha256 == sha256)).scalars().first()
        return LawDocument.model_validate(row, from_attributes=True) if row else None

    def create(self, doc: LawDocument, storage_path: str) -> LawDocument:
        data = doc.model_dump()
        data["uploaded_at"] = _utc(doc.uploaded_at)
        row = LawDocumentORM(**data, storage_path=storage_path)
        self.db.add(row)
        self.db.flush()
        return LawDocument.model_validate(row, from_attributes=True)

    def update(self, doc_id: UUID | str, **fields: Any) -> LawDocument | None:
        row = self.row(doc_id)
        if not row:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self.db.flush()
        return LawDocument.model_validate(row, from_attributes=True)

    def delete(self, doc_id: UUID | str) -> LawDocumentORM | None:
        row = self.row(doc_id)
        if row:
            self.db.delete(row)
            self.db.flush()
        return row

    def list_all(self) -> list[LawDocument]:
        rows = self.db.execute(select(LawDocumentORM).order_by(LawDocumentORM.uploaded_at.desc())).scalars().all()
        return [LawDocument.model_validate(r, from_attributes=True) for r in rows]

    def stuck(self, older_than_minutes: int = 30) -> list[UUID]:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
        return list(self.db.execute(
            select(LawDocumentORM.id).where(LawDocumentORM.status.in_(["queued", "processing"]),
                                            LawDocumentORM.uploaded_at < cutoff)
        ).scalars().all())

    def indexed_article_total(self) -> int:
        return int(self.db.execute(
            select(func.coalesce(func.sum(LawDocumentORM.article_count), 0)).where(LawDocumentORM.status == "indexed")
        ).scalar() or 0)


# ---------------------------------------------------------------------------
# Research notes
# ---------------------------------------------------------------------------

class ResearchNoteRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, note: ResearchNote) -> ResearchNote:
        data = note.model_dump()
        data["created_at"] = _utc(note.created_at)
        row = ResearchNoteORM(**data)
        self.db.add(row)
        self.db.flush()
        return ResearchNote.model_validate(row, from_attributes=True)

    def list_for_case(self, case_id: UUID | str) -> list[ResearchNote]:
        cid = as_uuid(case_id)
        if not cid:
            return []
        rows = self.db.execute(
            select(ResearchNoteORM).where(ResearchNoteORM.case_id == cid).order_by(ResearchNoteORM.created_at.desc())
        ).scalars().all()
        return [ResearchNote.model_validate(r, from_attributes=True) for r in rows]


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class AuthRecord(NamedTuple):
    """Only get_for_auth() returns this -- the one place that needs a password
    hash in hand. Every other read returns the hash-free UserAccount."""
    id: UUID
    hashed_password: str
    role: SystemRole
    is_active: bool
    password_changed_at: datetime | None


def _user_to_pydantic(row: UserAccountORM) -> UserAccount:
    return UserAccount(
        id=row.id, username=row.username, full_name=row.full_name, role=row.role,
        is_active=row.is_active, created_at=row.created_at, last_login_at=row.last_login_at,
    )


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_for_auth(self, username: str) -> AuthRecord | None:
        row = self.db.execute(
            select(UserAccountORM).where(func.lower(UserAccountORM.username) == username.strip().lower())
        ).scalar_one_or_none()
        if row is None:
            return None
        return AuthRecord(row.id, row.hashed_password, row.role, row.is_active, row.password_changed_at)

    def password_changed_at(self, user_id: UUID | str) -> datetime | None:
        uid = as_uuid(user_id)
        row = self.db.get(UserAccountORM, uid) if uid else None
        return row.password_changed_at if row else None

    def get_by_username(self, username: str) -> UserAccount | None:
        row = self.db.execute(
            select(UserAccountORM).where(func.lower(UserAccountORM.username) == username.strip().lower())
        ).scalar_one_or_none()
        return _user_to_pydantic(row) if row else None

    def get(self, user_id: UUID | str) -> UserAccount | None:
        uid = as_uuid(user_id)
        row = self.db.get(UserAccountORM, uid) if uid else None
        return _user_to_pydantic(row) if row else None

    def create(self, username: str, hashed_password: str, full_name: str, role: SystemRole) -> UserAccount:
        row = UserAccountORM(username=username.strip(), hashed_password=hashed_password,
                             full_name=full_name.strip(), role=role)
        self.db.add(row)
        self.db.flush()
        self.db.refresh(row)
        return _user_to_pydantic(row)

    def update(self, user_id: UUID | str, **fields: Any) -> UserAccount | None:
        uid = as_uuid(user_id)
        row = self.db.get(UserAccountORM, uid) if uid else None
        if not row:
            return None
        for key, value in fields.items():
            if value is not None and hasattr(row, key):
                setattr(row, key, value)
        self.db.flush()
        return _user_to_pydantic(row)

    def set_password(self, user_id: UUID | str, hashed_password: str) -> bool:
        uid = as_uuid(user_id)
        row = self.db.get(UserAccountORM, uid) if uid else None
        if not row:
            return False
        row.hashed_password = hashed_password
        row.password_changed_at = datetime.now(timezone.utc)
        self.db.flush()
        return True

    def touch_login(self, user_id: UUID) -> None:
        self.db.execute(update(UserAccountORM).where(UserAccountORM.id == user_id)
                        .values(last_login_at=datetime.now(timezone.utc)))

    def list_all(self, role: Optional[str] = None, active_only: bool = False) -> list[UserAccount]:
        stmt = select(UserAccountORM)
        if enum_or_none(SystemRole, role):
            stmt = stmt.where(UserAccountORM.role == enum_or_none(SystemRole, role))
        if active_only:
            stmt = stmt.where(UserAccountORM.is_active.is_(True))
        rows = self.db.execute(stmt.order_by(UserAccountORM.full_name)).scalars().all()
        return [_user_to_pydantic(r) for r in rows]

    def count_active_admins(self) -> int:
        return int(self.db.execute(
            select(func.count()).where(UserAccountORM.role == SystemRole.ADMIN, UserAccountORM.is_active.is_(True))
        ).scalar() or 0)


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

class AuditRepository:
    def __init__(self, db: Session):
        self.db = db

    def record(self, action: str, user: UserAccount | None = None, entity_type: str | None = None,
               entity_id: Any = None, detail: dict | None = None, ip: str | None = None,
               username: str | None = None) -> None:
        self.db.add(AuditLogORM(
            user_id=user.id if user else None,
            username=user.username if user else username,
            role=user.role.value if user else None,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            detail=detail,
            ip=ip,
        ))

    def search(self, action: str | None = None, entity_type: str | None = None, entity_id: str | None = None,
               username: str | None = None, limit: int = 100, offset: int = 0) -> tuple[list[AuditEntry], int]:
        stmt = select(AuditLogORM)
        conds = []
        if action:
            conds.append(AuditLogORM.action.ilike(f"{action}%"))
        if entity_type:
            conds.append(AuditLogORM.entity_type == entity_type)
        if entity_id:
            conds.append(AuditLogORM.entity_id == entity_id)
        if username:
            conds.append(AuditLogORM.username.ilike(f"%{username}%"))
        if conds:
            stmt = stmt.where(and_(*conds))
        total = self.db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
        rows = self.db.execute(stmt.order_by(AuditLogORM.at.desc()).limit(limit).offset(offset)).scalars().all()
        return [AuditEntry.model_validate(r, from_attributes=True) for r in rows], total
