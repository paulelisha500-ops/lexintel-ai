"""
Case brief: what the file says, in one place, for a judge or lawyer
opening a case (Modules 2, 12).

`gather()` is extractive and instant: key sentences from the case
description, each processed evidence document and each statement (all in
the original words), the dated timeline, offence mentions across the file
and every law the documents cite. `draft_messages()` turns those notes into
a prompt for the local writing model, whose draft is streamed and checked
against the same notes (app/ai/drafting.py).

Neither part weighs evidence, judges credibility or suggests an outcome.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.ai.summarize import extractive_summary
from app.db.mongo_repository import StatementRepository, get_mongo_db, mongo_probe
from app.db.postgres_repository import EvidenceRepository
from app.models.schemas import Case

MAX_EVIDENCE = 8
MAX_STATEMENTS = 8
SENTENCES_PER_SOURCE = 2
MIN_SENTENCES_FOR_DRAFT = 3


def _best_sentences(summary_sentences: list[dict]) -> list[str]:
    """The strongest few sentences of a stored summary, kept in document order."""
    ranked = sorted(summary_sentences, key=lambda s: s.get("rank", s.get("index", 0)))[:SENTENCES_PER_SOURCE]
    return [s["text"] for s in sorted(ranked, key=lambda s: s.get("index", 0))]


def gather(db: Session, case: Case) -> dict:
    sections: list[dict] = []
    offences: dict[str, dict] = {}
    references: dict[str, dict] = {}
    notes: list[str] = []

    def add_offences(mentions: list[dict], source: str) -> None:
        for m in mentions or []:
            entry = offences.setdefault(m["offence"], {"offence": m["offence"], "label_en": m["label_en"],
                                                       "label_ar": m["label_ar"], "sources": [], "example": m["sentence"]})
            if source not in entry["sources"]:
                entry["sources"].append(source)

    if (case.description or "").strip():
        summary = extractive_summary(case.description, max_sentences=3, max_chars=700, wait_for_model=False)
        if summary["sentences"]:
            sections.append({"kind": "case", "label": "Case description", "label_ar": "وصف القضية", "ref": None,
                             "sentences": [s["text"] for s in summary["sentences"]], "method": summary["method"]})

    for ev in EvidenceRepository(db).list_for_case(case.id)[:MAX_EVIDENCE * 2]:
        info = ev.ai_summary or {}
        sentences = _best_sentences((info.get("summary") or {}).get("sentences", []))
        if not sentences:
            continue
        sections.append({"kind": "evidence", "label": ev.label, "label_ar": ev.label, "ref": f"evidence:{ev.id}",
                         "sentences": sentences, "method": (info.get("summary") or {}).get("method")})
        add_offences(info.get("offence_mentions"), ev.label)
        for r in info.get("legal_references") or []:
            references.setdefault(r["reference"].lower(), {**r, "source": ev.label})
        if sum(1 for s in sections if s["kind"] == "evidence") >= MAX_EVIDENCE:
            break

    if mongo_probe.available():
        try:
            statements = StatementRepository(get_mongo_db()).list_for_case(str(case.id))
        except Exception:
            statements = []
            notes.append("Statements could not be read just now.")
        for st in statements[:MAX_STATEMENTS]:
            label = f"Statement: {st.person_name or st.role.value}"
            sentences = _best_sentences((st.summary or {}).get("sentences", []))
            if not sentences and (st.transcript or "").strip():
                sentences = [s["text"] for s in extractive_summary(
                    st.transcript, SENTENCES_PER_SOURCE, wait_for_model=False)["sentences"]]
            if sentences:
                sections.append({"kind": "statement", "label": label,
                                 "label_ar": f"إفادة: {st.person_name or st.role.value}",
                                 "ref": f"statement:{st.id}", "sentences": sentences})
            add_offences(st.offence_mentions, label)
    else:
        notes.append("Statements are unavailable while MongoDB is down.")

    dated = sorted((t for t in case.timeline if t.event_date), key=lambda t: t.event_date)
    timeline = [{"date": t.event_date.isoformat(), "description": t.description[:300], "source": t.source_label}
                for t in dated[:12]]

    return {
        "case_id": str(case.id),
        "sections": sections,
        "timeline": timeline,
        "offence_mentions": sorted(offences.values(), key=lambda o: len(o["sources"]), reverse=True),
        "legal_references": list(references.values())[:20],
        "notes": notes,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "Key sentences are quoted from the file. Offence mentions show where a topic is discussed; "
                      "they are not charges and say nothing about whether anything happened.",
    }


SYSTEM_EN = """You write a short, neutral case brief for a judge, using ONLY the numbered notes below.
Rules:
1. At most one sentence per note and at most 6 sentences in total, in plain English.
2. Attribute each point to where it comes from ("the police report states...", "the witness said...").
3. Do not add facts, names, dates or numbers that are not in the notes. If a party's position is not in the
   notes, do not describe one.
4. Never say or imply that anyone is guilty, innocent, lying or credible, never say what the case "hinges on",
   and never recommend a decision.
5. Write plain sentences: no markdown, no headings, no bullet points and no numbering."""

SYSTEM_AR = """اكتب ملخصاً محايداً وقصيراً للقضية موجهاً للقاضي، معتمداً فقط على الملاحظات المرقمة أدناه.
القواعد:
1. جملة واحدة على الأكثر لكل ملاحظة، وست جمل على الأكثر إجمالاً، باللغة العربية الفصحى فقط.
2. انسب كل معلومة إلى مصدرها (مثل: "يذكر محضر الشرطة..."، "أفاد الشاهد...").
3. لا تضف وقائع أو أسماء أو تواريخ أو أرقاماً غير موجودة في الملاحظات، وإذا لم يرد موقف أحد الأطراف فلا تصفه.
4. لا تذكر ولا تلمح إلى أن أحداً مدان أو بريء أو كاذب أو صادق، ولا تحدد ما تتوقف عليه القضية، ولا توصِ بأي قرار.
5. اكتب جملاً عادية دون تنسيق أو عناوين أو نقاط أو ترقيم."""


def draft_sources(brief: dict) -> list[str]:
    """One numbered note per section: its label and key sentences."""
    return [f"{s['label']}: " + " ".join(s["sentences"]) for s in brief["sections"]][:10]


def draft_messages(case: Case, brief: dict, language: str) -> list[dict[str, str]]:
    sources = draft_sources(brief)
    numbered = "\n".join(f"[{i + 1}] {text}" for i, text in enumerate(sources))
    header = f"{case.case_number} — {case.title}"
    if language == "ar":
        user = f"القضية: {header}\n\nالملاحظات:\n{numbered}"
    else:
        user = f"Case: {header}\n\nNotes:\n{numbered}"
    return [{"role": "system", "content": SYSTEM_AR if language == "ar" else SYSTEM_EN},
            {"role": "user", "content": user}]
