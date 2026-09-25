"""
Hostile and careless input, through the real API.

Every rejection here is paired with a control: the same request with one field
fixed must be ACCEPTED. Without the control a wrong field name makes every
"rejection" pass for the wrong reason -- that is exactly how a first draft of
this check went green while testing nothing.

Run:  docker compose exec backend python -m tests.test_input_validation
"""
import tests._env as env  # noqa: F401  (must be first)

from fastapi.testclient import TestClient

env.reset_databases()

from app.core.security import hash_password  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.db.postgres_repository import UserRepository  # noqa: E402
from app.main import app  # noqa: E402
from app.models.auth_models import SystemRole  # noqa: E402

client = TestClient(app)
API = "/api/v1"
PW = "Correct-horse-42"
with SessionLocal() as db:
    UserRepository(db).create("clerk.iv", hash_password(PW), "Clerk IV", SystemRole.CLERK)
    db.commit()
clerk = {"Authorization": "Bearer " + client.post(f"{API}/auth/login", data={"username": "clerk.iv", "password": PW}).json()["access_token"]}

GOOD = {"case_type": "civil", "description": "My landlord has kept my security deposit since August."}
CASE = {"case_type": "civil", "title": "Deposit dispute", "description": "Unreturned deposit."}
n = 0


def check(name, cond, info=""):
    global n
    assert cond, f"{name}: {info}"
    n += 1
    print(f"   OK  {name}")


print("Public complaint form")
r = client.post(f"{API}/complaints", json=GOOD)
check("control: a valid complaint is accepted", r.status_code == 201, r.text)
check("a complaint that is only spaces is refused",
      client.post(f"{API}/complaints", json={**GOOD, "description": " " * 60}).status_code == 422)
check("control: 20 real characters are accepted",
      client.post(f"{API}/complaints", json={**GOOD, "description": "a" * 20}).status_code == 201)
check("19 characters are refused", client.post(f"{API}/complaints", json={**GOOD, "description": "a" * 19}).status_code == 422)
check("padding does not count towards the minimum",
      client.post(f"{API}/complaints", json={**GOOD, "description": "  " + "a" * 15 + "  "}).status_code == 422)
check("control: a valid email is accepted",
      client.post(f"{API}/complaints", json={**GOOD, "complainant_email": "a@example.com"}).status_code == 201)
check("an email with a header injection is refused",
      client.post(f"{API}/complaints", json={**GOOD, "complainant_email": "a@example.com\r\nBcc: x@y.zz"}).status_code == 422)
check("a negative-looking phone number is refused",
      client.post(f"{API}/complaints", json={**GOOD, "complainant_phone": "-5551234"}).status_code == 422)

print("NUL bytes are the sender's mistake, not ours")
for label, r in [
    ("public complaint", client.post(f"{API}/complaints", json={**GOOD, "description": "a\x00b" * 20})),
    ("case create", client.post(f"{API}/cases", json={**CASE, "description": "a\x00b"}, headers=clerk)),
]:
    check(f"{label}: 422 rather than 500", r.status_code == 422, f"{r.status_code} {r.text[:120]}")
check("the message is worded for a person",
      "can't be stored" in client.post(f"{API}/cases", json={**CASE, "title": "nul\x00title"}, headers=clerk).json()["detail"])
ar = client.post(f"{API}/cases", json={**CASE, "description": "a\x00b"}, headers={**clerk, "Accept-Language": "ar"}).json()["detail"]
check("...and in Arabic when asked", "لا يمكن حفظه" in ar, ar)

print("Statutory deadline")
check("control: an ordinary deadline is accepted",
      client.post(f"{API}/cases", json={**CASE, "statutory_deadline": "2026-12-01"}, headers=clerk).status_code == 201)
check("control: an overdue deadline is still accepted (that is what the priority score is for)",
      client.post(f"{API}/cases", json={**CASE, "statutory_deadline": "2020-01-01"}, headers=clerk).status_code == 201)
for bad in ("1900-01-01", "0001-01-01", "9999-12-31", "2101-01-01"):
    check(f"deadline {bad} is refused",
          client.post(f"{API}/cases", json={**CASE, "statutory_deadline": bad}, headers=clerk).status_code == 422)

print("Validation messages follow the language")
r = client.post(f"{API}/complaints", json={**GOOD, "description": " " * 60}, headers={"Accept-Language": "ar"})
check("a validator message arrives in Arabic", "يرجى وصف" in r.json()["detail"], r.json()["detail"])
check("the field name is kept", r.json()["detail"].startswith("description:"), r.json()["detail"])

print(f"\nINPUT VALIDATION CHECKS PASSED ({n})")
