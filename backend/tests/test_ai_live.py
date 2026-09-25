"""
Live drafting with the local writing model (Ollama): streamed research
answers in English and Arabic and a streamed case brief, through the real
API, on the lexintel_test databases. Slow on CPU (a few minutes), so it runs
only when asked:

    docker compose exec backend python -m tests.test_ai_live
    docker compose exec backend python -m tests.run_all --live-ai

Skips (exit 0) if the Ollama container or the model isn't available.
"""
import os

import tests._env as env  # noqa: F401  (must be first)

os.environ["LLM_PROVIDER"] = "ollama"
os.environ.setdefault("OLLAMA_BASE_URL", "http://ollama:11434")

import json  # noqa: E402
import time  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core import llm  # noqa: E402

if not llm.llm_probe.available():
    print(f"SKIPPED: writing model unavailable ({llm.llm_probe.status().get('error')})")
    raise SystemExit(0)

env.reset_databases()

from app.ai.text import has_foreign_script  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import SessionLocal  # noqa: E402
from app.db.postgres_repository import UserRepository  # noqa: E402
from app.main import app  # noqa: E402
from app.models.auth_models import SystemRole  # noqa: E402

client = TestClient(app)
API = "/api/v1"
PW = "Correct-horse-42"
with SessionLocal() as db:
    for username, role in [("judge.live", SystemRole.JUDGE), ("clerk.live", SystemRole.CLERK)]:
        UserRepository(db).create(username, hash_password(PW), username, role)
    db.commit()
judge = {"Authorization": "Bearer " + client.post(f"{API}/auth/login", data={"username": "judge.live", "password": PW}).json()["access_token"]}
clerk = {"Authorization": "Bearer " + client.post(f"{API}/auth/login", data={"username": "clerk.live", "password": PW}).json()["access_token"]}


def check(name, cond, info=""):
    assert cond, f"{name}: {info}"
    print(f"   OK  {name}")


def stream(path, body=None, params=None):
    events, current = [], None
    started = time.time()
    first_token = None
    with client.stream("POST", f"{API}{path}", json=body, params=params, headers=judge, timeout=600) as s:
        for line in s.iter_lines():
            if line.startswith("event:"):
                current = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:])
                if current == "token" and first_token is None:
                    first_token = time.time() - started
                events.append((current, data))
    return events, time.time() - started, first_token


def upload_law(title, text, language):
    r = client.post(f"{API}/library/documents", headers=clerk, files={"file": (f"{title}.txt", text.encode(), "text/plain")},
                    data={"title": title, "jurisdiction": "federal", "language": language, "effective_from": "2022-02-02"})
    doc_id = r.json()["id"]
    for _ in range(200):
        d = client.get(f"{API}/library/documents/{doc_id}", headers=clerk).json()
        if d["status"] not in ("queued", "processing"):
            return d
        time.sleep(2)


print("Setup: sample laws (test data, not real statute text)")
en = upload_law("Sample Labour Law", "Article (1)\nEither party may end the employment contract for a legitimate reason by giving the other party written notice of not less than thirty days and not more than ninety days.\n\n"
                "Article (2)\nA worker who completes one year of continuous service is entitled to end-of-service gratuity.\n", "en")
ar = upload_law("قانون عمل تجريبي", "المادة (1)\nيجوز لأي من طرفي عقد العمل إنهاؤه لسبب مشروع، على أن يخطر الطرف الآخر كتابياً قبل مدة لا تقل عن ثلاثين يوماً ولا تزيد على تسعين يوماً.\n\n"
                "المادة (2)\nيستحق العامل الذي أكمل سنة من الخدمة المتصلة مكافأة نهاية الخدمة.\n", "ar")
check("both sample laws indexed", en["status"] == "indexed" and ar["status"] == "indexed", (en, ar))

for label, question, lang in [("English", "How much notice is needed to end an employment contract?", "en"),
                              ("Arabic", "ما مدة الإخطار اللازمة لإنهاء عقد العمل؟", "ar")]:
    print(f"Research draft ({label})")
    events, total, first = stream("/research/ask/stream", {"question": question})
    kinds = [k for k, _ in events]
    final = events[-1][1]
    print(f"      {total:.0f}s total, first token after {first or 0:.0f}s, status={final['answer_status']}")
    check("sources arrive before any draft text", kinds.index("sources") < (kinds.index("token") if "token" in kinds else len(kinds)))
    check("stream ends with exactly one final", kinds[-1] == "final" and kinds.count("final") == 1, kinds[-3:])
    # "ai_unavailable" is a legitimate outcome here: on a small machine the
    # memory guard skips the draft rather than starving the host (app/ai/memory.py).
    allowed = ("ok", "discarded", "ai_busy", "ai_unavailable")
    check("final is a checked draft or an honest fallback", final["answer_status"] in allowed, final["answer_status"])
    if final["answer_status"] == "ai_unavailable":
        print(f"      note: no draft this run -- {final['review_reason']}")
    if final["answer_status"] == "ok":  # only assert on draft quality when one was written
        print("      " + final["answer"][:300].replace("\n", " "))
        check("draft carries computed citations", "[1]" in final["answer"] or "[2]" in final["answer"], final["answer"][:200])
        check("every sentence has a support verdict", all(s["support"] in ("supported", "partial", "unsupported", "heading")
                                                           for s in final["grounding"]["sentences"]))
        check("no foreign script reached the reader", not has_foreign_script(final["answer"]))
    else:
        check("fallback still shows the law", final["citations"] and final["key_passages"], final.get("review_reason"))

print("Case brief draft")
case = client.post(f"{API}/cases", headers=clerk, json={"case_type": "civil", "title": "Unpaid notice period claim",
                   "description": "The employee states that the employer ended the contract on 1 March 2026 without any written notice. "
                                  "The employer says ten days of notice were given by telephone. The employee claims thirty days of wages."}).json()
events, total, first = stream(f"/cases/{case['id']}/brief/stream", params={"lang": "en"})
final = events[-1][1]
print(f"      {total:.0f}s total, status={final['status']}: {final.get('draft', '')[:250]}")
check("brief stream: sources first, one final", events[0][0] == "sources" and [k for k, _ in events].count("final") == 1)
check("brief is a checked draft or an honest fallback",
      final["status"] in ("ok", "discarded", "ai_busy", "ai_unavailable"), final)

print("\nLIVE DRAFTING CHECKS PASSED")
