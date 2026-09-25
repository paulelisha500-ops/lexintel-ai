"""
SQLAlchemy table definitions -- the storage model. app/models/schemas.py
is the API/domain model; repositories in postgres_repository.py convert
between the two.

New columns on pre-existing tables are also added by app/db/migrations.py
(create_all never alters an existing table), so keep the two in step.

Deliberate omissions carried over from schemas.py: no column for a
deception score, emotion reading, or AI-authored verdict. CaseRuling.entered_by
is only ever written from an authenticated judge's own user id.
"""

from __future__ import annotations

from datetime import datetime, date, timezone
from uuid import uuid4

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Enum as SAEnum, Float, ForeignKey, Index, Integer, String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.auth_models import SystemRole
from app.models.schemas import CaseStatus, CaseType, HearingRole, HearingStatus, PriorityLevel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UserAccountORM(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[SystemRole] = mapped_column(SAEnum(SystemRole, name="system_role"), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CaseORM(Base):
    __tablename__ = "cases"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    case_number: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    case_type: Mapped[CaseType] = mapped_column(SAEnum(CaseType, name="case_type"), nullable=False)
    status: Mapped[CaseStatus] = mapped_column(
        SAEnum(CaseStatus, name="case_status"), default=CaseStatus.INTAKE, nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    parties: Mapped[list] = mapped_column(JSONB, default=list)     # list[str(UUID)], kept in sync with case_parties
    evidence: Mapped[list] = mapped_column(JSONB, default=list)    # list[str(UUID)]
    priority_level: Mapped[PriorityLevel | None] = mapped_column(
        SAEnum(PriorityLevel, name="priority_level"), nullable=True
    )
    priority_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    priority_factors: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    priority_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority_requires_human_review: Mapped[bool] = mapped_column(default=False)
    priority_signals: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    priority_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_judge_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    source_complaint_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    statutory_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)

    timeline: Mapped[list["TimelineEventORM"]] = relationship(
        back_populates="case", cascade="all, delete-orphan", order_by="TimelineEventORM.event_date"
    )
    ruling: Mapped["CaseRulingORM | None"] = relationship(
        back_populates="case", uselist=False, cascade="all, delete-orphan"
    )


class TimelineEventORM(Base):
    __tablename__ = "timeline_events"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    case_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False, index=True)
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    source_document_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    source_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_now)

    case: Mapped["CaseORM"] = relationship(back_populates="timeline")


class ComplaintORM(Base):
    __tablename__ = "complaints"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    reference_number: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)
    tracking_code_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    submitted_by: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    case_type: Mapped[CaseType] = mapped_column(SAEnum(CaseType, name="case_type"), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    complainant_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    complainant_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    complainant_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    preferred_language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="received", nullable=False, index=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    ai_status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    ai_suggested_category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ai_duplicate_of: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ai_suggested_department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_priority_level: Mapped[str | None] = mapped_column(String(16), nullable=True)
    duplicate_candidates: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Classifier explanation: category probabilities, nearest examples, method.
    ai_details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # A person chose or confirmed the category -> a training example for the classifier.
    category_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    assigned_department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    staff_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class CaseRulingORM(Base):
    __tablename__ = "case_rulings"

    case_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cases.id"), primary_key=True)
    # No default and no nullable fallback: only enter_ruling() writes this,
    # from the authenticated judge's own id, after require_role(JUDGE).
    entered_by: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    ruling_text: Mapped[str] = mapped_column(Text, nullable=False)
    entered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ai_assisted_research_refs: Mapped[list] = mapped_column(JSONB, default=list)

    case: Mapped["CaseORM"] = relationship(back_populates="ruling")


class PersonORM(Base):
    __tablename__ = "people"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    emirates_id_hash: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    emirates_id_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    role_in_case: Mapped[HearingRole | None] = mapped_column(SAEnum(HearingRole, name="hearing_role"), nullable=True)
    reference_photo_on_file: Mapped[bool] = mapped_column(default=False, nullable=False)
    contact_phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    preferred_language: Mapped[str] = mapped_column(String(8), default="ar", nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_now)


class CasePartyORM(Base):
    """A person's role is per case: the same person can be a witness in one
    case and a plaintiff in another."""
    __tablename__ = "case_parties"

    case_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True)
    person_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("people.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class HearingORM(Base):
    __tablename__ = "hearings"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    case_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False, index=True)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    hearing_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    courtroom: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[HearingStatus] = mapped_column(
        SAEnum(HearingStatus, name="hearing_status"), default=HearingStatus.SCHEDULED, nullable=False
    )
    presiding_judge_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class EvidenceORM(Base):
    __tablename__ = "evidence"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    case_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    evidence_type: Mapped[str] = mapped_column(String(32), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    uploaded_by: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    processing_status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False, index=True)
    processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ocr_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ocr_language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entity_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Fallback copy of extracted text, used only when Mongo is unreachable.
    ocr_text_fallback: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_check: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Extractive summary, offence mentions and cited laws (app/ai), computed at processing time.
    ai_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    review_status: Mapped[str] = mapped_column(String(32), default="pending_review", nullable=False, index=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LawDocumentORM(Base):
    __tablename__ = "law_documents"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    law_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    jurisdiction: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    language: Mapped[str] = mapped_column(String(8), default="en", nullable=False)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    legislation_state: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    article_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parse_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)   # articles | sections
    vector_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    uploaded_by: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResearchNoteORM(Base):
    __tablename__ = "research_notes"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    case_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("cases.id"), nullable=True, index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[list] = mapped_column(JSONB, default=list)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    needs_human_review: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditLogORM(Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_entity", "entity_type", "entity_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    user_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
