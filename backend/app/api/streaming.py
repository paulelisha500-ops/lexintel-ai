"""Server-sent events for drafts written by the local model (research answers, case briefs)."""

from __future__ import annotations

import json
from typing import Iterable

from fastapi.responses import StreamingResponse


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str, ensure_ascii=False)}\n\n"


def event_stream(events: Iterable[str]) -> StreamingResponse:
    # X-Accel-Buffering: a reverse proxy must pass tokens through as they come.
    # Paths ending in /stream are also exempt from gzip (see app/main.py).
    return StreamingResponse(events, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
