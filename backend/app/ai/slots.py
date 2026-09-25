"""
Lazy model slots: load a model on first use, unload it after it has been idle
for `model_idle_unload_seconds`, and remember load failures for a while so a
broken model costs one attempt per window instead of one per request.

This is what keeps LexIntel inside a small machine: the embedding model and
the speech-to-text model each take a few hundred MB, and they are only
resident while someone is actually using them.
"""

from __future__ import annotations

import ctypes
import gc
import logging
import threading
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator

log = logging.getLogger("lexintel.ai")

_RETRY_FAILED_LOAD_AFTER = 300.0
_REAP_INTERVAL = 60.0


class ModelUnavailable(RuntimeError):
    """The model is disabled, missing, or failed to load; take the fallback path."""


class ModelSlot:
    def __init__(self, name: str, loader: Callable[[], Any], idle_seconds: float,
                 enabled: Callable[[], bool] = lambda: True, description: str = ""):
        self.name = name
        self.description = description
        self._loader = loader
        self._idle_seconds = idle_seconds
        self._enabled = enabled
        self._lock = threading.RLock()
        self._model: Any = None
        self._in_use = 0
        self._last_used = 0.0
        self._error: str | None = None
        self._error_at = 0.0
        self._load_seconds: float | None = None
        self._loads = 0
        _register(self)

    # -- use ---------------------------------------------------------------
    @contextmanager
    def use(self) -> Iterator[Any]:
        """`with slot.use() as model:` -- loads on demand, raises ModelUnavailable."""
        with self._lock:
            model = self._ensure_loaded()
            self._in_use += 1
            self._last_used = time.monotonic()
        try:
            yield model
        finally:
            with self._lock:
                self._in_use -= 1
                self._last_used = time.monotonic()

    def _ensure_loaded(self) -> Any:
        if self._model is not None:
            return self._model
        if not self._enabled():
            raise ModelUnavailable(f"{self.name} is switched off in the configuration")
        if self._error and time.monotonic() - self._error_at < _RETRY_FAILED_LOAD_AFTER:
            raise ModelUnavailable(self._error)
        started = time.monotonic()
        try:
            self._model = self._loader()
        except Exception as exc:
            self._error = f"{type(exc).__name__}: {exc}"[:300]
            self._error_at = time.monotonic()
            log.warning("model %s failed to load: %s", self.name, self._error)
            raise ModelUnavailable(self._error) from exc
        self._error = None
        self._loads += 1
        self._load_seconds = round(time.monotonic() - started, 1)
        log.info("model %s loaded in %.1fs", self.name, self._load_seconds)
        _ensure_reaper()
        return self._model

    def available(self) -> bool:
        """Cheap check: enabled and not in a recent failed-load window."""
        if not self._enabled():
            return False
        return not (self._error and time.monotonic() - self._error_at < _RETRY_FAILED_LOAD_AFTER)

    def loaded(self) -> bool:
        return self._model is not None

    # -- idle unload -------------------------------------------------------
    def unload_if_idle(self, now: float) -> bool:
        with self._lock:
            if self._model is None or self._in_use or now - self._last_used < self._idle_seconds:
                return False
            self._model = None
        _release_memory()
        log.info("model %s unloaded after %ds idle", self.name, int(self._idle_seconds))
        return True

    def status(self) -> dict:
        idle_for = round(time.monotonic() - self._last_used) if self._last_used else None
        return {
            "name": self.name,
            "enabled": self._enabled(),
            "available": self.available(),
            "loaded": self._model is not None,
            "in_use": self._in_use > 0,
            "idle_seconds": idle_for if self._model is not None else None,
            "unloads_after_seconds": int(self._idle_seconds),
            "load_seconds": self._load_seconds,
            "error": self._error if not self.available() and self._enabled() else None,
        }


def _release_memory() -> None:
    gc.collect()
    try:  # give freed heap pages back to the OS (glibc only; harmless elsewhere)
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


_slots: list[ModelSlot] = []
_reaper_started = False
_reaper_lock = threading.Lock()


def _register(slot: ModelSlot) -> None:
    _slots.append(slot)


def _ensure_reaper() -> None:
    global _reaper_started
    with _reaper_lock:
        if _reaper_started:
            return
        _reaper_started = True
    threading.Thread(target=_reap_forever, daemon=True, name="model-reaper").start()


def _reap_forever() -> None:
    while True:
        time.sleep(_REAP_INTERVAL)
        now = time.monotonic()
        for slot in list(_slots):
            try:
                slot.unload_if_idle(now)
            except Exception:
                log.exception("unloading %s failed", slot.name)
