"""
Free-memory guard.

This platform runs several databases, two AI models and a search cluster on
one small machine. Loading a model when the machine is nearly full does not
fail cleanly: the host starts swapping, every container slows down, file
watchers die and Docker itself can stop responding. Losing a draft is a much
better outcome than losing the machine, so the model paths ask here first and
fall back to their non-AI answer when memory is short.

`MemAvailable` is read from /proc/meminfo, which inside a container reports
the host (Docker VM) figure -- that is the number that matters, because the
models compete with every other container, not just this one.
"""

from __future__ import annotations

import logging
import re
import threading
import time

log = logging.getLogger("lexintel.ai.memory")

_MEMINFO = "/proc/meminfo"
_AVAILABLE = re.compile(r"^MemAvailable:\s+(\d+)\s+kB", re.MULTILINE)
_CACHE_SECONDS = 2.0

# Free memory required before loading, measured on this stack by watching
# MemAvailable across a cold load: the sentence-transformer costs ~380 MB, and
# the writing model ~1050 MB (its weights are memory-mapped, but the server
# repacks them for CPU inference into memory the kernel cannot reclaim).
# With both resident the machine sits at ~800 MB free and 1-4% memory
# pressure, which is comfortable; the trouble started below ~550 MB. Each
# figure therefore adds ~400 MB of headroom.
EMBEDDINGS_MB = 830
WRITING_MODEL_MB = 1400

_lock = threading.Lock()
_last_value: tuple[float, int] | None = None


def available_mb() -> int | None:
    """Free memory on the machine, or None where it can't be read (non-Linux)."""
    global _last_value
    with _lock:
        if _last_value and time.monotonic() - _last_value[0] < _CACHE_SECONDS:
            return _last_value[1]
    try:
        with open(_MEMINFO, "r", encoding="ascii") as fh:
            match = _AVAILABLE.search(fh.read())
        if not match:
            return None
        value = int(match.group(1)) // 1024
    except OSError:
        return None
    with _lock:
        _last_value = (time.monotonic(), value)
    return value


def enough_for(needed_mb: int) -> bool:
    """True when a model of this size can load without starving the machine.
    Unknown memory (no /proc/meminfo) means "go ahead" -- guessing low would
    disable the AI on platforms where the check simply doesn't apply."""
    free = available_mb()
    return free is None or free >= needed_mb


def shortfall(needed_mb: int) -> str:
    return f"only {available_mb()} MB free, {needed_mb} MB needed"
