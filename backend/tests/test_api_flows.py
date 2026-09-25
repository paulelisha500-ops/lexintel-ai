"""
Every module, end to end through the real API, with Elasticsearch, Neo4j,
the Celery worker, the writing model and speech-to-text all SWITCHED OFF
(tests/_env.py); the small meaning model stays on. So this also proves the
fallback paths: Postgres search, Postgres related-cases, in-process background
jobs, and research that returns cited articles and key passages without a
written draft. Drafting itself is covered by tests/test_ai_live.py.
"""
import tests._env as env  # noqa: F401  (must be first)

import io
import time
from datetime import datetime, timedelta, timezone

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
    for username, role in [("judge.flow", SystemRole.JUDGE), ("clerk.flow", SystemRole.CLERK),
                           ("officer.flow", SystemRole.CASE_OFFICER), ("admin.flow", SystemRole.ADMIN)]:
        UserRepository(db).create(username, hash_password(PW), username, role)
    db.commit()


def h(username: str) -> dict:
    return {"Authorization": "Bearer " + client.post(f"{API}/auth/login", data={"username": username, "password": PW}).json()["access_token"]}


judge, clerk, officer, admin = h("judge.flow"), h("clerk.flow"), h("officer.flow"), h("admin.flow")
passed = 0


def check(name, cond, info=""):
    global passed
    assert cond, f"{name}: {info}"
    passed += 1
    print(f"   OK  {name}")


def wait_for(fn, timeout=240, every=1.5):
    end = time.time() + timeout
    while time.time() < end:
        value = fn()
        if value:
            return value
        time.sleep(every)
    return None


print("Module 1/11 -- complaints (semantic triage)")
r = client.post(f"{API}/complaints", json={"case_type": "grievance", "complainant_name": "Flow Citizen",
                                           "description": "My Instagram account was hacked and they ask my friends for money on WhatsApp."})
check("submit", r.status_code == 201, r.text)
ref, code, cid = r.json()["reference_number"], r.json()["tracking_code"], r.json()["id"]
check("invalid email -> 422", client.post(f"{API}/complaints", json={"case_type": "civil", "description": "x" * 30, "complainant_email": "bad"}).status_code == 422)
check("track with code", client.post(f"{API}/complaints/track", json={"reference": ref, "code": code}).json()["status"] == "received")
check("track with wrong code -> 404", client.post(f"{API}/complaints/track", json={"reference": ref, "code": "WRONG999"}).status_code == 404)
c = wait_for(lambda: (lambda x: x if x["ai_status"] != "pending" else None)(client.get(f"{API}/complaints/{cid}", headers=clerk).json()))
check("triage by the meaning model, no writing model needed", c and c["ai_status"] == "done" and c["ai_suggested_category"] == "cybercrime", str(c))
check("triage explains itself: probabilities + nearest examples", c and c["ai_details"]["neighbours"] and c["ai_details"]["probabilities"]["cybercrime"] > 0.5, str(c and c.get("ai_details"))[:300])
r = client.patch(f"{API}/complaints/{cid}", json={"case_type": "cybercrime"}, headers=clerk)
check("staff category choice is recorded as a training example", r.status_code == 200 and r.json()["category_confirmed"] is True, r.text[:200])
r = client.post(f"{API}/complaints/{cid}/open-case", json={"title": "Hacked social media account"}, headers=officer)
check("open case from complaint", r.status_code == 201, r.text)
case_id = r.json()["case"]["id"]
check("tracking shows case number", client.post(f"{API}/complaints/track", json={"reference": ref, "code": code}).json()["case_number"])

print("Module 4 -- priority")
r = client.post(f"{API}/cases/{case_id}/priority", json={"public_safety_flag": True, "vulnerable_victim": True}, headers=officer)
check("rescore -> high with explanation", r.status_code == 200 and r.json()["level"] == "high" and "public-safety" in r.json()["explanation"], r.text)

