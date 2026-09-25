"""
Grounded drafting with the local writing model: the one loop every written
draft goes through (research answers, case briefs).

  stream tokens -> stop at once if the text drifts into a foreign script
  -> reject drafts in the wrong language -> check every sentence against the
  numbered sources (app/ai/grounding.py) -> withhold drafts that mostly
  don't match -> return the draft with computed citations.

Yields ("status", {...}) and ("token", {"text"}) while writing, and always
ends with exactly one ("draft", {...}) whose "status" is one of
ok | ai_unavailable | ai_busy | discarded. It never raises for model problems.
"""

from __future__ import annotations

import logging
from typing import Iterator

from app.ai import grounding
from app.ai.text import arabic_ratio, has_foreign_script, split_sentences, strip_markdown, word_overlap
from app.core.llm import LLMBusy, LLMUnavailable, enabled, llm_description, queue_length, stream_chat

log = logging.getLogger("lexintel.ai.drafting")

_FOREIGN = "__foreign_script__"


def language_problem(text: str, language: str) -> str | None:
    """Why a finished draft must be withheld on language grounds, or None."""
    if has_foreign_script(text):
        return "The draft drifted into another language, so it was withheld."
    ratio = arabic_ratio(text)
    if language == "ar" and ratio < 0.6:
        return "The draft was not written in Arabic, so it was withheld."
    if language == "en" and ratio > 0.3:
        return "The draft was not written in English, so it was withheld."
    return None


def _drop_repeats(text: str) -> str:
    """Small models pad a short answer by restating earlier sentences; keep the first."""
    kept: list[str] = []
    for sentence in split_sentences(text, limit=40):
        if any(word_overlap(sentence, earlier) > 0.8 for earlier in kept):
            continue
        kept.append(sentence)
    return " ".join(kept) if kept else text


def stream_grounded_draft(messages: list[dict[str, str]], sources: list[str], language: str,
                          max_tokens: int = 450, min_supported: float = 0.34) -> Iterator[tuple[str, dict]]:
    if not enabled():
        yield "draft", {"status": "ai_unavailable", "reason": "Written drafts are switched off on this server."}
        return
    ahead = queue_length()
    yield "status", {"phase": "waiting" if ahead else "writing", "ahead": ahead, "model": llm_description()}

    written: list[str] = []
    try:
        started = False
        # Greedy decoding (temperature 0). Measured on this model: at 0.1 the same
        # notes produced a draft that attributed the driver's injury to the owner
        # and repeated whole sentences; at 0 the output is stable and stays with
        # the notes. A court draft has nothing to gain from sampling variety.
        for piece in stream_chat(messages, max_tokens=max_tokens, temperature=0.0):
            if not started:
                started = True
                yield "status", {"phase": "writing", "model": llm_description()}
            written.append(piece)
            if has_foreign_script(piece):
                raise LLMUnavailable(_FOREIGN)
            yield "token", {"text": piece}
    except LLMBusy:
        yield "draft", {"status": "ai_busy", "reason": "The writing model is busy with other drafts."}
        return
    except LLMUnavailable as exc:
        if str(exc) == _FOREIGN:
            yield "draft", {"status": "discarded", "reason": "The draft drifted into another language, so it was withheld."}
        else:
            log.info("draft unavailable: %s", exc)
            yield "draft", {"status": "ai_unavailable", "reason": "The writing model is not available right now."}
        return

    text = _drop_repeats(strip_markdown("".join(written)))
    yield "status", {"phase": "checking"}
    problem = language_problem(text, language) if text else "The writing model returned nothing."
    if problem:
        yield "draft", {"status": "discarded", "reason": problem}
        return
    checked = grounding.check(text, sources)
    if checked["supported_ratio"] < min_supported:
        yield "draft", {"status": "discarded",
                        "reason": "The draft did not match the sources closely enough, so it was withheld."}
        return
    unsupported = sum(1 for s in checked["sentences"] if s["support"] == "unsupported")
    yield "draft", {"status": "ok", "text": grounding.render(checked), "grounding": checked,
                    "unsupported": unsupported, "model": llm_description()}
