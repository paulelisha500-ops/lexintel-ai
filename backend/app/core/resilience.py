"""
Dependency probes: a cached "is this service reachable right now?" answer.

Every optional service (Mongo, Redis, Elasticsearch, Neo4j, the LLM, the
Celery worker) is checked through a Probe before use. A down service costs
one short timeout per `probe_ttl_seconds` window, then callers take their
fallback path immediately -- a dead Elasticsearch must not add a multi-second
stall to every request, and must never turn a request into a 500.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Callable

from app.core.config import get_settings

log = logging.getLogger("lexintel.resilience")


class Probe:
    def __init__(self, name: str, check: Callable[[], None], ttl: float | None = None):
        self.name = name
        self._check = check
        self._ttl = ttl if ttl is not None else get_settings().probe_ttl_seconds
        self._lock = threading.Lock()
        self._available: bool | None = None
        self._checked_at = 0.0
        self._last_error: str | None = None
        self._latency_ms: float | None = None

    def available(self) -> bool:
        now = time.monotonic()
        if self._available is not None and now - self._checked_at < self._ttl:
            return self._available
        with self._lock:
            if self._available is not None and time.monotonic() - self._checked_at < self._ttl:
                return self._available
            started = time.monotonic()
            try:
                self._check()
                self._set(True, None)
            except Exception as exc:  # any failure means "treat as down"
                self._set(False, f"{type(exc).__name__}: {exc}"[:300])
            self._latency_ms = round((time.monotonic() - started) * 1000, 1)
            return bool(self._available)

    def mark_down(self, exc: BaseException) -> None:
        """Called when a real operation fails mid-flight, so the next caller
        skips straight to its fallback instead of retrying a dead service."""
        with self._lock:
            self._set(False, f"{type(exc).__name__}: {exc}"[:300])

    def _set(self, ok: bool, err: str | None) -> None:
        if ok != self._available:
            if ok:
                log.info("dependency %s is available", self.name)
            else:
                log.warning("dependency %s unavailable: %s", self.name, err)
        self._available = ok
        self._last_error = err
        self._checked_at = time.monotonic()

    def status(self, refresh: bool = False) -> dict:
        if refresh:
            self._checked_at = 0.0
        ok = self.available()
        return {
            "name": self.name,
            "available": ok,
            "latency_ms": self._latency_ms,
            "error": None if ok else self._last_error,
        }
