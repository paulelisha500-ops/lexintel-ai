"""
The local writing model (Ollama, qwen2.5 1.5B by default) and the embeddings
entry point used by the law index.

Resilience contract: nothing outside this module talks to the writing model.
Callers use `stream_chat()` / `invoke_text()` / `invoke_json()`, which raise
`LLMUnavailable` on ANY failure (switched off, service down, model missing,
busy, timeout, unusable output). Every caller catches that and returns its
non-AI result, so the writing model makes answers better but is never needed
for a request to succeed.

It runs on CPU, so:
  - one draft is written at a time; up to `llm_max_waiting` more wait their
    turn, anything beyond gets "busy" immediately instead of piling up;
  - output streams token by token, and closing the stream (the reader
    navigated away) stops generation on the model server too;
  - the model unloads after `ollama_keep_alive` idle, giving the memory back.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

import httpx

from app.ai import memory
from app.core.config import get_settings
from app.core.resilience import Probe

log = logging.getLogger("lexintel.llm")
settings = get_settings()


class LLMUnavailable(RuntimeError):
    """The writing model couldn't produce a usable answer; take the fallback path."""


class LLMBusy(LLMUnavailable):
    """Too many drafts already waiting for the model."""


def enabled() -> bool:
    return settings.llm_provider.strip().lower() == "ollama"


def _base() -> str:
    return settings.ollama_base_url.rstrip("/")


def _check_llm() -> None:
    if not enabled():
        raise RuntimeError("drafting is switched off (LLM_PROVIDER=none)")
    resp = httpx.get(f"{_base()}/api/tags", timeout=3.0)
    resp.raise_for_status()
    names = {m.get("name", "") for m in resp.json().get("models", [])}
    wanted = settings.ollama_model
    if wanted not in names and f"{wanted}:latest" not in names:
        raise RuntimeError(f"model '{wanted}' is not downloaded (docker compose exec ollama ollama pull {wanted})")


llm_probe = Probe("llm", _check_llm)


def llm_description() -> str:
    return f"{settings.ollama_model} (local)" if enabled() else "off"


_resident_checked = 0.0
_resident = False


def _model_resident() -> bool:
    """True when the model is already in memory, so a draft costs no new allocation."""
    global _resident_checked, _resident
    if time.monotonic() - _resident_checked < 5.0:
        return _resident
    try:
        resp = httpx.get(f"{_base()}/api/ps", timeout=2.0)
        resp.raise_for_status()
        names = {m.get("name") for m in resp.json().get("models", [])}
        _resident = settings.ollama_model in names or f"{settings.ollama_model}:latest" in names
    except Exception:
        _resident = False
    _resident_checked = time.monotonic()
    return _resident


# ---------------------------------------------------------------------------
# One draft at a time
# ---------------------------------------------------------------------------

_gate = threading.Semaphore(1)
_waiting = 0
_active = 0
_counter_lock = threading.Lock()


def queue_length() -> int:
    """Drafts currently being written or waiting (this process)."""
    return _waiting + _active


@contextmanager
def _turn() -> Iterator[None]:
    global _waiting, _active
    with _counter_lock:
        if _waiting >= settings.llm_max_waiting:
            raise LLMBusy("the writing model is busy with other drafts")
        _waiting += 1
    try:
        acquired = _gate.acquire(timeout=settings.llm_timeout_seconds)
    finally:
        with _counter_lock:
            _waiting -= 1
    if not acquired:
        raise LLMBusy("timed out waiting for the writing model")
    with _counter_lock:
        _active += 1
    try:
        yield
    finally:
        with _counter_lock:
            _active -= 1
        _gate.release()


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def stream_chat(messages: list[dict[str, str]], max_tokens: int = 600, temperature: float = 0.0) -> Iterator[str]:
    """Yields text pieces as the model writes them. Raises LLMUnavailable (before or during)."""
    if not enabled():
        raise LLMUnavailable("drafting is switched off (LLM_PROVIDER=none)")
    if not llm_probe.available():
        raise LLMUnavailable(llm_probe.status().get("error") or "writing model unavailable")
    # The writing model is the largest thing this platform loads. Starting it on
    # a machine that is nearly full makes everything swap, so skip the draft and
    # let the caller show its non-AI answer instead.
    if not _model_resident() and not memory.enough_for(memory.WRITING_MODEL_MB):
        raise LLMUnavailable(f"not enough free memory for the writing model ({memory.shortfall(memory.WRITING_MODEL_MB)})")
    payload = {
        "model": settings.ollama_model,
        "messages": messages,
        "stream": True,
        "keep_alive": settings.ollama_keep_alive,
        "options": {"num_ctx": settings.llm_context_tokens, "num_predict": max_tokens,
                    "temperature": temperature, "top_p": 0.9, "repeat_penalty": 1.1,
                    # Keep the weights memory-mapped. Left to itself the server
                    # sometimes loads them into plain memory instead, which on this
                    # machine means ~1 GB that the kernel cannot reclaim, plus a
                    # much slower first load while the whole file is read.
                    "use_mmap": True},
    }
    timeout = httpx.Timeout(connect=3.0, read=float(settings.llm_timeout_seconds), write=10.0, pool=5.0)
    with _turn():
        try:
            with httpx.Client(timeout=timeout) as client, \
                    client.stream("POST", f"{_base()}/api/chat", json=payload) as resp:
                if resp.status_code != 200:
                    detail = resp.read().decode("utf-8", "ignore")[:300]
                    raise LLMUnavailable(f"model server returned {resp.status_code}: {detail}")
                for line in resp.iter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    if data.get("error"):
                        raise LLMUnavailable(str(data["error"])[:300])
                    piece = (data.get("message") or {}).get("content") or ""
                    if piece:
                        yield piece
                    if data.get("done"):
                        return
        except LLMUnavailable:
            raise
        except (httpx.ConnectError, httpx.ConnectTimeout, ConnectionError) as exc:
            llm_probe.mark_down(exc)
            raise LLMUnavailable(f"writing model unreachable: {exc}") from exc
        except httpx.TimeoutException as exc:
            raise LLMUnavailable("the writing model took too long to respond") from exc
        except Exception as exc:
            log.warning("generation failed: %s", exc)
            raise LLMUnavailable(f"{type(exc).__name__}: {exc}"[:300]) from exc


