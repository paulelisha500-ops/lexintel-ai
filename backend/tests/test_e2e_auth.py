"""
Security boundary, end to end through the real FastAPI app (TestClient) and
the real Postgres + Mongo -- in separate *_test databases (see tests/_env.py).

Proves at the HTTP layer: public intake is public and nothing else is;
wrong role -> 403; only a judge can enter a ruling and `entered_by` is forced
to that judge's id; login lockout; tokens die on password change; admin-only
endpoints; the courtroom stand refuses a second person (409, not 500).
"""
import tests._env as env  # noqa: F401  (must be first)

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

env.reset_databases()

import app.api.routers.cases as cases_router  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.db.postgres_repository import UserRepository  # noqa: E402
from app.main import app  # noqa: E402
from app.models.auth_models import SystemRole  # noqa: E402

client = TestClient(app)
API = "/api/v1"
PW = "Correct-horse-42"

with SessionLocal() as db:
    repo = UserRepository(db)
    judge = repo.create("judge.test", hash_password(PW), "Test Judge", SystemRole.JUDGE)
    repo.create("clerk.test", hash_password(PW), "Test Clerk", SystemRole.CLERK)
    repo.create("admin.test", hash_password(PW), "Test Admin", SystemRole.ADMIN)
    repo.create("pros.test", hash_password(PW), "Test Prosecutor", SystemRole.PROSECUTOR)
    db.commit()


def login(username: str, password: str = PW) -> dict:
    r = client.post(f"{API}/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, (username, r.status_code, r.text)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


judge_h, clerk_h, admin_h, pros_h = login("judge.test"), login("clerk.test"), login("admin.test"), login("pros.test")
passed = 0


def check(name: str, cond: bool, info: str = "") -> None:
    global passed
    assert cond, f"{name}: {info}"
    passed += 1
    print(f"   OK  {name}")


print("Authentication")
check("wrong password -> 401", client.post(f"{API}/auth/login", data={"username": "judge.test", "password": "nope"}).status_code == 401)
check("no token -> 401", client.get(f"{API}/cases").status_code == 401)
check("garbage token -> 401", client.get(f"{API}/cases", headers={"Authorization": "Bearer x.y.z"}).status_code == 401)
for _ in range(5):
    client.post(f"{API}/auth/login", data={"username": "locked.user", "password": "wrong"})
check("6th failed login is locked out -> 429",
      client.post(f"{API}/auth/login", data={"username": "locked.user", "password": "wrong"}).status_code == 429)

print("Public vs staff")
r = client.post(f"{API}/complaints", json={"case_type": "criminal", "description": "Someone stole my phone at the mall yesterday evening."})
check("public complaint intake works with no token", r.status_code == 201 and r.json()["tracking_code"], r.text)
check("complaint list requires staff -> 401", client.get(f"{API}/complaints").status_code == 401)
check("complaint list with clerk -> 200", client.get(f"{API}/complaints", headers=clerk_h).status_code == 200)
check("complaint list with judge -> 403 (triage is case staff)", client.get(f"{API}/complaints", headers=judge_h).status_code == 403)

print("Cases and roles")
r = client.post(f"{API}/cases", json={"case_type": "criminal", "title": "State v. Test"}, headers=clerk_h)
check("clerk creates a case", r.status_code == 201, r.text)
case_id = r.json()["id"]
check("judge cannot create a case -> 403",
      client.post(f"{API}/cases", json={"case_type": "civil", "title": "Nope nope"}, headers=judge_h).status_code == 403)
check("bad case id -> 404, not 500", client.get(f"{API}/cases/not-a-uuid", headers=judge_h).status_code == 404)

print("Ruling boundary")
check("ruling with no token -> 401", client.post(f"{API}/cases/{case_id}/ruling", json={"ruling_text": "x" * 30}).status_code == 401)
check("ruling with clerk -> 403", client.post(f"{API}/cases/{case_id}/ruling", json={"ruling_text": "x" * 30}, headers=clerk_h).status_code == 403)
check("ruling with prosecutor -> 403", client.post(f"{API}/cases/{case_id}/ruling", json={"ruling_text": "x" * 30}, headers=pros_h).status_code == 403)
r = client.post(f"{API}/cases/{case_id}/ruling", json={"ruling_text": "The case is dismissed for the reasons recorded.", "entered_by": "00000000-0000-0000-0000-000000000000"}, headers=judge_h)
check("judge enters ruling; entered_by is the judge, whatever the body says",
      r.status_code == 200 and r.json()["entered_by"] == str(judge.id), r.text)
check("RulingRequest has no entered_by field", "entered_by" not in cases_router.RulingRequest.model_fields)

print("Courtroom stand with real ids")
at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
r = client.post(f"{API}/hearings", json={"case_id": case_id, "scheduled_at": at, "courtroom": "T1"}, headers=clerk_h)
check("schedule hearing", r.status_code == 201, r.text)
hearing_id = r.json()["id"]
r = client.post(f"{API}/courtroom/hearings/{hearing_id}/session", headers=clerk_h)
check("open session", r.status_code == 200, r.text)
session_id = r.json()["session"]["id"]
r = client.post(f"{API}/courtroom/sessions/{session_id}/call-to-stand", json={"role": "witness", "new_person": {"full_name": "W One"}}, headers=clerk_h)
check("call to stand", r.status_code == 200 and r.json()["active_statement"], r.text)
r = client.post(f"{API}/courtroom/sessions/{session_id}/call-to-stand", json={"role": "witness", "new_person": {"full_name": "W Two"}}, headers=clerk_h)
check("second person while occupied -> 409", r.status_code == 409, r.text)
check("prosecutor cannot run the stand -> 403",
      client.post(f"{API}/courtroom/sessions/{session_id}/step-down", json={}, headers=pros_h).status_code == 403)
r = client.post(f"{API}/courtroom/sessions/{session_id}/step-down", json={"transcript": "I saw it."}, headers=clerk_h)
check("step down", r.status_code == 200 and r.json()["active_statement"] is None, r.text)

print("Admin-only + password change")
check("judge cannot list users -> 403", client.get(f"{API}/auth/users", headers=judge_h).status_code == 403)
check("judge cannot see system status -> 403", client.get(f"{API}/admin/system", headers=judge_h).status_code == 403)
check("weak password rejected -> 422",
      client.post(f"{API}/auth/users", json={"username": "weak.one", "password": "short", "full_name": "Weak One", "role": "clerk"}, headers=admin_h).status_code == 422)
me = client.get(f"{API}/auth/me", headers=admin_h).json()
check("admin can't disable own account -> 400",
      client.patch(f"{API}/auth/users/{me['id']}", json={"is_active": False}, headers=admin_h).status_code == 400)
import time  # noqa: E402

time.sleep(1.1)
r = client.post(f"{API}/auth/me/password", json={"current_password": PW, "new_password": "Brand-new-pass-7"}, headers=clerk_h)
check("change own password", r.status_code == 204, r.text)
check("old token rejected after password change -> 401", client.get(f"{API}/cases", headers=clerk_h).status_code == 401)
check("new password works", client.post(f"{API}/auth/login", data={"username": "clerk.test", "password": "Brand-new-pass-7"}).status_code == 200)

print(f"\nALL {passed} SECURITY CHECKS PASSED through the real HTTP layer.")
