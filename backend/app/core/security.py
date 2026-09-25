"""
Password hashing, JWT issuance/verification, and Emirates ID hashing.

The actual access-control decisions (which role can call which endpoint)
live in app/api/deps.py, not here.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()

# bcrypt directly rather than passlib: passlib 1.7.4 reads a version attribute
# bcrypt removed in 4.1+, which breaks at import on any current bcrypt.
_BCRYPT_MAX_BYTES = 72


def hash_password(plain_password: str) -> str:
    pw_bytes = plain_password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        pw_bytes = plain_password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
        return bcrypt.checkpw(pw_bytes, hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < settings.min_password_length:
        problems.append(f"at least {settings.min_password_length} characters")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        problems.append("both letters and numbers")
    return problems


def create_access_token(subject: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises jose.JWTError on an invalid/expired token -- callers turn that into a 401."""
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])


# ---------------------------------------------------------------------------
# Emirates ID: store a keyed hash (lookup/dedupe) + last 4 digits (display).
# The raw number is never persisted.
# ---------------------------------------------------------------------------

_EID_RE = re.compile(r"^784-?\d{4}-?\d{7}-?\d$")


def normalize_emirates_id(raw: str) -> str | None:
    compact = re.sub(r"[\s]", "", raw or "")
    if not _EID_RE.match(compact):
        return None
    digits = re.sub(r"\D", "", compact)
    return f"{digits[0:3]}-{digits[3:7]}-{digits[7:14]}-{digits[14]}"


def hash_emirates_id(normalized: str) -> str:
    key = (settings.emirates_id_pepper or settings.secret_key).encode("utf-8")
    return hmac.new(key, normalized.encode("utf-8"), hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# Public complaint tracking codes: shown to the citizen once, stored hashed.
# ---------------------------------------------------------------------------

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I confusion


def new_tracking_code(length: int = 8) -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(length))


def hash_tracking_code(code: str) -> str:
    key = settings.secret_key.encode("utf-8")
    return hmac.new(key, code.strip().upper().encode("utf-8"), hashlib.sha256).hexdigest()


def tracking_code_matches(code: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    return hmac.compare_digest(hash_tracking_code(code), stored_hash)


__all__ = [
    "hash_password", "verify_password", "password_problems",
    "create_access_token", "decode_access_token", "JWTError",
    "normalize_emirates_id", "hash_emirates_id",
    "new_tracking_code", "hash_tracking_code", "tracking_code_matches",
]
