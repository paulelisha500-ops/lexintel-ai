"""
Multilingual sentence embeddings (paraphrase-multilingual-MiniLM-L12-v2 by
default): one vector per sentence, comparable across Arabic and English. It is
the workhorse behind complaint classification, duplicate detection, similar
cases, extractive summaries, key passages, offence mentions, source comparison
and the grounding check -- all tasks where "which of these texts mean the
same thing?" is the right question and a generative model would be slower
and could invent things.

Runs on CPU in the API process, loads on first use and unloads after
`model_idle_unload_seconds` idle (see slots.py). Other processes (the worker)
set EMBEDDINGS_URL and borrow the API's copy over the internal network, so the
machine holds one copy instead of one per process; if the API can't be reached
they load their own. Callers catch `ModelUnavailable` and use their
word-overlap fallback.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import threading
import time
from collections import OrderedDict

import httpx
import numpy as np
from langchain_core.embeddings import Embeddings

from app.ai import memory
from app.ai.slots import ModelSlot, ModelUnavailable
from app.ai.text import split_sentences
from app.core.config import get_settings

settings = get_settings()
log = logging.getLogger("lexintel.ai.embeddings")

DIMENSIONS = 384
_CACHE_MAX = 4096
_cache: "OrderedDict[str, np.ndarray]" = OrderedDict()
_cache_lock = threading.Lock()


def _free_writing_model() -> None:
    """Unload the writing model so this one can load (best effort)."""
    try:
        from app.core import llm

        if llm.enabled():
            log.info("unloading the writing model to make room for the embedding model")
            llm.load_model(unload=True)
    except Exception as exc:
        log.warning("could not unload the writing model: %s", exc)


def _load():
    import torch
    from sentence_transformers import SentenceTransformer

    # A copy of this model in a process that shouldn't have one is the single
    # most common way to run this machine out of memory (see app/ai/memory.py).
    # This one is small and everything depends on it, so when memory is short
    # the big optional writing model gives way rather than the other way round.
    if not memory.enough_for(memory.EMBEDDINGS_MB):
        _free_writing_model()
    if not memory.enough_for(memory.EMBEDDINGS_MB):
        raise RuntimeError(f"not enough free memory to load the embedding model ({memory.shortfall(memory.EMBEDDINGS_MB)})")
    torch.set_num_threads(4)  # leave cores for the writing model and the web server
    return SentenceTransformer(settings.embedding_model, device="cpu")


slot = ModelSlot(
    "embeddings", _load, settings.model_idle_unload_seconds,
    enabled=lambda: settings.embeddings_enabled,
    description="Meaning-matching across Arabic and English",
)


def signature() -> str:
    """Identifies the vector space; stored next to persisted vectors so a change forces a rebuild."""
    return f"{settings.embedding_model}+normalized"


def available() -> bool:
    return slot.available()


_warming = threading.Lock()


def warm_in_background() -> None:
    """Start loading the model without waiting (first load from a cold disk can take ~45 s)."""
    if slot.loaded() or not slot.available() or not _warming.acquire(blocking=False):
        return

    def _run() -> None:
        try:
            embed(["warm-up"])
        except ModelUnavailable:
            pass
        finally:
            _warming.release()

    threading.Thread(target=_run, daemon=True, name="embeddings-warm-up").start()


def ready(warm: bool = True) -> bool:
    """True if embedding is cheap right now -- the model is in memory, or another
    process holds it and we can borrow it. Otherwise (optionally) starts loading it
    and returns False, so request handlers answer immediately with their fallback."""
    if slot.loaded() or (settings.embeddings_url and time.monotonic() - _remote_failed_at >= 60):
        return True
    if warm:
        warm_in_background()
    return False


def _key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", "ignore")).hexdigest()


def internal_token() -> str:
    """Shared secret for the internal embeddings endpoint (both sides read the same SECRET_KEY)."""
    return hmac.new(settings.secret_key.encode(), b"lexintel-internal-embed", hashlib.sha256).hexdigest()


_remote_failed_at = 0.0


def _embed_remote(texts: list[str]) -> np.ndarray | None:
    """Borrow the API process's model. None (-> load locally) if the API can't be reached."""
    global _remote_failed_at
    if not settings.embeddings_url or time.monotonic() - _remote_failed_at < 60:
        return None
    try:
        resp = httpx.post(settings.embeddings_url, json={"texts": texts}, headers={"X-Internal-Token": internal_token()},
                          timeout=httpx.Timeout(180.0, connect=3.0))
        if resp.status_code == 503:
            raise ModelUnavailable(resp.json().get("detail", "embeddings unavailable"))
        resp.raise_for_status()
        raw = base64.b64decode(resp.json()["vectors"])
        return np.frombuffer(raw, dtype=np.float32).reshape(len(texts), DIMENSIONS).copy()
    except ModelUnavailable:
        raise
    except Exception as exc:
        _remote_failed_at = time.monotonic()
        log.warning("remote embeddings unavailable (%s); using a local copy of the model", exc)
        return None


def _embed_local(texts: list[str], batch_size: int) -> np.ndarray:
    with slot.use() as model:
        try:
            return model.encode(texts, batch_size=batch_size, normalize_embeddings=True,
                                show_progress_bar=False, convert_to_numpy=True)
        except Exception as exc:  # a crash inside the model is a fallback, not a 500
            raise ModelUnavailable(f"embedding failed: {type(exc).__name__}: {exc}"[:300]) from exc


def embed(texts: list[str], batch_size: int = 32) -> np.ndarray:
    """L2-normalised float32 vectors, shape (len(texts), 384). Raises ModelUnavailable."""
    if not texts:
        return np.zeros((0, DIMENSIONS), dtype=np.float32)
    cleaned = [(t or " ")[:2000] for t in texts]
    out: list[np.ndarray | None] = [None] * len(cleaned)
    missing: list[int] = []
    with _cache_lock:
        for i, text in enumerate(cleaned):
            hit = _cache.get(_key(text))
            if hit is not None:
                out[i] = hit
            else:
                missing.append(i)
    if missing:
        if not settings.embeddings_enabled:
            raise ModelUnavailable("embeddings is switched off in the configuration")
        batch = [cleaned[i] for i in missing]
        vectors = _embed_remote(batch)
        if vectors is None:
            vectors = _embed_local(batch, batch_size)
        with _cache_lock:
            for i, vec in zip(missing, vectors):
                vec = vec.astype(np.float32)
                out[i] = vec
                _cache[_key(cleaned[i])] = vec
                if len(_cache) > _CACHE_MAX:
                    _cache.popitem(last=False)
    return np.vstack(out).astype(np.float32)


def embed_one(text: str) -> np.ndarray:
    return embed([text])[0]


def embed_document(text: str, max_chunks: int = 12) -> np.ndarray:
    """One vector for a long text: the normalised mean of its first sentence groups.
    (The model reads 128 tokens at a time, so a whole document can't go in at once.)"""
    sentences = split_sentences(text, limit=max_chunks * 3)
    chunks = [" ".join(sentences[i:i + 3]) for i in range(0, len(sentences), 3)][:max_chunks] or [text[:1000]]
    vectors = embed(chunks)
    mean = vectors.mean(axis=0)
    norm = float(np.linalg.norm(mean)) or 1.0
    return (mean / norm).astype(np.float32)


class LocalEmbeddings(Embeddings):
    """LangChain `Embeddings` over the same slot, for the FAISS law index."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return embed(list(texts)).tolist()

    def embed_query(self, text: str) -> list[float]:
        return embed_one(text).tolist()


__all__ = ["ModelUnavailable", "available", "embed", "embed_one", "embed_document", "LocalEmbeddings",
           "signature", "slot", "DIMENSIONS"]
