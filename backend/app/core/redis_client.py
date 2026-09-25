from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.core.resilience import Probe


@lru_cache
def get_redis():
    import redis

    return redis.Redis.from_url(
        get_settings().redis_url,
        socket_connect_timeout=2,
        socket_timeout=3,
        decode_responses=True,
    )


def _check() -> None:
    get_redis().ping()


redis_probe = Probe("redis", _check)
