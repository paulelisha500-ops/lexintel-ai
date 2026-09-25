"""
Case Intelligence Agent (Module 2) -- LangGraph.

Takes raw case text (complaint narrative, OCR'd evidence, hearing transcripts)
and extracts structured entities -- people, organizations, locations, dates,
amounts, charges, evidence references -- then assembles dated timeline events.

This agent produces STRUCTURE, not JUDGMENT: it never labels a charge as
proven, never ranks parties by culpability, never infers intent.

Offences and laws: offence *mentions* are found by meaning (app/ai/offences.py),
each with the sentence that mentions it, and cited laws/articles by pattern.
No generative model is involved, so nothing here can invent a charge.

Resilience: each node degrades instead of failing. No spaCy model ->
structured regex only. No embedding model -> cited laws only, flagged in `warnings`.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Any
from typing_extensions import TypedDict

from langgraph.graph import END, START, StateGraph

from app.agents.arabic_ner import extract_arabic_entities, extract_structured_entities, is_arabic

log = logging.getLogger("lexintel.intelligence")

_NLP = None
_NLP_FAILED = False


def get_nlp():
    global _NLP, _NLP_FAILED
    if _NLP is None and not _NLP_FAILED:
        import spacy

        from app.core.config import get_settings

        for model in dict.fromkeys([get_settings().spacy_model, "en_core_web_sm", "en_core_web_trf"]):
            try:
                _NLP = spacy.load(model)
                log.info("loaded spaCy model %s", model)
                break
            except Exception as exc:
                log.warning("spaCy model %s unavailable: %s", model, exc)
        if _NLP is None:
            _NLP_FAILED = True
    return _NLP


class ExtractedEntity(TypedDict):
    text: str
    label: str          # PERSON | ORG | LOCATION | DATE | CHARGE | LEGAL_REF | AMOUNT_AED | EMIRATES_ID | CASE_REF
    source_span: str


class CaseIntelligenceState(TypedDict, total=False):
    case_id: str
    raw_text: str
    document_label: str
    entities: list[ExtractedEntity]
    charges_mentioned: list[str]
    offence_mentions: list[dict]
    legal_references: list[dict]
    timeline_events: list[dict]
    warnings: list[str]
    llm_used: bool


def _dedupe(entities: list[ExtractedEntity]) -> list[ExtractedEntity]:
    seen, out = set(), []
    for e in entities:
        key = (e["label"], e["text"].strip().lower())
        if e["text"].strip() and key not in seen:
            seen.add(key)
            out.append(e)
    return out


def extract_general_entities(state: CaseIntelligenceState) -> dict:
    raw_text = state["raw_text"]
    warnings = list(state.get("warnings", []))

    if is_arabic(raw_text):
        return {"entities": _dedupe(extract_arabic_entities(raw_text)), "warnings": warnings}

    entities: list[ExtractedEntity] = list(extract_structured_entities(raw_text))
    nlp = get_nlp()
    if nlp is None:
        warnings.append("English named-entity model unavailable; only dates, amounts and IDs were extracted.")
    else:
        label_map = {"PERSON": "PERSON", "ORG": "ORG", "GPE": "LOCATION", "LOC": "LOCATION",
                     "FAC": "LOCATION", "DATE": "DATE", "TIME": "TIME", "MONEY": "AMOUNT"}
        try:
            doc = nlp(raw_text[:100_000])
            for ent in doc.ents:
                mapped = label_map.get(ent.label_)
                if not mapped:
                    continue
                start, end = max(ent.start_char - 60, 0), min(ent.end_char + 60, len(raw_text))
                entities.append({"text": ent.text, "label": mapped, "source_span": raw_text[start:end]})
        except Exception as exc:
            warnings.append(f"Named-entity pass failed ({type(exc).__name__}); structured extraction only.")
    return {"entities": _dedupe(entities), "warnings": warnings}


def extract_charges_and_evidence(state: CaseIntelligenceState) -> dict:
    """Offence mentions (by meaning) and legal references (by pattern) -- reading aids, not charges."""
    from app.ai.offences import legal_references, offence_mentions

    warnings = list(state.get("warnings", []))
    text = state["raw_text"]
    references = legal_references(text)
    mentions = offence_mentions(text)
    if mentions["method"] == "unavailable":
        warnings.append("The meaning-matching model is unavailable, so offence mentions were skipped; "
                        "cited laws, entities and the timeline were still extracted.")
    charges = [m["label_en"] for m in mentions["mentions"]]
    extra: list[ExtractedEntity] = [
        {"text": r["reference"], "label": "LEGAL_REF", "source_span": r["context"]} for r in references
    ]
    return {
        "charges_mentioned": charges,
        "offence_mentions": mentions["mentions"],
        "legal_references": references,
        "entities": _dedupe(state.get("entities", []) + extra),
        "warnings": warnings,
        "llm_used": False,
    }


_MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
     "November", "December"], start=1)}
_MONTHS.update({k[:3]: v for k, v in list(_MONTHS.items())})


def parse_date(text: str) -> date | None:
    """Best-effort absolute date parsing; relative dates ("last Tuesday") stay undated."""
    t = text.strip().replace(",", " ")
    t = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", t)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            pass
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})", t)
    if m and m.group(2).lower() in _MONTHS:
        try:
            return date(int(m.group(3)), _MONTHS[m.group(2).lower()], int(m.group(1)))
        except ValueError:
            return None
    m = re.search(r"([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})", t)
    if m and m.group(1).lower() in _MONTHS:
        try:
            return date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))
        except ValueError:
            return None
    return None


def build_timeline_events(state: CaseIntelligenceState) -> dict:
    events: list[dict[str, Any]] = []
    for ent in state.get("entities", []):
        if ent["label"] != "DATE":
            continue
        parsed = parse_date(ent["text"])
        description = re.sub(r"\s+", " ", ent["source_span"]).strip() or ent["text"]
        events.append({
            "case_id": state["case_id"],
            "event_date": parsed.isoformat() if parsed else None,
            "event_date_raw": ent["text"],
            "description": description,
            "entity_type": "event",
        })
    events.sort(key=lambda e: (e["event_date"] is None, e["event_date"] or ""))
    return {"timeline_events": events}


def build_case_intelligence_graph():
    builder = StateGraph(CaseIntelligenceState)
    builder.add_node("extract_general_entities", extract_general_entities)
    builder.add_node("extract_charges_and_evidence", extract_charges_and_evidence)
    builder.add_node("build_timeline", build_timeline_events)

    builder.add_edge(START, "extract_general_entities")
    builder.add_edge("extract_general_entities", "extract_charges_and_evidence")
    builder.add_edge("extract_charges_and_evidence", "build_timeline")
    builder.add_edge("build_timeline", END)
    return builder.compile()


def run_case_intelligence(case_id: str, raw_text: str, document_label: str) -> dict:
    """Never raises: returns empty results with a warning if the whole graph fails."""
    try:
        return build_case_intelligence_graph().invoke(
            {"case_id": case_id, "raw_text": raw_text, "document_label": document_label, "warnings": []}
        )
    except Exception as exc:
        log.exception("case intelligence failed")
        return {"entities": [], "charges_mentioned": [], "offence_mentions": [], "legal_references": [],
                "timeline_events": [], "llm_used": False,
                "warnings": [f"Case intelligence failed: {type(exc).__name__}"]}


# ---------------------------------------------------------------------------
# Fact comparison between two sources in the same case.
# Reports factual details (dates, times, places, amounts, IDs) that appear in
# one source but not the other, with the surrounding quote. It is a reading
# aid for a lawyer or judge -- never a credibility or truthfulness judgment.
# ---------------------------------------------------------------------------

_COMPARE_LABELS = ("DATE", "TIME", "LOCATION", "AMOUNT", "AMOUNT_AED", "EMIRATES_ID", "CASE_REF", "PERSON", "ORG")

_SAME_POINT = 0.62   # sentences this close in meaning describe the same point


def _aligned_differences(text_a: str, text_b: str) -> tuple[list[dict], str]:
    """Pairs of sentences that describe the same point (by meaning, across Arabic and
    English) but state different figures, dates or times."""
    from app.ai import embeddings
    from app.ai.text import figures, split_sentences

    sa, sb = split_sentences(text_a, limit=150), split_sentences(text_b, limit=150)
    if not sa or not sb:
        return [], "none"
    try:
        vectors = embeddings.embed(sa + sb)
    except embeddings.ModelUnavailable:
        return [], "unavailable"
    sims = vectors[:len(sa)] @ vectors[len(sa):].T
    out, seen_b = [], set()
    for i, row in enumerate(sims):
        j = int(row.argmax())
        # mutual best match only, so one sentence isn't paired with several
        if row[j] < _SAME_POINT or int(sims[:, j].argmax()) != i or j in seen_b:
            continue
        fa, fb = figures(sa[i]), figures(sb[j])
        if fa and fb and fa != fb:
            seen_b.add(j)
            out.append({"topic": ", ".join(sorted(fa ^ fb))[:120], "source_a": sa[i][:600], "source_b": sb[j][:600],
                        "similarity": round(float(row[j]), 2)})
    out.sort(key=lambda d: d["similarity"], reverse=True)
    return out[:20], "semantic"


def compare_sources(label_a: str, text_a: str, label_b: str, text_b: str) -> dict:
    ents_a = extract_general_entities({"raw_text": text_a, "warnings": []})["entities"]
    ents_b = extract_general_entities({"raw_text": text_b, "warnings": []})["entities"]

    def _group(ents):
        out: dict[str, dict[str, str]] = {}
        for e in ents:
            if e["label"] in _COMPARE_LABELS:
                out.setdefault(e["label"], {})[e["text"].strip().lower()] = e["source_span"] or e["text"]
        return out

    ga, gb = _group(ents_a), _group(ents_b)
    only: list[dict] = []
    for label in sorted(set(ga) | set(gb)):
        a_keys, b_keys = set(ga.get(label, {})), set(gb.get(label, {}))
        if a_keys and b_keys:
            for k in sorted(a_keys - b_keys)[:8]:
                only.append({"label": label, "value": k, "present_in": label_a, "context": ga[label][k]})
            for k in sorted(b_keys - a_keys)[:8]:
                only.append({"label": label, "value": k, "present_in": label_b, "context": gb[label][k]})

    differences, method = _aligned_differences(text_a, text_b)
    if method == "semantic":
        summary = (f"{len(differences)} point(s) are described in both sources with different figures, dates or times."
                   if differences else "No point described in both sources states different figures, dates or times.")
    else:
        summary = None

    return {
        "source_a": label_a,
        "source_b": label_b,
        "detail_differences": only,
        "ai_differences": differences,
        "ai_summary": summary,
        "ai_used": method == "semantic",
        "method": method,
        "disclaimer": "Lists differences in stated facts only. It does not assess truthfulness or credibility.",
    }
