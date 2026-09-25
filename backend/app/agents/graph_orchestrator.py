"""
Complaint intake orchestration (Module 1): classify -> duplicate check ->
priority -> department routing suggestion, as a small LangGraph graph.

Runs for every complaint filed through the public portal (see
app/tasks.py::classify_complaint). Each node degrades instead of failing:
  - classify: the semantic nearest-neighbour classifier (app/ai/classifier.py),
    which learns from staff decisions; a bilingual keyword classifier if the
    embedding model can't run. Both agreeing raises the confidence.
  - duplicate check: meaning similarity against recent complaints, plus word
    overlap; Elasticsearch "more like this" adds candidates when reachable.
Nothing here decides anything about guilt, charges, or outcome. It ends at
"suggested category X, department Y, priority Z, here's why" -- a human
reviews it in the triage screen before anything else happens.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Callable, Optional
from typing_extensions import TypedDict

from langgraph.graph import END, START, StateGraph

from app.agents.prioritization_agent import CaseSignals, score_case

CATEGORIES = ("criminal", "civil", "cybercrime", "traffic", "grievance")

DEFAULT_DEPARTMENTS = {
    "criminal": "Public Prosecution",
    "cybercrime": "Police - Cybercrime Unit",
    "traffic": "Traffic Department",
    "civil": "Civil Courts - Case Management Office",
    "grievance": "Government Services Grievance Office",
}

# Bilingual keyword lists for the non-AI fallback. Deliberately conservative:
# a wrong confident guess is worse than "no strong signal".
KEYWORDS: dict[str, list[str]] = {
    "cybercrime": [
        "hack", "hacked", "phishing", "scam", "online", "website", "email", "password", "otp", "whatsapp",
        "instagram", "social media", "cyber", "blackmail", "sextortion", "crypto", "bank card", "sms",
        "اختراق", "احتيال إلكتروني", "تصيد", "ابتزاز", "حساب", "رسالة نصية", "الإنترنت", "واتساب", "بطاقة",
    ],
    "traffic": [
        "accident", "collision", "crash", "car", "vehicle", "speeding", "parking", "road", "driver",
        "plate", "radar", "hit and run", "traffic", "lane", "truck",
        "حادث", "سيارة", "مرور", "تصادم", "مخالفة", "سرعة", "طريق", "سائق", "مركبة",
    ],
    "criminal": [
        "theft", "stole", "stolen", "assault", "attack", "robbery", "threat", "violence", "drugs", "murder",
        "fight", "harassment", "weapon", "knife", "burglary", "break-in", "abuse", "kidnap",
        "سرقة", "اعتداء", "تهديد", "ضرب", "مخدرات", "تحرش", "عنف", "سلاح", "سطو",
    ],
    "civil": [
        "contract", "rent", "landlord", "tenant", "salary", "wages", "debt", "payment", "employer", "refund",
        "deposit", "property", "cheque", "check bounced", "gratuity", "invoice", "compensation", "lease",
        "عقد", "إيجار", "راتب", "دين", "مالك", "مستأجر", "تعويض", "شيك", "مستحقات",
    ],
    "grievance": [
        "government", "service", "delay", "municipality", "noise", "permit", "license", "visa", "public office",
        "complaint about", "employee rude", "waiting",
        "شكوى", "خدمة", "تأخير", "بلدية", "إزعاج", "تصريح", "رخصة", "تأشيرة",
    ],
}


class IntakeState(TypedDict, total=False):
    complaint_id: str
    raw_text: str
    citizen_category: Optional[str]
    case_opened_on: str
    case_type: Optional[str]
    department: Optional[str]
    confidence: float
    classification_source: str        # semantic | keywords
    classification_reason: str
    classification_details: dict
    duplicate_candidates: list[dict]
    is_likely_duplicate: bool
    priority_level: Optional[str]
    priority_explanation: Optional[str]
    needs_human_review: bool


def keyword_classify(text: str, citizen_category: str | None = None) -> tuple[str, float, str]:
    lowered = text.lower()
    scores: dict[str, int] = {}
    matched: dict[str, list[str]] = {}
    for category, words in KEYWORDS.items():
        hits = [w for w in words if w in lowered]
        if hits:
            scores[category] = len(hits)
            matched[category] = hits[:4]
    if not scores:
        fallback = citizen_category if citizen_category in CATEGORIES else "grievance"
        return fallback, 0.35, "No strong keyword signal; kept the category chosen by the citizen."
    best = max(scores, key=lambda c: (scores[c], c == citizen_category))
    total = sum(scores.values())
    confidence = round(min(0.8, 0.4 + 0.4 * scores[best] / total), 2)
    reason = f"Keyword match ({', '.join(matched[best])})."
    return best, confidence, reason


def classify_node(state: IntakeState) -> dict:
    from app.ai import embeddings
    from app.ai.classifier import classifier

    text = state["raw_text"]
    citizen = state.get("citizen_category")
    kw_type, kw_confidence, kw_reason = keyword_classify(text, citizen)
    try:
        result = classifier.classify(text, citizen)
    except embeddings.ModelUnavailable as exc:
        return {
            "case_type": kw_type,
            "department": DEFAULT_DEPARTMENTS[kw_type],
            "confidence": kw_confidence,
            "classification_source": "keywords",
            "classification_reason": f"{kw_reason} The meaning-matching model is unavailable, so this is a keyword-based suggestion.",
            "classification_details": {"method": "keywords", "error": str(exc)[:200]},
        }
    case_type, confidence, reason = result["case_type"], result["confidence"], result["reason"]
    if kw_confidence > 0.35 and kw_type == case_type:
        confidence = min(0.95, confidence + 0.1)
        reason += f" Keywords agree ({kw_reason.removeprefix('Keyword match ').strip('().')})."
    return {
        "case_type": case_type,
        "department": DEFAULT_DEPARTMENTS[case_type],
        "confidence": round(confidence, 2),
        "classification_source": "semantic",
        "classification_reason": reason,
        "classification_details": {**result["details"], "keyword_suggestion": kw_type},
    }


_TOKEN_RE = re.compile(r"[\w؀-ۿ]{3,}", re.UNICODE)


def token_similarity(a: str, b: str) -> float:
    ta, tb = set(_TOKEN_RE.findall(a.lower())), set(_TOKEN_RE.findall(b.lower()))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


# Duplicate thresholds. "meaning" is embedding cosine similarity, "wording"
# is word overlap (Jaccard). Same-incident re-filings score high on meaning
# even when reworded or written in the other language.
# Calibrated on bilingual pairs: the same incident reworded scored 0.71 and
# translated 0.77; different incidents of the same kind 0.34-0.57.
DUPLICATE_MEANING = 0.70
CANDIDATE_MEANING = 0.60
DUPLICATE_WORDING = 0.75
CANDIDATE_WORDING = 0.35


def _scores(c: dict) -> tuple[float | None, float]:
    meaning = c.get("meaning")
    wording = c.get("wording", c.get("similarity", 0.0) if meaning is None else 0.0)
    return meaning, float(wording or 0.0)


def is_likely_duplicate(c: dict) -> bool:
    meaning, wording = _scores(c)
    if wording >= DUPLICATE_WORDING:
        return True
    return meaning is not None and (meaning >= DUPLICATE_MEANING or (meaning >= 0.65 and wording >= 0.25))


def is_candidate(c: dict) -> bool:
    meaning, wording = _scores(c)
    return wording >= CANDIDATE_WORDING or (meaning is not None and meaning >= CANDIDATE_MEANING)


def duplicate_check_node(state: IntakeState, search_similar_complaints: Callable) -> dict:
    """`search_similar_complaints(text, top_k)` -> [{id, reference_number, similarity, meaning?, wording?}] --
    injected so this node is testable without a live database or search cluster."""
    try:
        candidates = search_similar_complaints(state["raw_text"], top_k=3) or []
    except Exception:
        candidates = []
    candidates = [c for c in candidates if is_candidate(c)]
    return {
        "duplicate_candidates": candidates,
        "is_likely_duplicate": any(is_likely_duplicate(c) for c in candidates),
    }


def priority_node(state: IntakeState) -> dict:
    text = state.get("raw_text", "").lower()
    signals: CaseSignals = {
        "case_id": state["complaint_id"],
        "public_safety_flag": state.get("case_type") in ("criminal", "cybercrime")
        and any(w in text for w in ("threat", "weapon", "violence", "تهديد", "سلاح", "عنف", "knife", "attack")),
        "statutory_deadline": None,
        "vulnerable_victim": any(w in text for w in ("child", "minor", "elderly", "disabled", "طفل", "قاصر", "كبير السن")),
        "missing_critical_evidence": False,
        "case_opened_on": state.get("case_opened_on") or date.today().isoformat(),
    }
    assessment = score_case(signals)
    return {
        "priority_level": assessment.level.value,
        "priority_explanation": assessment.explanation,
        "needs_human_review": True,
    }


def build_intake_graph(search_similar_complaints: Callable):
    builder = StateGraph(IntakeState)
    builder.add_node("classify", classify_node)
    builder.add_node("duplicate_check", lambda s: duplicate_check_node(s, search_similar_complaints))
    builder.add_node("prioritize", priority_node)

    builder.add_edge(START, "classify")
    builder.add_edge("classify", "duplicate_check")
    builder.add_edge("duplicate_check", "prioritize")
    builder.add_edge("prioritize", END)
    return builder.compile()
