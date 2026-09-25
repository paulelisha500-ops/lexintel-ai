"""
Legal Research Agent (Module 6).

Answers questions from the ingested UAE law corpus (Law Library uploads,
app/ingestion/law_library.py) in two stages, so the reader always gets the
law immediately and the model's prose only as a checked extra:

  1. Sources (instant, no generative model): hybrid retrieval -- FAISS
     semantic search + Elasticsearch keyword search, merged by reciprocal
     rank -- then law not in force on `as_of_date` is removed, then the key
     passages (the sentences that best answer the question) are picked out.
  2. Draft (optional, local model): a short explanation written only from
     those sources, streamed as it is written, then
       - rejected if it drifts into another language or script,
       - checked sentence by sentence against the sources; citations are
         computed by that check, not trusted from the model, and sentences
         that match no source are flagged.

Guarantees enforced structurally, not by prompting:
  - repealed / not-yet-in-force law is filtered out BEFORE the model sees it;
  - every answer carries citations with the exact article text excerpt;
  - no model, a busy model or an unusable draft all degrade to "here are the
    in-force articles and key passages" with needs_human_review -- never an error;
  - the system prompt forbids predicting outcomes or advising strategy.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Iterator, Optional
from typing_extensions import TypedDict

from app.ai.drafting import stream_grounded_draft
from app.ai.summarize import key_passages
from app.ai.text import language_of
from app.db import search
from app.ingestion import law_library

log = logging.getLogger("lexintel.research")

MAX_SOURCES = 6
PROMPT_SOURCES = 4          # sources the draft is written from (CPU time grows with prompt length)
PROMPT_CHARS_PER_SOURCE = 1100
DRAFT_TOKENS = 450
MIN_SUPPORTED_RATIO = 0.34  # below this share of matched sentences the draft is withheld


class Citation(TypedDict, total=False):
    source_title: str
    article: Optional[str]
    article_label: Optional[str]
    url: str
    effective_from: Optional[str]
    effective_to: Optional[str]
    jurisdiction: str
    law_document_id: Optional[str]
    excerpt: str


def _hit(metadata: dict, text: str) -> dict:
    return {"metadata": dict(metadata), "text": text}


# ---------------------------------------------------------------------------
# Stage 1: sources
# ---------------------------------------------------------------------------

def retrieve(question: str, jurisdiction: Optional[str]) -> tuple[list[dict], list[str]]:
    ranked: dict[str, dict] = {}
    scores: dict[str, float] = {}
    sources: list[str] = []

    store = law_library.load_store()
    if store is not None:
        try:
            kwargs: dict[str, Any] = {"k": 10}
            if jurisdiction:
                kwargs.update(filter={"jurisdiction": jurisdiction}, fetch_k=60)
            for rank, doc in enumerate(store.similarity_search(question, **kwargs)):
                key = f"{doc.metadata.get('law_document_id')}:{doc.metadata.get('article')}"
                ranked.setdefault(key, _hit(doc.metadata, doc.page_content))
                scores[key] = scores.get(key, 0.0) + 1.0 / (60 + rank)
            sources.append("semantic")
        except Exception as exc:
            log.warning("FAISS retrieval failed: %s", exc)

    hits = search.law_search(question, jurisdiction=jurisdiction, limit=10)
    if hits:
        for rank, h in enumerate(hits):
            src = h["source"]
            key = f"{src.get('law_document_id')}:{src.get('article')}"
            meta = {k: v for k, v in src.items() if k not in ("body", "vector")}
            ranked.setdefault(key, _hit(meta, src.get("body", "")))
            scores[key] = scores.get(key, 0.0) + 1.0 / (60 + rank)
        sources.append("keyword")

    ordered = sorted(ranked, key=lambda k: scores[k], reverse=True)
    return [ranked[k] for k in ordered], sources


def filter_by_effective_date(hits: list[dict], as_of: Optional[str]) -> list[dict]:
    """The single most important correctness guard: drop law not in force on as_of."""
    as_of = as_of or date.today().isoformat()
    kept = []
    for hit in hits:
        meta = hit["metadata"]
        eff_from, eff_to = meta.get("effective_from"), meta.get("effective_to")
        if meta.get("legislation_state") in ("repealed",) and not eff_to:
            continue
        if eff_from and str(eff_from) > as_of:
            continue
        if eff_to and str(eff_to) < as_of:
            continue
        kept.append(hit)
    return kept[:MAX_SOURCES]


def _citation(d: dict) -> Citation:
    m = d["metadata"]
    return {
        "source_title": m.get("title", "Untitled"),
        "article": m.get("article"),
        "article_label": m.get("article_label") or (f"Art. {m['article']}" if m.get("article") else None),
        "url": m.get("source_url") or "",
        "effective_from": m.get("effective_from"),
        "effective_to": m.get("effective_to"),
        "jurisdiction": m.get("jurisdiction", "federal"),
        "law_document_id": m.get("law_document_id"),
        "excerpt": (d["text"] or "")[:700],
    }


def corpus_available() -> bool:
    # An index file can outlive its last law (every document removed), so count articles.
    return law_library.article_count() > 0 or bool(search.doc_count("law"))


def prepare(question: str, as_of_date: str | None = None, jurisdiction: str | None = None) -> dict:
    """Stage 1. Everything the reader needs that doesn't require the writing model."""
    base = {"question": question, "as_of_date": as_of_date or date.today().isoformat(),
            "language": language_of(question), "answer": "", "grounding": None}
    if not corpus_available():
        return {**base, "status": "no_corpus", "answer_status": "no_corpus", "citations": [], "key_passages": [],
                "confidence": 0.0, "needs_human_review": True, "retrieval_sources": [], "_docs": [],
                "review_reason": "The Law Library is empty. Upload official law PDFs in the Law Library to enable research."}
    hits, retrieval_sources = retrieve(question, jurisdiction)
    docs = filter_by_effective_date(hits, as_of_date)
    if not docs:
        return {**base, "status": "ok", "answer_status": "no_sources", "citations": [], "key_passages": [],
                "confidence": 0.0, "needs_human_review": True, "retrieval_sources": retrieval_sources, "_docs": [],
                "review_reason": "No in-force article in the Law Library matched this question."}
    passages = key_passages(question, [d["text"] for d in docs], k=4)
    return {
        **base, "status": "ok", "answer_status": "sources_only",
        "citations": [_citation(d) for d in docs],
        "key_passages": [{**p, "source_number": p["source_index"] + 1} for p in passages["passages"]],
        "key_passages_method": passages["method"],
        "confidence": round(min(0.95, 0.30 + 0.10 * len(docs)), 2),
        "needs_human_review": True,
        "review_reason": "These are the most relevant in-force articles. Read them in full before relying on them.",
        "retrieval_sources": retrieval_sources,
        "_docs": docs,
    }


