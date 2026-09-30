# Introduction to LexIntel

LexIntel is a court case management and legal intelligence platform built for the United Arab Emirates. It gives courts, public prosecution and law firms a single bilingual workspace in which a matter can be followed from the first citizen complaint to the judge's ruling, with artificial intelligence that reads, organises, transcribes and cites — and leaves every decision to a person.

This document explains what LexIntel is for, the principles it is built on, and how a case moves through it. For installation and technical detail, see the [README](../README.md) and [Architecture](ARCHITECTURE.md).

## The problem it addresses

A single case produces a great deal of material: the original complaint, police and expert reports, contracts, scanned letters, photographs, recordings of statements, hearing schedules, and the legislation that applies. In most courts this material is spread across separate systems and paper files, in two languages. Staff spend much of their time finding, reading and re-typing information rather than acting on it, and deadlines, double-booked courtrooms and duplicate complaints are caught late or not at all.

LexIntel brings that material into one case file, reads it in Arabic and English, and surfaces what matters — the key facts, the dates, the laws cited, the related cases, the approaching deadlines — with a clear account of where each piece came from.

## Principles

**Humans decide.** LexIntel supports decisions; it does not make them. It never proposes a verdict, never predicts an outcome and never advises on strategy. Only an account with the judge role can enter a ruling, and the ruling is always attributed to that judge. This is enforced in the software's access control, not left to the interface.

**No judgement of people.** The platform does not score emotion, demeanour, credibility or "deception", and it has no data fields in which such scores could be stored. When two accounts of an event differ, it lists the differing facts side by side; it never says who is right.

**Every AI output explains itself.** Summaries are made of sentences quoted from the documents. Suggestions show their reasoning and confidence. Written drafts are checked sentence by sentence against their sources, and anything the check cannot match is visibly marked. A reader can always trace an output back to the text that produced it.

**Every AI feature has a fallback.** If a model is unavailable, the feature still works without it: research shows the relevant articles, briefs show the quoted facts, triage uses bilingual keywords, and transcripts can be typed by hand.

**Data stays local.** All AI models run on the court's own infrastructure — or, in the browser edition, on the user's own device. Nothing is sent to an outside AI service.

**Arabic and English as equals.** Every screen, message and AI feature works in both languages, with full right-to-left layout, on the official UAE Design System.

## Who uses it

| Role | Typical work in LexIntel |
|---|---|
| **Citizen** | Files a complaint online without an account and tracks its progress with a reference number and tracking code. |
| **Case officer** | Triages complaints, opens and builds case files, uploads and reviews evidence, maintains parties and the timeline. |
| **Court clerk** | Manages complaints and the hearing calendar, and runs the courtroom stand during hearings. |
| **Prosecutor** | Submits and reviews evidence, compares accounts, and researches the applicable law. |
| **Judge** | Reviews the case file and brief, conducts hearings at the stand, and is the only role that can enter a ruling. |
| **Administrator** | Manages staff accounts and roles, reviews the audit log, and monitors the system and its AI models. |

## How a case moves through LexIntel

**1. A complaint arrives.** A citizen describes what happened on the public portal, in Arabic or English, and receives a reference number and a private tracking code. Within moments, LexIntel suggests a category, the responsible department, a priority and any earlier complaints that look like the same incident. Each suggestion states its reasoning. A case officer confirms or corrects it, and the classifier learns from that decision.

**2. A case is opened.** With one action, the complaint becomes a case file with a case number, the complainant recorded as a party, and a priority recommendation that shows exactly which factors produced it: public safety, a statutory deadline, a vulnerable victim, missing evidence, the age of the case.

**3. Evidence is gathered.** Documents, scans, photographs and recordings are uploaded to the case. Each file is fingerprinted on arrival, so its integrity can be checked at any time, and every view and download is written to the chain-of-custody log. Scans are read with Arabic and English OCR, recordings are transcribed, and LexIntel extracts dates, amounts, names and places, adds dated events to the case timeline, notes which offence topics the document discusses, and lists any laws it cites. Scanned documents can be checked for a signature and compared with a reference signature.

**4. The file is understood.** The case brief brings the file together on one page: the key sentences of each document, quoted; the dated events; the topics discussed; the laws cited. On request, a small local model writes a short narrative brief, which is checked against those quoted facts before it is shown. Two documents or statements can be compared to list the facts on which they differ. LexIntel also shows similar cases and people who appear in other cases.

**5. The law is researched.** A question put to legal research is answered only from the Law Library — the official legislation the court has uploaded. LexIntel finds the relevant articles by meaning and by keyword, removes anything not in force on the chosen date, quotes the passages that answer the question, and optionally drafts a short explanation whose every sentence is checked against the cited articles. Useful results can be saved to the case.

**6. Hearings are scheduled.** The court calendar places hearings by courtroom and judge and catches double bookings before they happen.

**7. The hearing is held.** At the courtroom stand, the clerk calls one person at a time and confirms their identity. Their statement is recorded, and a live transcript appears as they speak. When the judge asks a question or counsel intervenes, the clerk marks who is speaking, so the transcript is saved as a dialogue in which every line carries its speaker and time. When the person steps down, the full recording is transcribed again at full quality, summarised by quotation, and added to the case file, where it can be reviewed and corrected.

**8. The judge rules.** The judge reviews the complete file and enters the ruling, noting any research that informed it. The case is closed, and the whole history — who did what, and when — remains in the audit log.

## Editions

LexIntel runs in two ways from the same codebase and the same user interface.

- **Server edition.** A court or firm runs the full platform on its own infrastructure with Docker: a FastAPI backend with PostgreSQL, MongoDB, Redis, Elasticsearch and Neo4j, and local AI models served on the same machines. This is the edition for shared, multi-user operation.
- **Browser edition.** The complete application — its API, its database and its AI models — runs inside a web browser, and is hosted as a set of static files on GitHub Pages and Hugging Face. There is nothing to install or operate, and each user's records stay on their own device. It suits evaluation, training and single-user work. Model-written drafts are available only in the server edition.

## Responsible use

LexIntel is a decision-support tool. Its outputs are aids to reading and research, and must be checked against the original documents and the official text of the law before they are relied upon. The sample law texts included for first use are clearly marked as sample text and are not official legislation. Before production use, a deployment should be reviewed against UAE Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data and the court's own data-protection and security requirements.

LexIntel is an independent platform. It is not an official UAE government service and does not replace licensed legal counsel.

## Glossary

| Term | Meaning in LexIntel |
|---|---|
| **Case brief** | A one-page view of a case file built from quoted sentences, dated events, discussed topics and cited laws, with an optional checked narrative draft. |
| **Chain of custody** | The record of every upload, view, download and integrity check of an item of evidence. |
| **Grounding check** | The verification that every sentence of an AI-written draft matches a sentence in its sources; unmatched sentences and figures are marked. |
| **Key passages** | The sentences from the cited law articles that best answer a research question, quoted exactly. |
| **Law Library** | The collection of legislation uploaded by the court, parsed into individual articles, from which legal research answers. |
| **Offence mention** | A topic (for example theft or fraud) that a document discusses, shown with the sentence that mentions it. It is not a charge. |
| **Priority recommendation** | A transparent workload score built from factual signals, shown factor by factor. It says nothing about the merits of a case. |
| **Stand** | The courtroom station at which one person at a time gives a recorded, transcribed statement. |
