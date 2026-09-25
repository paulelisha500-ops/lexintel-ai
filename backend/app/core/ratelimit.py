"""
Fixed-window rate limiting. Redis-backed when Redis is reachable (shared
across the API and worker processes); falls back to an in-process counter
otherwise, so a Redis outage weakens the limit rather than disabling login.
"""

from __future__ import annotations

import threading
import time

from app.core.redis_client import get_redis, redis_probe

_local: dict[str, tuple[int, float]] = {}
_local_lock = threading.Lock()


def _local_hit(key: str, window: int) -> int:
    now = time.time()
    with _local_lock:
        count, expires = _local.get(key, (0, now + window))
        if now >= expires:
            count, expires = 0, now + window
        count += 1
        _local[key] = (count, expires)
        if len(_local) > 50_000:
            for k in [k for k, (_, exp) in _local.items() if exp <= now]:
                _local.pop(k, None)
        return count


def hit(key: str, limit: int, window_seconds: int) -> bool:
    """Registers one attempt; returns True while the caller is within limit."""
    full_key = f"lexintel:rl:{key}"
    if redis_probe.available():
        try:
            client = get_redis()
            pipe = client.pipeline()
            pipe.incr(full_key)
            pipe.expire(full_key, window_seconds, nx=True)
            count = int(pipe.execute()[0])
            return count <= limit
        except Exception as exc:
            redis_probe.mark_down(exc)
    return _local_hit(full_key, window_seconds) <= limit


def count(key: str) -> int:
    full_key = f"lexintel:rl:{key}"
    if redis_probe.available():
        try:
            return int(get_redis().get(full_key) or 0)
        except Exception as exc:
            redis_probe.mark_down(exc)
    with _local_lock:
        c, exp = _local.get(full_key, (0, 0))
        return c if time.time() < exp else 0


def reset(key: str) -> None:
    full_key = f"lexintel:rl:{key}"
    if redis_probe.available():
        try:
            get_redis().delete(full_key)
        except Exception as exc:
            redis_probe.mark_down(exc)
    with _local_lock:
        _local.pop(full_key, None)
