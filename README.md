<div align="center">

# ⚖️ LexIntel

**Court case management and legal intelligence for the United Arab Emirates**

Bilingual Arabic / English · Built on the UAE Design System · AI that explains itself and never decides

[![Open on GitHub Pages](https://img.shields.io/badge/Open%20the%20app-GitHub%20Pages-222?logo=github)](https://paulelisha500-ops.github.io/lexintel-ai/)
[![Open in Hugging Face Spaces](https://img.shields.io/badge/Open%20the%20app-Hugging%20Face%20Space-FFD21E?logo=huggingface&logoColor=000)](https://huggingface.co/spaces/Elisha622/lexintel-ai)
[![Source on GitHub](https://img.shields.io/badge/Source-GitHub-181717?logo=github)](https://github.com/paulelisha500-ops/lexintel-ai)
![Arabic and English](https://img.shields.io/badge/Languages-Arabic%20%7C%20English-00843D)
![AI runs locally](https://img.shields.io/badge/AI-runs%20locally-4B5563)

</div>

---

LexIntel brings the whole life of a case into one workspace for courts, prosecutors and lawyers: the citizen's complaint, the case file and its evidence, the hearing calendar, the courtroom stand, legal research grounded in the law library, and finally the judge's ruling. Every screen works in Arabic and English with full right-to-left support, on the official UAE Design System (`@aegov/design-system`).

**Humans decide.** LexIntel organises, reads, transcribes and cites; it never issues a verdict, never scores emotion, credibility or "deception", and only a judge can enter a ruling — a rule enforced in the code, not just the interface. See [Design decisions](docs/DESIGN_DECISIONS.md).

For a guided overview of the platform, read the [Introduction](docs/INTRODUCTION.md).

## Contents

- [Try it](#try-it)
- [Capabilities](#capabilities)
- [AI that explains itself](#ai-that-explains-itself)
- [Deployment options](#deployment-options)
- [Running with Docker](#running-with-docker)
- [Architecture](#architecture)
- [Security and privacy](#security-and-privacy)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Documentation](#documentation)

## Try it

Open LexIntel with no installation, on **[GitHub Pages](https://paulelisha500-ops.github.io/lexintel-ai/)** or **[Hugging Face](https://huggingface.co/spaces/Elisha622/lexintel-ai)**. The complete application — its API, database and AI models — runs inside your browser, and your data stays on your device.

| Username | Role | Password |
|---|---|---|
| `admin` | System administrator | `LexIntel@2026` |
| `judge`, `judge2` | Judge | `LexIntel@2026` |
| `clerk` | Court clerk | `LexIntel@2026` |
| `officer` | Case officer | `LexIntel@2026` |
| `prosecutor` | Prosecutor | `LexIntel@2026` |

Each browser starts with its own private copy of these accounts and the initial case files. Change the password under *Profile*. Citizens use *File a complaint* and *Track a complaint* without an account.

## Capabilities

| Area | What it does |
|---|---|
| **Complaints & citizen portal** | Citizens file online without an account and receive a reference number and tracking code. Staff see an AI triage suggestion — category, department, possible duplicates, priority — with its reasoning, then confirm it or open a case in one step. The classifier learns from every staff decision. |
| **Case workspace** | Parties, hearings, evidence, timeline, statements, research notes, related cases, ruling and a full activity trail in one file. |
| **Case intelligence** | Dates, amounts, people, places and case references are extracted from any document; dated events populate the timeline. A **case brief** quotes the key sentences of the file, the offence topics it discusses and the laws it cites. Two documents or statements can be compared for **factual differences** — never for credibility. |
| **Evidence** | PDFs, scans, photos, text, audio and video. SHA-256 fingerprint on upload, Arabic + English OCR, transcription of recordings, integrity re-check, review and flagging, and a **chain-of-custody log** of every view and download. |
| **Signatures** | Detects whether a signature is present on a scanned document and measures its similarity to a reference — document authentication only, flagged for a clerk when in doubt. |
| **Prioritisation** | A transparent weighted score from factual signals (public safety, statutory deadline, vulnerable victim, missing evidence, case age), shown factor by factor. A workload recommendation, never a view on the merits. |
| **Similar & related cases** | Cases similar in meaning or wording; people who appear in other cases; cases whose research cites the same articles. |
| **Scheduling** | Day and week court calendar that blocks courtroom and judge double-booking before it happens. |
| **Courtroom stand** | One person at a time: the clerk confirms identity, microphone and camera recording starts, and a live transcript appears as the person speaks (Arabic or English). The clerk marks who is speaking — the person at the stand, the judge, the prosecutor, defence counsel, an interpreter or the clerk (keys 1–6) — so every line of the transcript is saved with its speaker and time. After step-down the full recording is transcribed again at full quality. |
| **Legal research** | Answers come only from the Law Library, with article citations, key passages and an in-force date filter; repealed law is excluded before anything is drafted. |
| **Law Library** | Upload official law PDFs or text; articles marked "Article (N)" / "المادة (N)" are indexed individually. |
| **Analytics** | Live dashboards for cases, complaints, hearings, evidence and rulings, each chart with an accessible table view. |
| **Administration** | Staff accounts and roles, the audit log, and live status of every service and AI model. |

## AI that explains itself

All AI in LexIntel runs locally — on the court's own server, or on the user's own device in the browser edition. No text, document or recording is sent to an outside AI service, and no API key is needed.

| Model | Purpose |
|---|---|
| `paraphrase-multilingual-MiniLM-L12-v2` | Meaning-matching across Arabic and English: complaint classification, duplicate detection, similar cases, extractive summaries, key passages, the grounding check |
| Qwen2.5 Instruct (small) | Short drafts of research answers and case briefs (server edition) |
| Whisper (tiny for the live transcript, base for full recordings) | Speech-to-text at the courtroom stand and for audio evidence |
| Tesseract (Arabic + English) | OCR of scanned documents |

Every output is built to be checked by a person:

- **Summaries quote**; they never paraphrase. Each key sentence is taken verbatim from its document.
- **Drafts are verified sentence by sentence** against their numbered sources. Citations are computed by the check, not trusted from the model; sentences that match no source, and figures the sources don't contain, are visibly marked; drafts that mostly fail the check are withheld.
- **Offence mentions are topics, not charges** — each is shown with the sentence that mentions it.
- **Every feature has a non-AI fallback.** If a model is unavailable, research still shows the in-force articles and key passages, briefs still show the quoted facts, triage falls back to bilingual keywords, and clerks can type or correct any transcript.

## Deployment options

| Edition | Where it runs | Best for |
|---|---|---|
| **Browser edition** — [GitHub Pages](https://paulelisha500-ops.github.io/lexintel-ai/) · [Hugging Face](https://huggingface.co/spaces/Elisha622/lexintel-ai) | The API ([`frontend/src/server`](frontend/src/server)), database (IndexedDB) and AI models (ONNX Runtime Web, multi-core WebAssembly) all run in the browser. Hosted as static files. Model-written drafts are off in this edition; quoted facts, key passages and cited articles are unaffected. | Evaluation, training and single-user work, with no server to operate |
| **Server edition** — Docker Compose | FastAPI backend, PostgreSQL, MongoDB, Redis + Celery, Elasticsearch, Neo4j, Ollama, faster-whisper | A court or firm running LexIntel for many users on its own infrastructure |
| **Single container** — root [`Dockerfile`](Dockerfile) | The server edition in one image (nginx, API, PostgreSQL, MongoDB, Redis, Ollama) | One server or a Hugging Face Docker Space |

The browser edition implements the same API contract as the Python backend — same endpoints, roles, validation, error messages (in Arabic and English) and streaming — so the frontend is identical in all three. ### Continuous deployment

This project uses a GitHub Actions CI/CD pipeline. Pushing to the `main` branch triggers automated workflows that build the app and publish it — no manual deployment needed:

| Workflow | Publishes to | Needs |
|---|---|---|
| [`.github/workflows/pages.yml`](.github/workflows/pages.yml) | GitHub Pages | Pages source set to *GitHub Actions* |
| [`.github/workflows/huggingface.yml`](.github/workflows/huggingface.yml) | The Hugging Face Space | Repository secret `HF_TOKEN` (a Hugging Face token with write access to the Space) |

Either can also be started by hand from the repository's *Actions* tab. [`deploy/huggingface-space/deploy.sh`](deploy/huggingface-space/deploy.sh) publishes to the Space from a local machine.

## Running with Docker

Requirements: Docker Desktop (8 GB of memory or more recommended).

```bash
docker compose up -d --build
```

- Application: **http://localhost:3005**
- API: **http://localhost:8005** (interactive documentation at `/docs`)

On first run, create the staff accounts and initial case files:

```bash
docker compose exec backend python -m scripts.seed_data --password "LexIntel@2026"
```

This creates the accounts listed above, five case files with documents (processed by the same pipeline as uploaded evidence), three citizen complaints and three short sample law texts. Run it again with `--refresh` after an update to add anything newer and move the initial hearings back to today.

Download the local writing model once (about 1 GB):

```bash
docker compose exec ollama ollama pull qwen2.5:1.5b-instruct
```

### Law Library

Official UAE statute portals do not permit automated downloads, and LexIntel does not circumvent that. Download the official PDF (for example from [uaelegislation.gov.ae](https://uaelegislation.gov.ae)) and upload it under **Law library**. The three bundled law texts are sample text for trying the research feature and are labelled as such — they are not official legislation. Remove them once the official texts are uploaded.

### Services and fallbacks

| Service | Used for | If it is unavailable |
|---|---|---|
| PostgreSQL | Cases, complaints, hearings, people, rulings, audit log | The API answers with a clear 503 and keeps retrying |
| MongoDB | Courtroom sessions, statements, evidence text | Courtroom pages report the outage; evidence text falls back to PostgreSQL |
| Redis + Celery | Background jobs, nightly re-scoring and re-indexing | Jobs run inside the API process |
| Elasticsearch | Full-text search, duplicates, similar cases, law keyword search | Database search and word-overlap matching |
| Neo4j | Relationship graph | Related cases computed from PostgreSQL |
| faster-whisper | Speech-to-text | Clerks type or correct the transcript |
| Ollama | Research drafts and case briefs | Articles with key passages; quoted key facts |

Live status of every service and model is under **System status** (administrators).

The full stack idles at about 2 GB of memory; the writing model adds about 0.9 GB while loaded and refuses to start when memory is short, returning the quoted sources instead of a draft. On an 8 GB machine, give Docker more memory in `%UserProfile%\.wslconfig` (for example `memory=5GB`).

## Architecture

```
                 ┌───────────────────────────────────────────────┐
  Browser        │  React + TypeScript · UAE Design System       │
                 │  Arabic / English · RTL · accessible charts   │
                 └───────────────┬───────────────────────────────┘
                                 │  REST + server-sent events
          ┌──────────────────────┴───────────────────────┐
          │                                              │
  Server edition                                 Browser edition
  FastAPI · LangGraph agents                     Same API in the page
  PostgreSQL · MongoDB · Redis/Celery            IndexedDB
  Elasticsearch · Neo4j                          Web Worker with ONNX Runtime Web
  Ollama · faster-whisper · Tesseract            (WebGPU / WebAssembly), tesseract.js
```

See [Architecture](docs/ARCHITECTURE.md) for the request flow, the background jobs and how each AI component degrades.

## Security and privacy

- Token-based sign-in with five roles: judge, prosecutor, clerk, case officer and administrator; no self-registration.
- Account lockout after five failed attempts; sessions revoked when a password changes.
- **Only a judge can enter a ruling**, and it is always attributed to the signed-in judge.
- Emirates ID numbers are stored only as keyed hashes (plus the last four digits for display).
- Complaint tracking codes are stored only as keyed hashes.
- An append-only audit log records every significant action, including every view and download of evidence.
- AI runs locally; in the browser edition, records and files never leave the user's device.

Before production use, review the deployment against UAE Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data and your court's own data-protection requirements.

## Testing

```bash
docker compose exec backend python -m tests.run_all
```

The suites use separate `lexintel_test` databases and cover security (roles, the ruling boundary, lockout, token revocation), full end-to-end flows with every optional service switched off (proving each fallback), the AI task models (classification, duplicates, offence mentions, summaries, the grounding check) and the Neo4j graph. Drafting by the writing model is slow on CPU, so its tests run only on request:

```bash
docker compose exec backend python -m tests.run_all --live-ai
```

## Project structure

```
backend/                    Server edition (Python 3.11, FastAPI)
  app/api/                  Authentication and routers: complaints, cases, evidence,
                            scheduling, courtroom, research, insights
  app/agents/               LangGraph agents: intake triage, case intelligence,
                            legal research, prioritisation, courtroom session
  app/ai/                   Task models: embeddings, classifier, summaries, offences,
                            grounding check, drafting
  app/db/                   PostgreSQL, MongoDB, Elasticsearch and Neo4j layers
  app/ingestion/            OCR, signature checks, Law Library parsing
  app/stt/                  Speech-to-text (faster-whisper)
  scripts/                  seed_data.py, seed_admin.py
  tests/                    Test runner and suites
frontend/                   React + TypeScript
  src/pages/                Public site, staff workspace, administration
  src/components/           UAE Design System components, AI displays, charts
  src/server/               Browser edition: the API, storage, jobs and AI worker
deploy/
  docker/                   Single-container start-up and nginx configuration
  huggingface-space/        Browser-edition build and publish script
docs/                       Introduction, architecture, design decisions, law sources
```

## Documentation

- [Introduction](docs/INTRODUCTION.md) — what LexIntel is, who it serves and how a case moves through it
- [Architecture](docs/ARCHITECTURE.md) — components, request flow, background jobs and fallbacks
- [Design decisions](docs/DESIGN_DECISIONS.md) — the principles behind human-only decisions and explainable AI
- [UAE law sources](docs/UAE_LAW_SOURCES.md) — where official legislation comes from and how to load it

---

LexIntel is an independent decision-support platform. It is not an official UAE government service and does not replace licensed legal counsel. Photographs are used under the Unsplash licence ([credits](frontend/public/images/CREDITS.md)).
