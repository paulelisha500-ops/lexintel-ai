# Architecture

## Principles

1. **Every click does something real.** No placeholder numbers, mock
   transcripts or "coming soon" buttons. If a capability depends on an
   optional service, the UI says what the fallback is.
2. **Degrade, never break.** Every optional dependency (Elasticsearch, Neo4j,
   Redis/Celery, the LLM, speech-to-text, Mongo) sits behind a cached
   reachability probe (`app/core/resilience.py`). A dead service costs one
   short timeout per 20 seconds, then callers take their fallback path.
3. **Humans decide.** AI output is decision support with visible reasons.
   Rulings are judge-only at the HTTP layer. See `DESIGN_DECISIONS.md`.

## Components

```
Browser (React + Vite, UAE Design System, AR/EN RTL)
   │  JWT
   ▼
FastAPI (app/main.py) ── routers/ ── repositories ── PostgreSQL (source of truth)
   │                                    ├─────────── MongoDB (sessions, statements, evidence text)
   │                                    ├─────────── Elasticsearch (search, MLT)
   │                                    └─────────── Neo4j (relationship graph)
   │ dispatch()  ──queue──► Redis ──► Celery worker (app/worker.py, app/tasks.py)
   │     └── worker down? run the same job in a thread inside the API
   ├── app/ai/ ── task models on CPU (embeddings, classifier, summaries, grounding)
   │         └── Ollama (qwen2.5 1.5B) ─ streamed drafts, checked sentence by sentence
   ├── agents (app/agents/) ── intake, case intelligence, legal research → word/regex fallbacks
   ├── faster-whisper (app/stt/) ─ local speech-to-text
   └── Law Library (app/ingestion/law_library.py) ─ FAISS + Elasticsearch
```

## AI on this server (`app/ai/`)

No cloud AI and no API key. Each job uses the smallest model that does it well:

| Module | Job | Model | If it can't run |
|---|---|---|---|
| 1 Complaints | Category + department suggestion, with the closest earlier complaints as the reason | Nearest-neighbour over multilingual embeddings (`classifier.py`); learns from staff decisions (`category_confirmed`) | Bilingual keywords |
| 1 Complaints | Duplicate detection across Arabic/English rewordings | Embedding similarity + word overlap | Word overlap |
| 2 Case intelligence | Offence *mentions* with the sentence as evidence; laws/articles cited in the text | Embeddings vs a bilingual offence list (`offences.py`); patterns for citations | Citations only |
| 2 Case intelligence | Source comparison: same point, different figures | Sentence alignment by embeddings (`case_intelligence_agent.py`) | Entity check only |
| 2/3/8 | Key sentences of evidence, statements, case description | Extractive summary (`summarize.py`) -- quotes, never paraphrase | Word frequency |
| 5 Similar cases | Meaning + wording | Case vectors in Elasticsearch (`dense_vector`, kNN) + more-like-this | Word overlap |
| 6 Research | Key passages, then a short draft answer | Embeddings; qwen2.5:1.5b-instruct via Ollama, streamed | Articles + key passages |
| Brief | Case brief draft | Same writing model, from the quoted key facts | Quoted key facts |
| 8 Stand / 3 | Speech-to-text | faster-whisper base (int8) | Typed transcript |
| 3 | OCR | Tesseract (ara+eng) | -- |

