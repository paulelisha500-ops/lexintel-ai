"""
Case Prioritization Agent (Module 4).

Recommends a review priority (High/Medium/Low) from configurable, factual,
inspectable signals -- never anything about the parties' likely guilt or
credibility. Every score comes with a factor-by-factor explanation so a clerk
or judge can see, and override, exactly why a case was ranked the way it was.

Deliberately a weighted sum, not a black-box model: explainability matters
more than marginal accuracy here (Module 12, docs/DESIGN_DECISIONS.md).
"""

from __future__ import annotations

from datetime import date
from typing_extensions import TypedDict
from uuid import UUID

from app.core.config import get_settings
from app.models.schemas import PriorityAssessment, PriorityLevel


class CaseSignals(TypedDict, total=False):
    """Inputs a clerk/system supplies about a case -- all factual and
    observable, nothing inferred about a person's state of mind."""
    case_id: str
    public_safety_flag: bool
    statutory_deadline: str | None    # ISO date
    vulnerable_victim: bool
    missing_critical_evidence: bool
    case_opened_on: str               # ISO date


def _parse_date(value, fallback: date) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return fallback


def score_case(signals: CaseSignals) -> PriorityAssessment:
    weights = get_settings().priority_weights
    factors: dict[str, float] = {}
    today = date.today()

    factors["public_safety_flag"] = weights["public_safety_flag"] if signals.get("public_safety_flag") else 0.0

    days_left = None
    if signals.get("statutory_deadline"):
        deadline = _parse_date(signals["statutory_deadline"], today)
        days_left = (deadline - today).days
        if days_left <= 0:
            urgency = 1.0
        elif days_left <= 30:
            urgency = (30 - days_left) / 30
        else:
            urgency = 0.0
        factors["approaching_statutory_deadline"] = weights["days_to_statutory_deadline"] * urgency
    else:
        factors["approaching_statutory_deadline"] = 0.0

    factors["vulnerable_victim"] = weights["vulnerable_victim"] if signals.get("vulnerable_victim") else 0.0
    factors["missing_critical_evidence"] = (
        weights["missing_critical_evidence"] if signals.get("missing_critical_evidence") else 0.0
    )

    opened = _parse_date(signals.get("case_opened_on"), today)
    age_days = max(0, (today - opened).days)
    factors["case_age"] = weights["days_case_open"] * min(1.0, age_days / 180)

    total = sum(factors.values())
    if total >= 0.5:
        level = PriorityLevel.HIGH
    elif total >= 0.25:
        level = PriorityLevel.MEDIUM
    else:
        level = PriorityLevel.LOW

    parts = []
    if factors["public_safety_flag"] > 0:
        parts.append("an active public-safety flag")
    if factors["approaching_statutory_deadline"] > 0:
        parts.append("a statutory deadline that has passed" if days_left is not None and days_left <= 0
                     else f"a statutory deadline in {days_left} days")
    if factors["vulnerable_victim"] > 0:
        parts.append("a vulnerable victim on record")
    if factors["missing_critical_evidence"] < 0:
        parts.append("critical evidence still missing (flagged for human review)")
    if factors["case_age"] > weights["days_case_open"] * 0.5:
        parts.append(f"the case has been open {age_days} days")

    explanation = (
        f"Recommended as {level.value.upper()} priority based on: "
        + (", ".join(parts) if parts else "no elevated-priority factors")
        + ". This is a workload recommendation only -- it reflects nothing "
          "about the merits of the case or any party's guilt."
    )

    return PriorityAssessment(
        case_id=UUID(str(signals["case_id"])),
        level=level,
        score=round(total, 3),
        factors={k: round(v, 3) for k, v in factors.items()},
        explanation=explanation,
        requires_human_review=bool(signals.get("missing_critical_evidence", False)),
    )
