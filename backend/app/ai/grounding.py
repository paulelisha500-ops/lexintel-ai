"""
Grounding check for text written by the local model (Module 12).

A small model paraphrases well but does not reliably cite, and it sometimes
adds a sentence of its own ("...including Germany"). So citations are not
taken from the model: every sentence of the draft is matched against the
sentences of the numbered sources, and

  - supported sentences get the source number(s) they match, computed here;
  - sentences that match no source are flagged "not found in the sources"
    for the reader, and are never presented as law.
"""

from __future__ import annotations

import re

import numpy as np

from app.ai import embeddings
from app.ai.text import numeric_figures, split_sentences, word_overlap

_CITATION = re.compile(r"\s*\[(\d{1,2})\]")
_SUPPORTED = 0.62       # cosine similarity to the closest source sentence
_PARTIAL = 0.48
_OVERLAP_SUPPORTED = 0.6  # word-overlap fallback thresholds
_OVERLAP_PARTIAL = 0.35


def check(answer: str, sources: list[str]) -> dict:
    """Returns {"sentences": [{text, support, score, sources:[n...]}], "supported_ratio", "method"}.
    `support` is "supported" | "partial" | "unsupported"; source numbers are 1-based.
    A sentence that states a date, time or amount the sources don't contain is
    always "unsupported", with those figures listed in `invented_figures`."""
    answer_sentences = [s for s in split_sentences(answer, limit=80)]
    source_sentences: list[tuple[int, str]] = []
    for idx, text in enumerate(sources):
        for sentence in split_sentences(text, limit=120):
            source_sentences.append((idx + 1, sentence))
    if not answer_sentences:
        return {"sentences": [], "supported_ratio": 0.0, "method": "none"}
    if not source_sentences:
        return {"sentences": [{"text": s, "support": "unsupported", "score": 0.0, "sources": [],
                               "invented_figures": []} for s in answer_sentences],
                "supported_ratio": 0.0, "method": "none"}

    stripped = [_CITATION.sub("", s).strip() for s in answer_sentences]
    try:
        vectors = embeddings.embed(stripped + [s for _, s in source_sentences])
        a_vec, s_vec = vectors[:len(stripped)], vectors[len(stripped):]
        sims = a_vec @ s_vec.T
        method, hi, lo = "semantic", _SUPPORTED, _PARTIAL
    except embeddings.ModelUnavailable:
        sims = np.array([[word_overlap(a, s) for _, s in source_sentences] for a in stripped])
        method, hi, lo = "word-overlap", _OVERLAP_SUPPORTED, _OVERLAP_PARTIAL

    # Figures the sources actually contain; anything else in a drafted sentence
    # was made up, however well the sentence matches in meaning.
    source_figures = set()
    for text in sources:
        source_figures |= numeric_figures(text)

    out = []
    supported = 0
    counted = 0
    for i, text in enumerate(stripped):
        if text.endswith((":", "：")) and len(text) < 90:  # a heading, not a claim
            out.append({"text": text, "support": "heading", "score": 0.0, "sources": [], "invented_figures": []})
            continue
        counted += 1
        row = sims[i]
        best = float(row.max())
        # Every source whose sentence is nearly as close as the best one gets cited.
        cited = sorted({source_sentences[j][0] for j in np.where(row >= max(lo, best - 0.05))[0]})
        if best >= hi:
            support = "supported"
        elif best >= lo:
            support = "partial"
        else:
            support, cited = "unsupported", []
        invented = sorted(numeric_figures(text) - source_figures)
        if invented:
            support, cited = "unsupported", []
        if support == "supported":
            supported += 1
        out.append({"text": text, "support": support, "score": round(best, 2), "sources": cited[:3],
                    "invented_figures": invented})
    return {"sentences": out, "supported_ratio": round(supported / counted, 2) if counted else 0.0, "method": method}


def render(checked: dict) -> str:
    """The draft as plain text with computed citations appended to each sentence."""
    parts = []
    for s in checked.get("sentences", []):
        marks = "".join(f" [{n}]" for n in s["sources"])
        text = s["text"]
        if marks and text[-1:] in ".!?؟":
            text = f"{text[:-1]}{marks}{text[-1]}"
        else:
            text = f"{text}{marks}"
        parts.append(text)
    return " ".join(parts)
