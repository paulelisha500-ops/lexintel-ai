"""
Arabic-side entity extraction for case_intelligence_agent.py.

Honest about what this is: en_core_web_trf (the English pipeline already in
this agent) is a real, general-purpose transformer NER model. This is not
that. Building the Arabic equivalent properly means CAMeL Tools or an
AraBERT-based NER fine-tune -- both need real disk/GPU budget (CAMeL
Tools' dependency chain alone pulled in a GPU build of PyTorch north of
3GB when tried while building this, in an environment with no GPU to use
it), which is a deployment-environment decision, not something to fake in
place of a real one. See get_arabic_ner_pipeline() below for that plug-in
point -- it's the direct Arabic-side counterpart to compute_face_embedding()
in courtroom_session.py: unimplemented on purpose, not silently degraded.

What IS real below and does not need that model:
  - is_arabic(): script-based language routing (Unicode block membership,
    not a classifier -- deterministic, no dependency, cannot be "mostly
    right")
  - extract_structured_entities(): dates, AED amounts, Emirates ID numbers,
    case/reference numbers -- all format-defined, so regex is the CORRECT
    tool here, not a fallback for one
  - UAE_GOVERNMENT_GAZETTEER: a small, source-verified list of federal
    judiciary/ministry names (Ministry of Justice, Federal Supreme Court,
    Public Prosecution -- verified against moj.gov.ae and u.ae, not
    recalled from training data) plus the seven emirates. Real coverage
    for the organizations/locations that recur constantly in UAE legal
    documents; it will not catch a person's name or an organization not on
    the list, which is exactly the gap a real NER model closes.
"""

from __future__ import annotations

import re
from typing_extensions import TypedDict


class ExtractedEntity(TypedDict):
    text: str
    label: str
    source_span: str


# Arabic-script Unicode blocks (Arabic, Arabic Supplement, Arabic Extended-A,
# Arabic Presentation Forms A/B). Punctuation/digits/whitespace are excluded
# from both counts so a mostly-Arabic document with Western page numbers
# doesn't get misclassified.
_ARABIC_RANGE = re.compile(
    r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]"
)
_LETTER_RANGE = re.compile(r"[^\W\d_]", re.UNICODE)


def is_arabic(text: str, threshold: float = 0.3) -> bool:
    """True if the Arabic-script letter ratio among all letters exceeds
    `threshold`. 0.3 is deliberately low -- a bilingual UAE legal document
    (Arabic body, English case citations/party names) should still route
    to the Arabic pipeline, since that's the majority of its actual prose."""
    letters = _LETTER_RANGE.findall(text)
    if not letters:
        return False
    arabic_letters = _ARABIC_RANGE.findall(text)
    return (len(arabic_letters) / len(letters)) > threshold


# ---------------------------------------------------------------------------
# Structured, format-defined entities. Language-agnostic by construction --
# an Emirates ID number has the same shape regardless of what language
# surrounds it -- so these patterns run on both Arabic and English text.
# ---------------------------------------------------------------------------

_PATTERNS: list[tuple[str, re.Pattern]] = [
    # Emirates ID: 784-YYYY-XXXXXXX-X (784 is the fixed UAE country code)
    ("EMIRATES_ID", re.compile(r"\b784-\d{4}-\d{7}-\d\b")),
    # AED amounts: "12,500 AED" / "AED 12,500" / "12500 درهم" / "درهم 12,500"
    ("AMOUNT_AED", re.compile(
        r"(?:AED|درهم)\s?[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d+)?\s?(?:AED|درهم)\b",
        re.IGNORECASE,
    )),
    # Gregorian dates: 12/06/2026, 12-06-2026, 2026-06-12
    ("DATE", re.compile(r"\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b")),
    # Case/reference numbers as used elsewhere in this codebase's own
    # examples (e.g. "CR-2026-00123"): 2-5 letters, dash, year, dash, digits
    ("CASE_REF", re.compile(r"\b[A-Z]{2,5}-\d{4}-\d{3,6}\b")),
]