print("Module 7 -- scheduling")
at = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=1)
r = client.post(f"{API}/hearings", json={"case_id": case_id, "scheduled_at": at.isoformat(), "courtroom": "4B", "duration_minutes": 60}, headers=clerk)
check("schedule", r.status_code == 201, r.text)
r = client.post(f"{API}/hearings", json={"case_id": case_id, "scheduled_at": (at + timedelta(minutes=30)).isoformat(), "courtroom": "4B"}, headers=clerk)
check("overlap in same courtroom -> 409 with conflicts", r.status_code == 409 and r.json()["detail"]["conflicts"], r.text)

print("Modules 2/3/9 -- evidence (in-process job fallback)")
text = "Report dated 12/03/2026. The vehicle stopped at Al Wasl Road. Damage estimated at AED 4,500."
r = client.post(f"{API}/cases/{case_id}/evidence", headers=officer, files={"file": ("report.txt", text.encode(), "text/plain")}, data={"label": "Police report"})
check("upload", r.status_code == 201, r.text)
ev = r.json()["id"]
check("disallowed type -> 415", client.post(f"{API}/cases/{case_id}/evidence", headers=officer, files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 415)
done = wait_for(lambda: (lambda e: e if e["processing_status"] not in ("queued", "processing") else None)(client.get(f"{API}/evidence/{ev}", headers=officer).json()))
check("processed without a worker", done and done["processing_status"] == "done", str(done))
t = client.get(f"{API}/evidence/{ev}/text", headers=judge).json()
check("entities extracted (amount + date)", any(e["label"] in ("AMOUNT_AED", "AMOUNT") for e in t["entities"]) and any(e["label"] == "DATE" for e in t["entities"]), str(t["entities"])[:300])
check("download matches upload", client.get(f"{API}/evidence/{ev}/file", headers=judge).content == text.encode())
check("integrity verified", client.post(f"{API}/evidence/{ev}/verify-integrity", headers=judge).json()["intact"] is True)
actions = {a["action"] for a in client.get(f"{API}/evidence/{ev}/custody", headers=judge).json()}
check("custody log records upload, text view and download", {"evidence.uploaded", "evidence.text_viewed", "evidence.downloaded"} <= actions, str(actions))
case = client.get(f"{API}/cases/{case_id}", headers=judge).json()
check("timeline built from evidence", any("12" in (e["event_date"] or "") or "2026" in (e["event_date"] or "") for e in case["timeline"]), str(case["timeline"])[:300])
evd = client.get(f"{API}/evidence/{ev}", headers=officer).json()
check("evidence summary quotes the document", evd.get("ai_summary") and evd["ai_summary"]["summary"]["sentences"], str(evd.get("ai_summary"))[:300])

print("Module 2 -- source comparison and case brief")
text_b = ("Owner's statement given on 12/03/2026. The owner said the damage was estimated at AED 6,000. "
          "According to Article 5 of the Traffic Law the driver must stop after an accident.")
r = client.post(f"{API}/cases/{case_id}/evidence", headers=officer, files={"file": ("owner.txt", text_b.encode(), "text/plain")}, data={"label": "Owner statement"})
ev_b = r.json()["id"]
done_b = wait_for(lambda: (lambda e: e if e["processing_status"] not in ("queued", "processing") else None)(client.get(f"{API}/evidence/{ev_b}", headers=officer).json()))
check("cited law found in the document", done_b and any(ref["reference"].startswith("Article 5") for ref in done_b["ai_summary"]["legal_references"]), str(done_b and done_b.get("ai_summary"))[:300])
cmp = client.post(f"{API}/cases/{case_id}/compare", json={"source_a": f"evidence:{ev}", "source_b": f"evidence:{ev_b}"}, headers=judge).json()
check("comparison pairs the two damage estimates", any("4,500" in d["source_a"] and "6,000" in d["source_b"] for d in cmp["ai_differences"]), str(cmp)[:400])
brief = client.get(f"{API}/cases/{case_id}/brief", headers=judge).json()
check("brief quotes each evidence document", {"Police report", "Owner statement"} <= {s["label"] for s in brief["sections"]}, str(brief)[:300])
with client.stream("POST", f"{API}/cases/{case_id}/brief/stream", params={"lang": "en"}, headers=judge) as s:
    lines = [line for line in s.iter_lines() if line.startswith(("event:", "data:"))]
check("brief stream ends with a final event (drafting off -> quoted facts only)",
      lines[0] == "event: sources" and lines[-2] == "event: final" and '"ai_unavailable"' in lines[-1], str(lines[-2:])[:300])

print("Module 6 -- research (no LLM -> cited articles only)")
r = client.post(f"{API}/research/ask", json={"question": "notice period"}, headers=judge)
check("empty library -> no_corpus, not an error", r.status_code == 200 and r.json()["status"] == "no_corpus", r.text)
law = ("Sample law (test data)\n\nArticle (1)\nDefinitions used in this sample law apply to employers and workers.\n\n"
       "Article (2)\nEither party may end the contract by giving written notice of not less than thirty days.\n\n"
       "Article (3)\nA worker who completes one year of service is entitled to end-of-service gratuity.\n")
r = client.post(f"{API}/library/documents", headers=clerk, files={"file": ("law.txt", law.encode(), "text/plain")},
                data={"title": "Test Labour Law", "jurisdiction": "federal", "language": "en", "effective_from": "2022-02-02"})
check("upload law", r.status_code == 201, r.text)
doc_id = r.json()["id"]
d = wait_for(lambda: (lambda x: x if x["status"] not in ("queued", "processing") else None)(client.get(f"{API}/library/documents/{doc_id}", headers=clerk).json()), timeout=600, every=3)
check("law indexed into articles", d and d["status"] == "indexed" and d["article_count"] == 3, str(d))
r = client.post(f"{API}/research/ask", json={"question": "How much notice to end an employment contract?"}, headers=judge).json()
check("research cites Article 2 first", r["citations"] and r["citations"][0]["article"] == "2", str(r)[:400])
check("key passages quote the answering sentence", r["key_passages"] and "thirty days" in r["key_passages"][0]["text"], str(r.get("key_passages"))[:300])
check("drafting off -> flagged for review, no invented answer", r["answer_status"] == "ai_unavailable" and r["needs_human_review"] and r["answer"] == "", str(r)[:300])
with client.stream("POST", f"{API}/research/ask/stream", json={"question": "How much notice to end an employment contract?"}, headers=judge) as s:
    kinds = [line.split(":", 1)[1].strip() for line in s.iter_lines() if line.startswith("event:")]
check("research stream: status -> sources -> final", kinds[:2] == ["status", "sources"] and kinds[-1] == "final", str(kinds))
r = client.post(f"{API}/research/ask", json={"question": "notice", "as_of_date": "2020-01-01"}, headers=judge).json()
check("law not yet in force is excluded by the effective-date filter", r["answer_status"] == "no_sources", str(r)[:300])
arts = client.get(f"{API}/library/documents/{doc_id}/articles", headers=judge).json()["articles"]
check("article viewer", [a["article"] for a in arts] == ["1", "2", "3"], str(arts)[:200])

print("Modules 5/10 + search -- fallbacks")
check("similar cases (fallback)", client.get(f"{API}/cases/{case_id}/similar", headers=judge).json()["source"] == "fallback")
check("related cases (fallback)", client.get(f"{API}/cases/{case_id}/related", headers=judge).json()["source"] == "fallback")
s = client.get(f"{API}/search", params={"q": "Hacked"}, headers=officer).json()
check("global search (database fallback) finds the case", s["source"] == "fallback" and s["results"]["cases"], str(s)[:300])
a = client.get(f"{API}/analytics/overview", headers=judge).json()
check("analytics", a["cases"]["total"] == 1 and a["complaints"]["total"] == 1 and a["evidence"]["total"] == 2, str(a)[:300])
sysinfo = client.get(f"{API}/admin/system", headers=admin).json()
down = {x["name"] for x in sysinfo["services"] if not x["available"]}
check("system status reports disabled services with fallbacks", {"elasticsearch", "neo4j", "llm"} <= down and sysinfo["fallbacks"], str(down))

print(f"\nALL {passed} FLOW CHECKS PASSED with optional services switched off.")
