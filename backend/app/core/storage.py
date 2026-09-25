"""
File storage for uploads (evidence, recordings, law PDFs).

Files are written under settings.upload_dir with server-generated names --
the client's filename is kept only as metadata, never used as a path, so a
crafted name like "../../etc/passwd" can't escape the upload directory.
Uploads stream to disk in chunks with a hard size cap and a SHA-256 computed
on the way through (chain-of-custody integrity for evidence).
"""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import get_settings

_CHUNK = 1024 * 1024
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._\-؀-ۿ ]+")


@dataclass
class StoredFile:
    path: str
    sha256: str
    size_bytes: int
    original_filename: str
    content_type: str
    extension: str


def upload_root() -> Path:
    root = Path(get_settings().upload_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_display_name(name: str | None) -> str:
    base = os.path.basename((name or "file").replace("\\", "/"))
    cleaned = _SAFE_NAME_RE.sub("_", base).strip(" .") or "file"
    return cleaned[:200]


def extension_of(name: str | None) -> str:
    ext = Path(safe_display_name(name)).suffix.lower().lstrip(".")
    return ext[:10]


async def save_upload(
    upload: UploadFile,
    subdir: str,
    max_mb: int,
    allowed_extensions: set[str] | None = None,
) -> StoredFile:
    display = safe_display_name(upload.filename)
    ext = extension_of(upload.filename)
    if allowed_extensions is not None and ext not in allowed_extensions:
        raise HTTPException(
            status_code=415,
            detail=f"File type '.{ext or '?'}' is not accepted here. Allowed: {', '.join(sorted(allowed_extensions))}.",
        )

    target_dir = upload_root() / subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{uuid.uuid4().hex}{'.' + ext if ext else ''}"

    max_bytes = max_mb * 1024 * 1024
    digest = hashlib.sha256()
    size = 0
    try:
        with open(target, "wb") as fh:
            while True:
                chunk = await upload.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail=f"File is larger than the {max_mb} MB limit.")
                digest.update(chunk)
                fh.write(chunk)
    except BaseException:
        target.unlink(missing_ok=True)
        raise

    if size == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    return StoredFile(
        path=str(target),
        sha256=digest.hexdigest(),
        size_bytes=size,
        original_filename=display,
        content_type=upload.content_type or "application/octet-stream",
        extension=ext,
    )


def delete_file(path: str | None) -> None:
    if not path:
        return
    try:
        resolved = Path(path).resolve()
        if upload_root().resolve() in resolved.parents:
            resolved.unlink(missing_ok=True)
    except OSError:
        pass


def resolve_stored(path: str | None) -> Path | None:
    """Returns the path only if it exists and sits inside the upload root."""
    if not path:
        return None
    resolved = Path(path).resolve()
    if upload_root().resolve() not in resolved.parents or not resolved.is_file():
        return None
    return resolved


def sha256_of_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()
