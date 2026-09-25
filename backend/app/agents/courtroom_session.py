"""
Courtroom stand session -- the "single camera, one person steps up at a
time" flow from the spec.

What this does:
  1. A clerk opens a CourtroomSession for a hearing.
  2. When someone steps up, the clerk selects their role (witness,
     defendant, prosecutor, ...) and the camera runs a 1:1 face-verification
     check against that person's on-file reference photo (captured with
     consent at case intake) to confirm identity. If verification is
     unavailable or fails, the clerk manually confirms -- there is no path
     where the system decides identity on its own without a human able to
     override it.
  3. Recording (audio/video) starts, tied to that person + role + hearing.
  4. Live transcription runs against the audio (Module: Speech-to-Text) and
     the transcript is queued for the case-intelligence agent (entity
     extraction, timeline).
  5. When they step down, the statement closes and the stand is free for
     the next person -- defendant, then witnesses, one at a time, in
     sequence, exactly as the hearing calls them.

What this deliberately does NOT do: analyze the person's face for emotion,
fear, anxiety, hesitation, or truthfulness. See docs/DESIGN_DECISIONS.md.
The face model used here (`compute_face_embedding`) is a 1:1 verification
embedding -- the same category of model used for phone face-unlock -- and
it is only ever compared against ONE known, consented reference photo. It
is not used for open-set identification or expression analysis, and nothing
in this file reads `output` beyond a similarity score against that one
reference.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

import numpy as np

from app.models.schemas import (
    CourtroomSession,
    StatementRecord,
    HearingRole,
    IdentityVerificationStatus,
)


# ---------------------------------------------------------------------------
# Identity verification (1:1, consented, session-scoped -- see module docstring)
# ---------------------------------------------------------------------------

def compute_face_embedding(image: np.ndarray) -> np.ndarray:
    """
    Placeholder for a standard face-embedding model (e.g. a FaceNet/ArcFace
    style network). Swap in a real model here; keep the function's
    contract (image in, fixed-length embedding out) the same so nothing
    downstream needs to change.
    """
    raise NotImplementedError(
        "Wire in a face-embedding model of your choice here. Keep this "
        "function 1:1 verification only -- see module docstring."
    )


def verify_identity(
    live_frame: Optional[np.ndarray],
    reference_embedding: Optional[np.ndarray],
    match_threshold: float = 0.75,
) -> tuple[IdentityVerificationStatus, Optional[float]]:
    """
    Returns (status, similarity_score). Falls back to MANUAL_CONFIRM
    whenever verification can't run -- no reference photo on file (consent
    wasn't captured), no live frame, or a model error. A MISMATCH never
    auto-resolves anything; it's a flag for the clerk, always.
    """
    if reference_embedding is None or live_frame is None:
        return IdentityVerificationStatus.MANUAL_CONFIRM, None

    try:
        live_embedding = compute_face_embedding(live_frame)
    except NotImplementedError:
        return IdentityVerificationStatus.MANUAL_CONFIRM, None

    similarity = float(
        np.dot(live_embedding, reference_embedding)
        / (np.linalg.norm(live_embedding) * np.linalg.norm(reference_embedding) + 1e-8)
    )
    if similarity >= match_threshold:
        return IdentityVerificationStatus.VERIFIED, similarity
    return IdentityVerificationStatus.MISMATCH, similarity


# ---------------------------------------------------------------------------
# Session state machine
# ---------------------------------------------------------------------------

@dataclass
class StandCameraEvent:
    session_id: UUID
    event: str          # "person_detected" | "role_selected" | "recording_started" | "stepped_down"
    at: datetime
    detail: dict


def open_session(hearing_id: UUID, camera_device_id: str = "stand-cam-01") -> CourtroomSession:
    return CourtroomSession(hearing_id=hearing_id, camera_device_id=camera_device_id)


def call_to_stand(
    session: CourtroomSession,
    person_id: UUID,
    role: HearingRole,
    identity_status: IdentityVerificationStatus,
    sequence_number: int,
) -> tuple[CourtroomSession, StatementRecord]:
    """
    Someone has stepped up and the clerk has confirmed their role. This is
    the moment the spec describes as "the camera option is set and the
    computer vision starts" -- recording begins here.
    """
    if session.active_statement_id is not None:
        raise ValueError(
            "A person is already at the stand for this session. "
            "Only one active statement per camera at a time."
        )

    statement = StatementRecord(
        hearing_id=session.hearing_id,
        person_id=person_id,
        role=role,
        identity_verification=identity_status,
        started_at=datetime.utcnow(),
        sequence_number=sequence_number,
    )
    session.active_statement_id = statement.id
    return session, statement


def step_down(
    session: CourtroomSession,
    statement: StatementRecord,
    video_uri: str,
    audio_uri: str,
    transcript: Optional[str] = None,
    transcript_confidence: Optional[float] = None,
) -> tuple[CourtroomSession, StatementRecord]:
    """Closes out the current person's turn and frees the stand for the
    next one -- defendant, then each witness in turn, per the hearing order."""
    statement.ended_at = datetime.utcnow()
    statement.video_uri = video_uri
    statement.audio_uri = audio_uri
    statement.transcript = transcript
    statement.transcript_confidence = transcript_confidence

    session.statements.append(statement.id)
    session.active_statement_id = None
    return session, statement


def next_sequence_number(session: CourtroomSession) -> int:
    return len(session.statements) + 1
