"""
Auth models: who can log into LexIntel and what they're allowed to do.

Deliberately separate from HearingRole in schemas.py -- that enum describes
what role a *person involved in a case* holds during one hearing; SystemRole
describes what a *staff account* is allowed to do in the system.

SystemRole.JUDGE is the only role that can enter a ruling -- see
require_role() in app/api/deps.py and docs/DESIGN_DECISIONS.md.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class SystemRole(str, Enum):
    JUDGE = "judge"                 # the only role that can enter a ruling
    PROSECUTOR = "prosecutor"
    CLERK = "clerk"                 # runs courtroom check-in, case intake
    CASE_OFFICER = "case_officer"   # builds the case file, evidence, priority
    ADMIN = "admin"                 # user management and system settings


class UserAccount(BaseModel):
    """API-facing representation. Never carries a password or its hash."""
    id: UUID = Field(default_factory=uuid4)
    username: str
    full_name: str
    role: SystemRole
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login_at: Optional[datetime] = None


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(max_length=128)
    full_name: str = Field(min_length=2, max_length=255)
    role: SystemRole


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    role: Optional[SystemRole] = None
    is_active: Optional[bool] = None


class PasswordResetRequest(BaseModel):
    new_password: str = Field(max_length=128)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: SystemRole
    full_name: str
    user_id: Optional[UUID] = None
    username: Optional[str] = None
    expires_in_minutes: Optional[int] = None


class TokenPayload(BaseModel):
    sub: str
    role: SystemRole
    exp: int
