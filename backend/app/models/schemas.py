"""
Core data model for LexIntel.

The courtroom "single camera, person steps up, role is selected, recording
starts" flow is an identity-verification + record-keeping flow, not an
emotion/credibility-scoring flow. There is deliberately no `deception_score`,
`emotion_state`, `truthfulness`, or `verdict` field anywhere in this file.
See docs/DESIGN_DECISIONS.md.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.utcnow()


# ---------------------------------------------------------------------------
# Shared enums
# ---------------------------------------------------------------------------

class PriorityLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class CaseType(str, Enum):
    CRIMINAL = "criminal"
    CIVIL = "civil"
    CYBERCRIME = "cybercrime"
    TRAFFIC = "traffic"
    GRIEVANCE = "grievance"


class CaseStatus(str, Enum):
    INTAKE = "intake"
    UNDER_INVESTIGATION = "under_investigation"
    READY_FOR_HEARING = "ready_for_hearing"
    IN_HEARING = "in_hearing"
    AWAITING_RULING = "awaiting_ruling"     # AI stops here -- see CaseRuling below
    RESOLVED = "resolved"
    CLOSED = "closed"


OPEN_CASE_STATUSES = {
    CaseStatus.INTAKE, CaseStatus.UNDER_INVESTIGATION, CaseStatus.READY_FOR_HEARING,
    CaseStatus.IN_HEARING, CaseStatus.AWAITING_RULING,
}


class HearingRole(str, Enum):
    """Every role a person can hold when they step up in a courtroom session."""
    DEFENDANT = "defendant"
    PLAINTIFF = "plaintiff"
    WITNESS = "witness"
    EXPERT_WITNESS = "expert_witness"
    PROSECUTOR = "prosecutor"
    DEFENSE_COUNSEL = "defense_counsel"
    INTERPRETER = "interpreter"
    VICTIM = "victim"


class IdentityVerificationStatus(str, Enum):
    NOT_ATTEMPTED = "not_attempted"
    VERIFIED = "verified"              # face match against on-file, consented reference photo
    MANUAL_CONFIRM = "manual_confirm"  # clerk confirmed identity by hand (default/fallback path)
    MISMATCH = "mismatch"              # flagged for clerk attention, never auto-resolved


class HearingStatus(str, Enum):
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ADJOURNED = "adjourned"


class ComplaintStatus(str, Enum):
    RECEIVED = "received"
    UNDER_REVIEW = "under_review"
    CASE_OPENED = "case_opened"
    RESOLVED = "resolved"
    REJECTED = "rejected"
    DUPLICATE = "duplicate"


class EvidenceType(str, Enum):
    DOCUMENT = "document"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    CCTV = "cctv"
    DIGITAL = "digital"
    CONTRACT = "contract"


class Jurisdiction(str, Enum):
    FEDERAL = "federal"
    DIFC = "difc"
    ADGM = "adgm"
    DUBAI = "dubai"
    ABU_DHABI = "abu_dhabi"
    SHARJAH = "sharjah"
    OTHER_EMIRATE = "other_emirate"


# ---------------------------------------------------------------------------
# People & complaints
# ---------------------------------------------------------------------------

class Person(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    full_name: str
    emirates_id_hash: Optional[str] = Field(default=None, exclude=True)  # never serialized
    emirates_id_last4: Optional[str] = None
    role_in_case: Optional[HearingRole] = None
    reference_photo_on_file: bool = False    # True only if consent was captured at intake
    contact_phone: Optional[str] = None
    preferred_language: str = "ar"
    created_at: Optional[datetime] = None


class CaseParty(BaseModel):
    person: Person
    role: str
    added_at: Optional[datetime] = None


class Complaint(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    reference_number: Optional[str] = None
    submitted_by: UUID
    case_type: CaseType
    description: str
    location: Optional[str] = None
    complainant_name: Optional[str] = None
    complainant_phone: Optional[str] = None
    complainant_email: Optional[str] = None
    preferred_language: Optional[str] = None
    status: ComplaintStatus = ComplaintStatus.RECEIVED
    submitted_at: datetime = Field(default_factory=_utcnow)
    updated_at: Optional[datetime] = None
    ai_status: str = "pending"          # pending | done | fallback | failed
    ai_suggested_category: Optional[str] = None
    ai_duplicate_of: Optional[UUID] = None
    ai_suggested_department: Optional[str] = None
    ai_confidence: Optional[float] = None
    ai_explanation: Optional[str] = None
    ai_priority_level: Optional[str] = None
    duplicate_candidates: Optional[list[dict[str, Any]]] = None
    ai_details: Optional[dict[str, Any]] = None
    category_confirmed: bool = False
    assigned_department: Optional[str] = None
    staff_notes: Optional[str] = None
    case_id: Optional[UUID] = None


# ---------------------------------------------------------------------------
# Evidence (Module 3 / 9)
# ---------------------------------------------------------------------------

class SignatureCheckResult(BaseModel):
    """
    Document-authentication result: is a signature physically present, and
    how closely does it match a reference signature on file? A similarity
    score for a *document*, not a statement about a person's truthfulness.
    """
    signature_present: bool
    match_score: Optional[float] = None
    reference_signature_id: Optional[UUID] = None
    flagged_for_human_review: bool = False
    explanation: Optional[str] = None
    checked_at: Optional[datetime] = None


class Evidence(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    case_id: UUID
    label: str
    evidence_type: EvidenceType
    original_filename: str
    content_type: str
    size_bytes: int
    sha256: str                               # chain-of-custody integrity check
    uploaded_by: UUID
    uploaded_at: datetime = Field(default_factory=_utcnow)
    processing_status: str = "queued"         # queued | processing | done | failed | skipped
    processing_error: Optional[str] = None
    processed_at: Optional[datetime] = None
    ocr_confidence: Optional[float] = None
    ocr_language: Optional[str] = None
    page_count: Optional[int] = None
    text_length: Optional[int] = None
    entity_count: Optional[int] = None
    signature_check: Optional[dict[str, Any]] = None
    ai_summary: Optional[dict[str, Any]] = None
    review_status: str = "pending_review"     # pending_review | reviewed | flagged
    review_note: Optional[str] = None
    reviewed_by: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Courtroom session: the "single camera, one person steps up at a time" flow
# ---------------------------------------------------------------------------

class TranscriptSegment(BaseModel):
    seq: int
    text: str
    language: Optional[str] = None
    received_at: datetime = Field(default_factory=_utcnow)


class StatementRecord(BaseModel):
    """
    One person's turn at the stand. Holds the recording + transcript + who/
    what role -- nothing about how they looked or sounded emotionally.
    """
    id: UUID = Field(default_factory=uuid4)
    hearing_id: UUID
    case_id: Optional[UUID] = None
    session_id: Optional[UUID] = None
    person_id: UUID
    person_name: Optional[str] = None
    role: HearingRole
    identity_verification: IdentityVerificationStatus = IdentityVerificationStatus.NOT_ATTEMPTED
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    video_uri: Optional[str] = None
    audio_uri: Optional[str] = None
    recording_path: Optional[str] = None
    recording_content_type: Optional[str] = None
    recording_size_bytes: Optional[int] = None
    recording_sha256: Optional[str] = None
    transcript: Optional[str] = None
    transcript_confidence: Optional[float] = None
    transcript_source: Optional[str] = None       # live | final | edited
    transcript_status: str = "none"               # none | live | queued | processing | done | failed
    transcript_language: Optional[str] = None
    live_segments: list[TranscriptSegment] = Field(default_factory=list)
    extracted_entities: list[dict[str, Any]] = Field(default_factory=list)
    # Key sentences of the transcript (extractive: the speaker's own words) and
    # offence mentions with the sentence that mentions them. See app/ai.
    summary: Optional[dict[str, Any]] = None
    offence_mentions: list[dict[str, Any]] = Field(default_factory=list)
    sequence_number: int = 1


class CourtroomSession(BaseModel):
    """
    Tracks the stand for one hearing. `active_statement_id` is the person
    currently at the stand; only one at a time. The clerk (a human) confirms
    who is stepping up and in what role before recording starts.
    """
    id: UUID = Field(default_factory=uuid4)
    hearing_id: UUID
    case_id: Optional[UUID] = None
    camera_device_id: str = "stand-cam-01"
    active_statement_id: Optional[UUID] = None
    statements: list[UUID] = Field(default_factory=list)
    opened_by: Optional[UUID] = None
    session_started_at: datetime = Field(default_factory=_utcnow)
    session_closed_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Scheduling (Module 7)
# ---------------------------------------------------------------------------

class Hearing(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    case_id: UUID
    scheduled_at: datetime
    duration_minutes: int = 60
    hearing_type: Optional[str] = None
    courtroom: Optional[str] = None
    status: HearingStatus = HearingStatus.SCHEDULED
    presiding_judge_id: Optional[UUID] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Case, timeline, prioritization (Modules 2 & 4 -- decision support only)
# ---------------------------------------------------------------------------

class TimelineEvent(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    case_id: UUID
    event_date: Optional[date] = None
    description: str
    source_document_id: Optional[UUID] = None
    source_label: Optional[str] = None
    entity_type: str  # person | organization | location | event | charge | evidence_ref | manual
    created_at: Optional[datetime] = None


class PriorityAssessment(BaseModel):
    """
    Module 4 output. A recommendation with a visible explanation -- never a
    hidden score, and never a statement about guilt or innocence.
    """
    case_id: UUID
    level: PriorityLevel
    score: float
    factors: dict[str, float]
    explanation: str
    generated_at: datetime = Field(default_factory=_utcnow)
    requires_human_review: bool = False


class Case(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    case_number: str
    case_type: CaseType
    status: CaseStatus = CaseStatus.INTAKE
    title: str
    description: Optional[str] = None
    parties: list[UUID] = Field(default_factory=list)
    evidence: list[UUID] = Field(default_factory=list)
    timeline: list[TimelineEvent] = Field(default_factory=list)
    priority: Optional[PriorityAssessment] = None
    priority_signals: Optional[dict[str, Any]] = None
    assigned_judge_id: Optional[UUID] = None
    source_complaint_id: Optional[UUID] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    statutory_deadline: Optional[date] = None


class CaseRuling(BaseModel):
    """
    Entered by a judge, through the platform, after reviewing the AI-compiled
    case file. `entered_by` is always the authenticated judge's own id -- this
    model has no code path that lets an agent populate it.
    """
    case_id: UUID
    entered_by: UUID
    ruling_text: str
    entered_at: datetime = Field(default_factory=_utcnow)
    ai_assisted_research_refs: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Legal research (Module 6) + audit
# ---------------------------------------------------------------------------

class LawDocument(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    title: str
    law_number: Optional[str] = None
    year: Optional[int] = None
    jurisdiction: str
    language: str = "en"
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    legislation_state: str = "active"
    source_url: Optional[str] = None
    original_filename: str
    sha256: str
    size_bytes: int
    status: str = "queued"
    error: Optional[str] = None
    article_count: Optional[int] = None
    parse_mode: Optional[str] = None
    uploaded_by: UUID
    uploaded_at: datetime = Field(default_factory=_utcnow)
    indexed_at: Optional[datetime] = None


class ResearchNote(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    case_id: Optional[UUID] = None
    question: str
    answer: str
    citations: list[dict[str, Any]] = Field(default_factory=list)
    confidence: float = 0.0
    needs_human_review: bool = True
    created_by: UUID
    created_at: datetime = Field(default_factory=_utcnow)


class AuditEntry(BaseModel):
    id: int
    at: datetime
    user_id: Optional[UUID] = None
    username: Optional[str] = None
    role: Optional[str] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    detail: Optional[dict[str, Any]] = None
    ip: Optional[str] = None
