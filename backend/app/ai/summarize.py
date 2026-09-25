"""
Extractive summaries and key passages.

Both select ORIGINAL sentences -- nothing is paraphrased or generated -- so a
summary of a witness statement or an evidence document can never put words in
anyone's mouth. With the embedding model: sentences most central to the
document's meaning, de-duplicated with maximal marginal relevance. Without
it: classic word-frequency scoring. Either way each sentence keeps its
position so the reader can find it in the source.
"""

from __future__ import annotations

import math
from collections import Counter

import numpy as np

from app.ai import embeddings
from app.ai.text import content_words, split_sentences, word_overlap


def extractive_summary(text: str, max_sentences: int = 5, max_chars: int = 1400, wait_for_model: bool = True) -> dict:
    """`wait_for_model=False` (request handlers): use word frequency rather than wait for a cold model to load."""
    sentences = split_sentences(text, limit=400)
    total_chars = sum(len(s) for s in sentences) or 1
    if not sentences:
        return {"sentences": [], "method": "none", "coverage": 0.0}
    try:
        if not wait_for_model and not embeddings.ready():
            raise embeddings.ModelUnavailable("still loading")
        picked = _semantic_pick(sentences, max_sentences)
        method = "semantic"
    except embeddings.ModelUnavailable:
        picked = _frequency_pick(sentences, max_sentences)
        method = "word-frequency"

    # `rank` is the selection order (0 = strongest), so a caller that wants
    # fewer sentences than were picked takes the most informative ones.
    rank = {i: r for r, i in enumerate(picked)}
    chosen, used = [], 0
    for i in sorted(picked):
        if used + len(sentences[i]) > max_chars and chosen:
            break
        chosen.append({"index": i, "text": sentences[i], "rank": rank[i]})
        used += len(sentences[i])
    return {"sentences": chosen, "method": method, "coverage": round(used / total_chars, 2),
            "sentence_count": len(sentences)}


def _semantic_pick(sentences: list[str], k: int) -> list[int]:
    """Indices of the k most informative, least redundant sentences, strongest first."""
    vectors = embeddings.embed(sentences)
    centroid = vectors.mean(axis=0)
    centroid /= float(np.linalg.norm(centroid)) or 1.0
    n = len(sentences)
    # Centrality, with a mild lead bias (legal documents open by saying what they
    # are), weighted down for short lines so headers and file references lose to
    # sentences that actually state something.
    length_weight = np.array([min(1.0, len(s) / 90) for s in sentences])
    relevance = (vectors @ centroid) * (0.55 + 0.45 * length_weight) + 0.03 * (1 - np.arange(n) / n)
    selected: list[int] = []
    while len(selected) < min(k, n):
        if selected:
            redundancy = (vectors @ vectors[selected].T).max(axis=1)
        else:
            redundancy = np.zeros(n)
        score = 0.72 * relevance - 0.28 * redundancy
        score[selected] = -np.inf
        selected.append(int(np.argmax(score)))
    return selected


def _frequency_pick(sentences: list[str], k: int) -> list[int]:
    freq = Counter(w for s in sentences for w in content_words(s))
    if not freq:
        return list(range(min(k, len(sentences))))
    top = freq.most_common(1)[0][1]
    scores = []
    for i, s in enumerate(sentences):
        words = content_words(s)
        score = sum(freq[w] / top for w in words) / math.sqrt(len(words) or 1)
        scores.append(score * min(1.0, len(s) / 90) + 0.1 * (1 - i / len(sentences)))
    picked: list[int] = []
    for i in sorted(range(len(sentences)), key=lambda j: scores[j], reverse=True):
        if all(word_overlap(sentences[i], sentences[j]) < 0.7 for j in picked):
            picked.append(i)
        if len(picked) >= k:
            break
    return picked


def key_passages(question: str, sources: list[str], k: int = 4, per_source: int = 2,
                 min_score: float = 0.3) -> dict:
    """The sentences across `sources` that best answer `question`. Returns
    {"passages": [{source_index, text, score}], "method"}."""
    candidates: list[tuple[int, str]] = []
    for idx, text in enumerate(sources):
        for sentence in split_sentences(text, limit=80):
            candidates.append((idx, sentence))
    if not candidates:
        return {"passages": [], "method": "none"}
    try:
        vectors = embeddings.embed([question] + [c[1] for c in candidates])
        scores = vectors[1:] @ vectors[0]
        method = "semantic"
    except embeddings.ModelUnavailable:
        scores = np.array([word_overlap(question, c[1]) for c in candidates])
        method, min_score = "word-overlap", 0.2
    order = np.argsort(-scores)
    taken: dict[int, int] = {}
    passages = []
    for i in order:
        if scores[i] < min_score:
            break
        src, sentence = candidates[int(i)]
        if taken.get(src, 0) >= per_source:
            continue
        taken[src] = taken.get(src, 0) + 1
        passages.append({"source_index": src, "text": sentence, "score": round(float(scores[i]), 2)})
        if len(passages) >= k:
            break
    return {"passages": passages, "method": method}