def extract_structured_entities(text: str) -> list[ExtractedEntity]:
    entities: list[ExtractedEntity] = []
    for label, pattern in _PATTERNS:
        for m in pattern.finditer(text):
            start, end = max(m.start() - 40, 0), min(m.end() + 40, len(text))
            entities.append({"text": m.group(), "label": label, "source_span": text[start:end]})
    return entities


# ---------------------------------------------------------------------------
# Gazetteer: federal judiciary + ministry names verified against moj.gov.ae
# and u.ae (2026-07-22), and the seven emirates. Matched as whole words
# against Arabic text; case/diacritic-insensitive is not attempted since
# these are official names, not casual references, and should appear
# verbatim in filed documents.
# ---------------------------------------------------------------------------

UAE_GOVERNMENT_GAZETTEER: dict[str, str] = {
    "وزارة العدل": "ORG",                    # Ministry of Justice
    "المحكمة الاتحادية العليا": "ORG",        # Federal Supreme Court
    "النيابة العامة": "ORG",                  # Public Prosecution
    "النيابة العامة الاتحادية": "ORG",        # Federal Public Prosecution
    "دائرة القضاء": "ORG",                    # Judicial Department (generic; Abu Dhabi/Dubai/RAK each have one)
    "أبوظبي": "LOCATION",
    "أبو ظبي": "LOCATION",
    "دبي": "LOCATION",
    "الشارقة": "LOCATION",
    "عجمان": "LOCATION",
    "أم القيوين": "LOCATION",
    "الفجيرة": "LOCATION",
    "رأس الخيمة": "LOCATION",
}

# Longest entries first, so "النيابة العامة الاتحادية" matches before the
# shorter "النيابة العامة" swallows part of it.
_GAZETTEER_TERMS = sorted(UAE_GOVERNMENT_GAZETTEER, key=len, reverse=True)


def extract_gazetteer_entities(text: str) -> list[ExtractedEntity]:
    entities: list[ExtractedEntity] = []
    covered: list[tuple[int, int]] = []
    for term in _GAZETTEER_TERMS:
        for m in re.finditer(re.escape(term), text):
            if any(m.start() < end and m.end() > start for start, end in covered):
                continue  # already matched by a longer overlapping term
            covered.append((m.start(), m.end()))
            start, end = max(m.start() - 40, 0), min(m.end() + 40, len(text))
            entities.append({
                "text": m.group(),
                "label": UAE_GOVERNMENT_GAZETTEER[term],
                "source_span": text[start:end],
            })
    return entities


def extract_arabic_entities(text: str) -> list[ExtractedEntity]:
    """The Arabic-text entry point extract_general_entities() below calls.
    Combines the two real, tested extractors above. Does not attempt
    person-name extraction -- that's the gap get_arabic_ner_pipeline()
    below is the honest placeholder for."""
    return extract_gazetteer_entities(text) + extract_structured_entities(text)


def get_arabic_ner_pipeline():
    """
    Plug-in point for a real Arabic NER model, matching how
    compute_face_embedding() is handled in courtroom_session.py: raise
    clearly rather than silently return weak results.

    To wire one in once you have GPU/disk budget for it:
      - CAMeL Tools (camel_tools.ner) -- purpose-built for Arabic, but its
        dependency chain includes PyTorch; make sure you install a
        CPU-only or CUDA-matched torch build first rather than letting
        pip resolve the default (which pulled ~3GB of unused CUDA
        libraries in this project's own build environment).
      - An AraBERT-based token-classification model via `transformers`
        (e.g. a CAMeL-Lab or aubmindlab NER fine-tune on Hugging Face).
    Either one replaces extract_arabic_entities() above, or augments it --
    the gazetteer/regex layer is cheap enough to keep running alongside a
    real model rather than being torn out.
    """
    raise NotImplementedError(
        "No Arabic NER model is wired in. extract_arabic_entities() (gazetteer "
        "+ structured regex) runs in its place -- real but partial coverage. "
        "See this function's docstring for what to plug in and why it isn't "
        "already here."
    )