def _messages(templates: list[tuple[str, str]], variables: dict[str, Any] | None) -> list[dict[str, str]]:
    roles = {"system": "system", "human": "user", "user": "user", "ai": "assistant", "assistant": "assistant"}
    return [{"role": roles.get(role, "user"), "content": template.format(**(variables or {}))}
            for role, template in templates]


def invoke_text(messages: list[tuple[str, str]], variables: dict[str, Any] | None = None,
                max_tokens: int = 600) -> str:
    """messages: [("system", "..."), ("human", "... {var} ...")] (str.format placeholders, {{ }} for braces)."""
    text = "".join(stream_chat(_messages(messages, variables), max_tokens=max_tokens)).strip()
    if not text:
        raise LLMUnavailable("empty response")
    return text


_JSON_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)


def parse_json_object(text: str) -> dict:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        match = _JSON_OBJ_RE.search(cleaned)
        if not match:
            raise LLMUnavailable("model did not return JSON")
        try:
            value = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise LLMUnavailable("model returned malformed JSON") from exc
    if not isinstance(value, dict):
        raise LLMUnavailable("model returned JSON that isn't an object")
    return value


def invoke_json(messages: list[tuple[str, str]], variables: dict[str, Any] | None = None) -> dict:
    return parse_json_object(invoke_text(messages, variables))


# ---------------------------------------------------------------------------
# Model server status / control (System page)
# ---------------------------------------------------------------------------

def server_status() -> dict:
    """Whether the writing model is currently in memory, and how big it is."""
    out: dict[str, Any] = {"enabled": enabled(), "model": settings.ollama_model, "loaded": False,
                           "queue": queue_length(), "keep_alive": settings.ollama_keep_alive}
    if not enabled():
        return out
    try:
        resp = httpx.get(f"{_base()}/api/ps", timeout=3.0)
        resp.raise_for_status()
        for m in resp.json().get("models", []):
            if m.get("name") in (settings.ollama_model, f"{settings.ollama_model}:latest"):
                out.update(loaded=True, memory_mb=round((m.get("size") or 0) / 1e6), expires_at=m.get("expires_at"))
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"[:200]
    return out


def load_model(unload: bool = False) -> dict:
    """Pre-load the writing model (so the first draft doesn't wait for it) or unload it now."""
    if not enabled():
        raise LLMUnavailable("drafting is switched off (LLM_PROVIDER=none)")
    body = {"model": settings.ollama_model, "keep_alive": 0 if unload else settings.ollama_keep_alive}
    try:
        resp = httpx.post(f"{_base()}/api/generate", json=body, timeout=httpx.Timeout(300.0, connect=3.0))
        resp.raise_for_status()
    except Exception as exc:
        raise LLMUnavailable(f"{type(exc).__name__}: {exc}"[:300]) from exc
    return server_status()


# ---------------------------------------------------------------------------
# Embeddings for the law index (the model itself lives in app/ai/embeddings.py)
# ---------------------------------------------------------------------------

def get_embedding_model():
    from app.ai.embeddings import LocalEmbeddings

    return LocalEmbeddings()