# ---------------------------------------------------------------------------
# Stage 2: draft by the local writing model
# ---------------------------------------------------------------------------

# Prompt layout tuned on the 1.5B model: law text first, question last, an
# "Answer:" cue, and no numbered source headers (it copies those back instead
# of answering). Citations are computed afterwards by the grounding check.
SYSTEM_EN = ("You answer questions about UAE law for lawyers, prosecutors and judges. Answer ONLY from the law text "
             "the user gives you. Write 2 to 4 short sentences in your own words that directly answer the question. "
             "If the law text does not answer it, say so in one sentence. Do not list the sources, do not add anything "
             "that is not in the law text, never predict how a case will be decided, never advise on strategy, and "
             "never comment on anyone's guilt or credibility. Write plain sentences: no markdown, "
             "no headings, no bullet points and no numbering.")

SYSTEM_AR = ("أنت تجيب عن أسئلة حول القانون الإماراتي للمحامين وأعضاء النيابة والقضاة. أجب فقط من نص القانون الذي "
             "يقدمه المستخدم. اكتب من جملتين إلى أربع جمل قصيرة باللغة العربية الفصحى فقط تجيب عن السؤال مباشرة. "
             "إذا لم يجب نص القانون عن السؤال فقل ذلك في جملة واحدة. لا تسرد المصادر، ولا تضف أي شيء غير موجود في "
             "نص القانون، ولا تتنبأ بنتيجة أي قضية، ولا تقدم نصائح بشأن الاستراتيجية، ولا تعلق على إدانة أحد أو مصداقيته. "
             "اكتب جملاً عادية دون تنسيق أو عناوين أو نقاط أو ترقيم.")

