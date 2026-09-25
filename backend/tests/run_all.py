"""
Run every test script and report. Inside the backend container:

    docker compose exec backend python -m tests.run_all

Uses separate lexintel_test databases (tests/_env.py); never touches dev data.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

SCRIPTS = [
    "tests.test_messages",
    "tests.test_input_validation",
    "tests.test_uae_legislation_parser",
    "tests.test_uae_legislation_metadata",
    "tests.test_arabic_ner",
    "tests.test_case_intelligence_routing",
    "tests.test_ai_models",
    "tests.test_neo4j_repository",
    "tests.test_neo4j_live",
    "tests.test_mongo_repository",
    "tests.test_postgres_repository",
    "tests.test_e2e_auth",
    "tests.test_api_flows",
]

def free_writing_model() -> None:
    """Ask Ollama to unload the writing model first. It holds ~1.1 GB, and on a
    small machine that is the difference between the suite running and Python
    failing to start a subprocess at all."""
    base = os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434").rstrip("/")
    model = os.environ.get("OLLAMA_MODEL", "qwen2.5:1.5b-instruct")
    body = json.dumps({"model": model, "keep_alive": 0}).encode()
    try:
        req = urllib.request.Request(f"{base}/api/generate", body, {"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=20).read()
    except Exception:
        pass   # no Ollama, or already unloaded -- nothing to free


if "--live-ai" not in sys.argv:
    free_writing_model()

if "--live-ai" in sys.argv:  # drafting with the local writing model; slow on CPU
    SCRIPTS.append("tests.test_ai_live")

results = []
for name in SCRIPTS:
    started = time.time()
    proc = subprocess.run([sys.executable, "-W", "ignore", "-m", name], capture_output=True, text=True)
    ok = proc.returncode == 0
    results.append((name, ok, round(time.time() - started, 1)))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  ({results[-1][2]}s)")
    if not ok:
        print((proc.stdout + proc.stderr)[-3000:])

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} test scripts passed.")
sys.exit(1 if failed else 0)
