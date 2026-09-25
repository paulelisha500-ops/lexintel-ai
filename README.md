# LexIntel

Source: [GitHub](https://github.com/paulelisha500-ops/lexintel-ai) · Mirror: [Hugging Face](https://huggingface.co/Elisha622/lexintel-ai)

Court case management and legal-intelligence platform for the UAE — decision
support for courts, prosecutors and lawyers. Bilingual (Arabic / English,
full right-to-left), built on the official **UAE Design System**
(`@aegov/design-system`), with every AI feature backed by a non-AI fallback.

**Humans decide.** LexIntel never issues verdicts and never scores emotion or
"deception". Only a judge can enter a ruling. See
[`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md).

## What it does (all modules are real, end to end)

| Module | What you can do |
|---|---|
| 1 · Complaints | Citizens file online (no account), get a **reference number + tracking code**, and track status. Staff triage with AI suggestions (category, department, duplicates, priority), then **open a case** in one click. |
| 2 · Case intelligence | Extract people, places, dates and amounts from any text; dated events go onto the case **timeline**. A **case brief** quotes the key sentences of the file, the topics it discusses and the laws it cites, with an optional checked draft. Compare two documents/statements for **factual differences** (never credibility). |
| 3 · Evidence | Upload PDFs, scans, photos, text, audio/video. SHA-256 fingerprint on upload, Arabic + English **OCR**, transcription of recordings, **chain-of-custody log**, integrity re-check, review/flag. |
| 4 · Prioritisation | Transparent weighted score from factual signals, with a factor-by-factor explanation; re-scored nightly as cases age. |
| 5 · Similar & related cases | Similar wording across case files (Elasticsearch); people who appear in other cases and cases citing the same law (Neo4j graph). |
| 6 · Legal research | Answers only from the **Law Library** (official PDFs you upload), with article citations and an in-force date filter. Keyword + semantic retrieval. |
| 7 · Scheduling | Hearing calendar (day/week) that **blocks courtroom and judge double-booking**. |
| Courtroom stand | One person at a time: clerk confirms identity, **real microphone/camera recording**, **live local speech-to-text** (Arabic/English), transcript review, full-quality re-transcription. |
| 9 · Signatures | Signature presence + similarity check against a reference (document authentication only). |
| 10 · Analytics | Live dashboard and analytics with table views for every chart. |
| 11 · Citizen portal | Public site, complaint filing and tracking. |
| 12 · Explainable AI | Every AI output shows its reasons, sources and confidence. Drafts are checked sentence by sentence against their sources, with unmatched sentences marked. All AI runs on this server. |
| Security | JWT sign-in, 5 roles, lockout after 5 failed attempts, tokens revoked on password change, Emirates IDs stored only as keyed hashes, **audit log** of every action, admin user management. |

## Run it

Requirements: Docker Desktop. Everything else runs in containers.

```bash
docker compose up -d --build
```

- App: **http://localhost:3005**
- API: **http://localhost:8005** (docs at `/docs`)

First run only — create the demo accounts and demo records:

```bash
docker compose exec backend python -m scripts.seed_demo --password "LexIntel@2026"
```

This creates the demo accounts, five clearly-marked demo cases with documents
(read by the same pipeline as uploaded evidence, so briefs, key sentences,
topics, cited laws and similar cases have material), three demo complaints,
and three short sample law texts so the Law Library and Legal research have
something to answer from. The sample texts were written for the demo and say
so on their first line -- they are not UAE legislation.

Re-run it with `--refresh` after an update: that refreshes the demo records,
adds anything a newer version of the seed introduced, and moves the demo
hearings back to today, so the Courtroom stand always has a session to open.

| Username | Role |
|---|---|
| `admin` | Administrator (users, audit log, system status) |
| `judge.demo`, `judge2.demo` | Judge (the only role that can enter a ruling) |
| `clerk.demo` | Court clerk (complaints, scheduling, courtroom stand) |
| `officer.demo` | Case officer (cases, evidence, triage) |
| `prosecutor.demo` | Prosecutor (evidence, research) |

All demo accounts use the password you pass to `seed_demo`. Change them before any real use.

### Legal research needs the Law Library

Official UAE statute portals block automated downloads, and this project does
not circumvent that. Download the official PDF yourself (for example from
uaelegislation.gov.ae) and upload it under **Law library**. Articles marked
"Article (N)" / "المادة (N)" are indexed individually.

The seed ships three short sample laws so the feature can be tried
immediately. They are demo text, not real statute: every title starts with
"Demo:" so an article cited in a research answer can't be mistaken for a real
one. Delete them once you have uploaded the real texts.

### AI runs on this server

No cloud AI and no API key. Small task models handle classification,
duplicates, similar cases, summaries and offence mentions; a local writing
model (qwen2.5 1.5B via Ollama) drafts research answers and case briefs,
streamed as it writes and checked sentence by sentence against the sources.
Download the writing model once (about 1 GB):

```bash
docker compose exec ollama ollama pull qwen2.5:1.5b-instruct
```

Without it, everything else still works: research shows the in-force articles
and key passages, and case briefs show the quoted key facts. See
`docs/ARCHITECTURE.md` → *AI on this server*.

## Services and what happens if one is down

| Service | Used for | If it's down |
|---|---|---|
| PostgreSQL | Cases, complaints, hearings, people, rulings, audit | API returns a clear 503 and retries |
| MongoDB | Courtroom sessions, statements, evidence text | Courtroom pages show "temporarily unavailable"; text falls back to Postgres |
| Redis + Celery worker | Background jobs, nightly re-scoring and re-indexing | Jobs run inside the API process |
| Elasticsearch | Full-text search, duplicates, similar cases, law keyword search | Database search and word-overlap matching |
| Neo4j | Relationship graph | Related cases computed from Postgres |
| faster-whisper | Speech-to-text | Clerk types/corrects the transcript |
| Ollama (writing model) | Research drafts, case briefs | Articles + key passages; quoted key facts |

Live status of all of these: **System status** (admin).

### Memory

The full stack idles at about 2 GB, and the writing model adds ~0.9 GB while
loaded. Each service has a memory cap, and the AI models refuse to start when
free memory is short -- you get the quoted sources instead of a draft, which
is far better than the machine seizing up. System status shows the free
memory and what it currently allows. On an 8 GB machine, stop other Docker
projects while using LexIntel, or give Docker more memory in
`%UserProfile%\.wslconfig` (for example `memory=5GB`).

The API does not watch for code changes. After editing backend code:

```bash
docker compose restart backend
```

For hot reload while developing, add the dev override:
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d backend`.

## Tests

```bash
docker compose exec backend python -m tests.run_all
```

Uses separate `lexintel_test` databases, never your data. Includes a security
suite (roles, ruling boundary, lockout, token revocation), a full flow suite
run with every optional service switched off (proves the fallbacks), a suite
for the AI task models (classification, duplicates, offence mentions,
summaries, the grounding check and the model slots), and a live Neo4j test.
The runner unloads the writing model first, because holding it costs ~1.1 GB.

Drafting by the local writing model is slow on CPU, so it runs only when asked:

```bash
docker compose exec backend python -m tests.run_all --live-ai
```

## Project layout

```
backend/
  app/api/            auth_routes.py + routers/ (complaints, cases, evidence,
                      scheduling, courtroom, research, insights)
  app/agents/         LangGraph agents: intake triage, case intelligence,
                      legal research, prioritisation, courtroom session
  app/db/             Postgres repositories + migrations, Mongo, Elasticsearch,
                      Neo4j -- each with a reachability probe
  app/ingestion/      OCR + signature checks, Law Library parsing/indexing
  app/stt/            local speech-to-text (faster-whisper)
  app/tasks.py        background jobs (Celery, with in-process fallback)
  scripts/            seed_demo.py, seed_admin.py
  tests/              run_all.py + suites
frontend/
  src/components/     UAE Design System components, layouts, charts
  src/pages/public/   landing, file/track complaint, sign in
  src/pages/app/      dashboard, cases (+ case workspace), complaints,
                      hearings, courtroom stand, research, library,
                      analytics, admin
  public/images/      photos (Unsplash licence, see CREDITS.md)
docs/                 architecture, design decisions, law sources
```

LexIntel is an independent decision-support platform, not an official UAE
government service, and does not replace licensed legal counsel.
