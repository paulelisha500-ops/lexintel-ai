---
title: LexIntel
emoji: ⚖️
colorFrom: yellow
colorTo: gray
sdk: static
pinned: true
license: other
short_description: UAE court case management & legal intelligence (AR/EN)
tags:
  - legal
  - uae
  - arabic
  - case-management
  - transformers.js
  - webgpu
---

# LexIntel

**Court case management and legal intelligence for the UAE — bilingual (Arabic / English), built on the UAE Design System.**

LexIntel brings citizen complaints, case files, evidence, hearings, the courtroom stand and cited legal research into one workspace for courts, prosecutors and lawyers. Humans decide: the platform never issues verdicts, never scores emotion or credibility, and only a judge can enter a ruling.

Source code: [github.com/paulelisha500-ops/lexintel-ai](https://github.com/paulelisha500-ops/lexintel-ai)

## How this Space runs

This Space runs the complete application inside your browser, with no server behind it:

- **The API** — every endpoint of the LexIntel backend runs in the page, with the same rules, roles, validation and audit log.
- **The database** — records and uploaded files are stored in your browser (IndexedDB). They stay on your device and survive reloads. Each browser has its own private copy.
- **The AI models** — run on your device through ONNX Runtime Web (WebGPU where available, WebAssembly otherwise). Model files download from the Hugging Face Hub on first use and are then cached. No text, document or recording is sent to an AI service.

| Model | Used for | Download |
|---|---|---|
| `paraphrase-multilingual-MiniLM-L12-v2` | Meaning-matching in Arabic and English: complaint triage, duplicates, similar cases, summaries, key passages, grounding checks | ~120 MB, at start |
| `Qwen2.5-0.5B-Instruct` | Short drafts of research answers and case briefs, checked sentence by sentence against the sources | ~480 MB (GPU) / ~510 MB (CPU), on first draft |
| `whisper-base` | Live and full transcripts at the courtroom stand; audio evidence | ~80 MB, when a session opens |
| Tesseract (Arabic + English) | OCR of scanned documents and PDFs | ~15 MB, on first scan |

## Signing in

A new browser starts with these staff accounts, all with the password **`LexIntel@2026`**. Change it under *Profile* after signing in.

| Username | Role |
|---|---|
| `admin` | System administrator — users, audit log, system status |
| `judge`, `judge2` | Judge — the only role that can enter a ruling |
| `clerk` | Court clerk — complaints, scheduling, courtroom stand |
| `officer` | Case officer — cases, evidence, triage |
| `prosecutor` | Prosecutor — evidence, research |

Citizens use the public pages without an account: *File a complaint* and *Track a complaint*.

The Law Library ships with three short sample law texts so research works immediately. They are marked as sample text and are **not official legislation** — upload the official texts from the UAE legislation portal for real research.

## Requirements

A current Chrome, Edge or Firefox on a desktop or laptop with at least 8 GB of memory. WebGPU (Chrome/Edge) makes drafting much faster. The courtroom stand needs microphone permission.
