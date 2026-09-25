"""
Authentication and staff account management.

POST /auth/login is the only unauthenticated endpoint here. There is no public
self-registration: staff accounts are provisioned by an admin (the first one
via scripts/seed_admin.py).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.deps import STAFF, audit, client_ip, get_current_user, parse_uuid_or_404, require_role
from app.core import ratelimit
from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, password_problems, verify_password
from app.db.base import get_db
from app.db.postgres_repository import UserRepository
from app.models.auth_models import (
    PasswordChangeRequest, PasswordResetRequest, SystemRole, Token, UserAccount, UserCreateRequest,
    UserUpdateRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

# A real bcrypt hash of a random string: verifying against it when the username
# doesn't exist keeps response time the same, so usernames can't be enumerated.
_DUMMY_HASH = hash_password("lexintel-timing-equalizer")


def _check_password_policy(password: str) -> None:
    problems = password_problems(password)
    if problems:
        raise HTTPException(status_code=422, detail=f"Password must contain {' and '.join(problems)}.")


@router.post("/login", response_model=Token)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    username = form.username.strip().lower()
    ip = client_ip(request)
    lock_key = f"login:{username}:{ip}"
    window = settings.login_lockout_minutes * 60

    if ratelimit.count(lock_key) >= settings.login_max_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed sign-in attempts. Try again in {settings.login_lockout_minutes} minutes.",
        )

    repo = UserRepository(db)
    record = repo.get_for_auth(username)
    password_ok = verify_password(form.password, record.hashed_password if record else _DUMMY_HASH)
    if not record or not password_ok:
        ratelimit.hit(lock_key, settings.login_max_attempts, window)
        audit(db, request, None, "auth.login_failed", "user", None, {"username": username[:64]})
        db.commit()  # the raise below rolls the request session back; keep the audit entry
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not record.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been disabled.")

    ratelimit.reset(lock_key)
    user = repo.get(record.id)
    repo.touch_login(record.id)
    audit(db, request, user, "auth.login", "user", record.id)
    return Token(
        access_token=create_access_token(subject=str(record.id), role=record.role.value),
        role=record.role, full_name=user.full_name, user_id=user.id, username=user.username,
        expires_in_minutes=settings.access_token_expire_minutes,
    )


@router.get("/me", response_model=UserAccount)
def read_current_user(current_user: UserAccount = Depends(get_current_user)):
    return current_user


@router.post("/me/password", status_code=204)
def change_own_password(
    req: PasswordChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    repo = UserRepository(db)
    record = repo.get_for_auth(user.username)
    if not record or not verify_password(req.current_password, record.hashed_password):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    _check_password_policy(req.new_password)
    repo.set_password(user.id, hash_password(req.new_password))
    audit(db, request, user, "auth.password_changed", "user", user.id)


@router.get("/judges")
def list_judges(db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*STAFF))):
    return [{"id": str(u.id), "full_name": u.full_name}
            for u in UserRepository(db).list_all(role=SystemRole.JUDGE.value, active_only=True)]


@router.get("/users", response_model=list[UserAccount])
def list_users(db: Session = Depends(get_db), _admin: UserAccount = Depends(require_role(SystemRole.ADMIN))):
    return UserRepository(db).list_all()


@router.post("/users", response_model=UserAccount, status_code=201)
def create_user(
    req: UserCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: UserAccount = Depends(require_role(SystemRole.ADMIN)),
):
    repo = UserRepository(db)
    if repo.get_by_username(req.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is already taken.")
    _check_password_policy(req.password)
    created = repo.create(username=req.username.lower(), hashed_password=hash_password(req.password),
                          full_name=req.full_name, role=req.role)
    audit(db, request, admin, "user.created", "user", created.id, {"username": created.username, "role": req.role.value})
    return created


@router.patch("/users/{user_id}", response_model=UserAccount)
def update_user(
    user_id: str,
    req: UserUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: UserAccount = Depends(require_role(SystemRole.ADMIN)),
):
    uid = parse_uuid_or_404(user_id, "User")
    repo = UserRepository(db)
    target = repo.get(uid)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if uid == admin.id and (req.is_active is False or (req.role and req.role != SystemRole.ADMIN)):
        raise HTTPException(status_code=400, detail="You can't disable your own account or remove your own admin role.")
    removing_admin = target.role == SystemRole.ADMIN and (
        req.is_active is False or (req.role is not None and req.role != SystemRole.ADMIN))
    if removing_admin and repo.count_active_admins() <= 1:
        raise HTTPException(status_code=400, detail="At least one active administrator must remain.")
    updated = repo.update(uid, full_name=req.full_name, role=req.role, is_active=req.is_active)
    audit(db, request, admin, "user.updated", "user", uid, req.model_dump(exclude_none=True, mode="json"))
    return updated


@router.post("/users/{user_id}/reset-password", status_code=204)
def reset_password(
    user_id: str,
    req: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: UserAccount = Depends(require_role(SystemRole.ADMIN)),
):
    uid = parse_uuid_or_404(user_id, "User")
    _check_password_policy(req.new_password)
    if not UserRepository(db).set_password(uid, hash_password(req.new_password)):
        raise HTTPException(status_code=404, detail="User not found.")
    audit(db, request, admin, "user.password_reset", "user", uid)