**Drafts are checked, not trusted** (`drafting.py`, `grounding.py`): output
streams to the reader; a draft that drifts into another script is cut off;
a draft in the wrong language is withheld; markdown is stripped; every
sentence is matched against the sources, citations are computed from that
match (the model's own are ignored), unmatched sentences are marked, and a
draft that mostly doesn't match is withheld. Meaning-matching alone does not
notice a changed number, so any date, time or amount a sentence states must
also appear in the sources -- otherwise that sentence is marked unsupported
whatever its similarity (a 1.5B model rewrote "09:15 on 3 March" as "2:30 PM
on October 5" in testing). Case briefs aren't drafted from fewer than three
quoted sentences, because a small model fills an empty page with invention.

**Offence mentions need both meaning and wording**: plainly worded acts match
their offence at 0.59-0.73 while unrelated legal prose reaches 0.51, so a
mid-confidence match only counts when one of that offence's own words also
appears in the document. Before that rule, an ordinary unpaid-salary dispute
was tagged "bribery, embezzlement, forgery".

**Memory** (7.7 GB laptop, ~3.9 GB Docker VM) is the binding constraint, and
running out of it does not fail cleanly -- the host swaps, every container
slows down, file watchers die and the Docker engine itself can stop
responding. So:

- models load on first use and unload when idle (`slots.py`: 10 min; Ollama
  `keep_alive` 5 min);
- only the API process holds the embedding model; the worker borrows it
  through `POST /internal/embed` (token derived from `SECRET_KEY`) and loads
  its own copy only if the API is unreachable;
- `app/ai/memory.py` refuses to start a model when free memory is short, and
  the caller shows its non-AI answer instead. Measured costs on this stack:
  the embedding model ~380 MB, the writing model ~1050 MB (its weights are
  memory-mapped -- the API asks for `use_mmap`, because left alone the server
  sometimes loads them into unreclaimable memory instead, slowly);
- when the small model everything depends on needs room, the big optional
  writing model is unloaded to make it, never the other way round;
- the writing model runs one draft at a time; up to three wait, the rest get
  "busy" at once with the non-AI result;
- Elasticsearch and Neo4j are sized for a few thousand documents, not for
  throughput, because every 100 MB there is 100 MB the models can't have.

Admins see every model's state and the machine's free memory, and can load or
unload the writing model, under System status. The first draft after an idle
period pays a cold load (1-3 minutes on this hardware); later ones take
20-60 seconds, so "Load now" before a demo is worth it.

A script or one-off `docker compose exec` that needs embeddings should set
`EMBEDDINGS_URL=http://localhost:8005/api/v1/internal/embed` so it borrows the
API's model instead of loading a second copy -- `scripts/seed_demo.py` and
`tests/_env.py` already do. On a small machine, a stray second copy is enough
to exhaust Docker's VM.

## Data

| Store | Holds | Notes |
|---|---|---|
| PostgreSQL | users, cases, case_parties, people, hearings, complaints, evidence metadata, timeline, rulings, law_documents, research_notes, audit_log | Additive migrations run on every start (`app/db/migrations.py`) under an advisory lock, including syncing native enum types. |
| MongoDB | courtroom_sessions, statements (transcripts, live segments), evidence_text | Evidence text falls back to a Postgres column if Mongo is down. |
| Elasticsearch | `lexintel-{cases,complaints,people,evidence,statements,law}` | Standard + Arabic + English analyzers per text field. Rebuilt nightly and on demand (System status → Rebuild search index). |
| Neo4j | Person–INVOLVED_IN→Case, Case–CITED→LegalProvision, Complaint–OPENED_AS→Case | Additive; synced on writes and nightly. |
| FAISS | Law Library article vectors | `paraphrase-multilingual-MiniLM-L12-v2`, normalised; the index records its model signature and rebuilds itself if it changes. |
| Uploads volume | evidence files, recordings, law PDFs | Server-generated names; SHA-256 on the way in. |

## Background jobs (`app/tasks.py`)

| Job | Trigger |
|---|---|
| classify_complaint | every public complaint |
| process_evidence | every upload: text layer → OCR (eng+ara) / transcription → case intelligence → timeline + search |
| ingest_law_document | every Law Library upload: parse articles (EN/AR) → FAISS + Elasticsearch |
| finalize_statement | every stand recording: full-quality transcription → entities → timeline |
| rescore_priorities | nightly 02:00 (Asia/Dubai) |
| reindex_all | nightly 03:00, and from System status |
| retry_stuck_jobs | every 10 minutes |

Each job records failure on the record itself (status + reason), so the UI
shows "failed: …" with a retry button instead of spinning forever.

## API surface

`app/api/routes.py` aggregates the routers; every endpoint except login,
public complaint intake and public complaint tracking requires a staff token.
Role groups live in `app/api/deps.py`.

## Testing

`python -m tests.run_all` (inside the backend container) runs everything
against separate `lexintel_test` databases:

- `test_e2e_auth.py` — the security boundary through the real HTTP layer.
- `test_api_flows.py` -- every module end to end with Elasticsearch, Neo4j,
  Celery, the writing model and speech-to-text switched off (proves each
  fallback); the small meaning model stays on.
- `test_ai_models.py` -- the task models for real: classifier accuracy in both
  languages, duplicate and offence thresholds, summaries, the grounding check
  (including figures a model made up, in digits and in Arabic number words),
  the language gates, model slots and the drafting queue.
- `test_ai_live.py` -- drafting with the local writing model, streamed through
  the real API in English and Arabic. Slow on CPU, so opt in with
  `python -m tests.run_all --live-ai`.
- `test_messages.py` -- reads every `HTTPException` in the routers and fails
  if one is raised that has no Arabic wording in `app/core/messages.py`, plus
  the translation and `Accept-Language` behaviour itself.
- `test_postgres_repository.py`, `test_mongo_repository.py` — storage layers.
- `test_neo4j_repository.py` (query building) and `test_neo4j_live.py`
  (real Cypher against the running Neo4j).
- Parser/NER suites for UAE legislation text and Arabic entity extraction.

## Language and time

Two things the reader sees are decided centrally rather than at each call
site, because 100-odd call sites drift and one table does not:

- **Error wording** (`app/core/messages.py`). Errors are raised in English
  where they happen; the handler in `app/main.py` translates the outgoing
  `detail` using the `Accept-Language` the frontend sends with every request
  (`setApiLanguage` in `frontend/src/api/client.ts`, kept in step with the
  language switch by `lib/prefs.tsx`). Untranslated messages pass through in
  English rather than disappearing, and `tests/test_messages.py` fails if a
  new one is added without wording.
- **Dates and times** (`frontend/src/lib/format.ts`). Instants are stored in
  UTC and always rendered in `Asia/Dubai`, so hearing times read the same on
  every machine; "today" is `courtDay()`, not the browser's day. Values that
  are calendar dates with no time (deadlines, the day a law came into force)
  are shown as written, because shifting them by the court's offset would
  move them to the neighbouring day. Arabic uses full month and weekday names
  -- date-fns abbreviates Arabic by truncating with a kashida, which reads as
  a broken word.

## Known limits / next steps

1. **Law corpus**: needs official PDFs uploaded by staff (automated sources
   block bots). A sanctioned data feed from the General Secretariat of the
   Cabinet / Ministry of Justice would allow scheduled ingestion.
2. **Face verification** stays a consented 1:1 plug-in point
   (`compute_face_embedding`); identity is confirmed by the clerk. Needs
   legal/data-protection review before any biometric use.
3. **Arabic NER** uses a gazetteer + format patterns; a CAMeL/AraBERT model
   would add Arabic person/organisation names (needs RAM budget).
4. **Notifications** to citizens (SMS/email) need a provider; tracking is
   self-service today.
5. **Production hardening**: HTTPS, a managed secret for `SECRET_KEY`,
   backups for the volumes, and running the frontend as a static build.
