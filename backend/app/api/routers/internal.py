"""
Service-to-service endpoints (not for browsers). The background worker calls
/internal/embed so the machine holds one copy of the embedding model -- in
this API process -- instead of one per process. Authenticated with a token
derived from SECRET_KEY, which only the services know.
"""

from __future__ import annotations

import base64
import hmac

from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.ai import embeddings

router = APIRouter(tags=["internal"], include_in_schema=False)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=2000)


@router.post("/internal/embed")
async def internal_embed(req: EmbedRequest, x_internal_token: str = Header(default="")):
    if not hmac.compare_digest(x_internal_token, embeddings.internal_token()):
        raise HTTPException(403, "Forbidden.")
    try:
        vectors = await run_in_threadpool(embeddings.embed, req.texts)
    except embeddings.ModelUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"vectors": base64.b64encode(vectors.astype("float32").tobytes()).decode(), "dims": embeddings.DIMENSIONS}