_FREE_ZONES = {"difc": ("DIFC law", "قانون مركز دبي المالي العالمي"), "adgm": ("ADGM law", "قانون سوق أبوظبي العالمي")}


def _messages(prepared: dict) -> list[dict[str, str]]:
    arabic = prepared["language"] == "ar"
    paragraphs = []
    for i, d in enumerate(prepared["_docs"][:PROMPT_SOURCES]):
        text = (d["text"] or "")[:PROMPT_CHARS_PER_SOURCE].strip()
        zone = _FREE_ZONES.get(prepared["citations"][i]["jurisdiction"])
        # Free-zone law is a different legal system: say so inline, or the model blends it with federal law.
        paragraphs.append(f"({zone[1] if arabic else zone[0]}) {text}" if zone else text)
    law_text = "\n\n".join(paragraphs)
    if arabic:
        user = f"نص القانون:\n{law_text}\n\nالسؤال: {prepared['question']}\nالإجابة:"
    else:
        user = f"Law text:\n{law_text}\n\nQuestion: {prepared['question']}\nAnswer:"
    return [{"role": "system", "content": SYSTEM_AR if arabic else SYSTEM_EN}, {"role": "user", "content": user}]


def _unavailable(prepared: dict, reason: str, status: str = "ai_unavailable") -> dict:
    return {**prepared, "answer": "", "answer_status": status, "needs_human_review": True,
            "review_reason": f"{reason} The most relevant in-force articles and key passages are shown instead."}


def stream_answer(prepared: dict) -> Iterator[tuple[str, dict]]:
    """Yields ("status", {...}), ("token", {"text"}), and finally ("final", result).
    Never raises for model problems: they end in a "final" without a draft."""
    if prepared.get("answer_status") != "sources_only":
        yield "final", public(prepared)
        return
    sources = [d["text"] for d in prepared["_docs"][:PROMPT_SOURCES]]
    for kind, payload in stream_grounded_draft(_messages(prepared), sources, prepared["language"],
                                               max_tokens=DRAFT_TOKENS, min_supported=MIN_SUPPORTED_RATIO):
        if kind != "draft":
            yield kind, payload
            continue
        if payload["status"] != "ok":
            yield "final", public(_unavailable(prepared, payload["reason"], payload["status"]))
            return
        reason = ("Draft written by a small local model and checked against the sources: sentences that match no "
                  "source are marked, and so are figures the sources don't contain. It can still join two points "
                  "that belong apart, so read the cited articles before relying on it.")
        if payload["unsupported"]:
            reason = f"{payload['unsupported']} sentence(s) could not be matched to any source and are marked. " + reason
        yield "final", public({
            **prepared, "answer": payload["text"], "answer_status": "ok", "grounding": payload["grounding"],
            "model": payload["model"], "needs_human_review": True, "review_reason": reason,
        })


def public(result: dict) -> dict:
    return {k: v for k, v in result.items() if not k.startswith("_")}


def ask(question: str, as_of_date: str | None = None, jurisdiction: str | None = None,
        write: bool = True) -> dict:
    """Non-streaming: sources, plus the checked draft when `write` and the model is available."""
    prepared = prepare(question, as_of_date, jurisdiction)
    if not write:
        return public(prepared)
    final = public(prepared)
    for kind, payload in stream_answer(prepared):
        if kind == "final":
            final = payload
    return final
