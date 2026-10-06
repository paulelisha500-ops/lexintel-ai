/**
 * Background jobs (port of app/tasks.py), run one at a time: evidence OCR + case
 * intelligence, complaint triage, statement transcription/summaries and Law Library
 * ingestion. Anything left queued when the page closed is picked up again on the next start.
 *
 * With several tabs open, only one of them (the leader, chosen with the Web Locks API)
 * runs jobs; the others just record the work as queued, and the leader picks it up when
 * their save arrives. Every job re-reads its record after each long step, so a newer copy
 * of the database loaded meanwhile is never overwritten with a stale one.
 */
import { extractiveSummary, offenceMentions } from "./ai/analysis";
import { AUDIO_VIDEO_EXTENSIONS, extensionOf, extractText } from "./ai/documents";
import { runCaseIntelligence } from "./ai/intelligence";
import { parseArticles } from "./ai/law";
import { transcribe } from "./ai/models";
import { isArabic, repeatsItself } from "./ai/text";
import { triageComplaint } from "./ai/triage";
import { nowISO, uuid } from "./core";
import { db, files, onExternalChange, save } from "./store";

type Job = ["process_evidence" | "classify_complaint" | "finalize_statement" | "summarize_statement" | "ingest_law_document", string];

const LOOP_WARNING = "Part of this transcript repeats itself word for word, which usually means the speech model lost its place (often over silence or noise). Check it against the recording.";

const queue: Job[] = [];
let running = false;
let current: string | null = null;
let leader = false;

const keyOf = (name: string, id: string) => `${name}:${id}`;

export function dispatch(name: Job[0], id: string): "inline" | "queued" {
  if (!leader) return "queued"; // the leading tab picks it up when this tab's save arrives
  if (current !== keyOf(name, id) && !queue.some(([n, i]) => n === name && i === id)) queue.push([name, id]);
  void pump();
  return "inline";
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const [name, id] = queue.shift()!;
      current = keyOf(name, id);
      try {
        await RUNNERS[name](id);
      } catch (e) {
        console.error(`job ${name} failed`, e);
      } finally {
        current = null;
      }
    }
  } finally {
    running = false;
  }
}

/** Become the tab that runs jobs (immediately if this is the only tab, or when the leader closes). */
export function startJobRunner(): void {
  const lead = () => { leader = true; resumePendingJobs(); };
  const locks = (navigator as any).locks;
  if (locks?.request) locks.request("lexintel-jobs", () => { lead(); return new Promise(() => undefined); });
  else lead();
  onExternalChange(() => { if (leader) resumePendingJobs(); });
}

/** Requeue work that was interrupted (retry_stuck_jobs). */
export function resumePendingJobs(): void {
  if (!leader) return;
  const d = db();
  const busy = (name: string, id: string) => current === keyOf(name, id) || queue.some(([n, i]) => n === name && i === id);
  const requeue = (name: Job[0], id: string, reset: () => void) => { if (!busy(name, id)) { reset(); dispatch(name, id); } };
  for (const e of d.evidence) if (["queued", "processing"].includes(e.processing_status)) requeue("process_evidence", e.id, () => { e.processing_status = "queued"; });
  for (const c of d.complaints) if (c.ai_status === "pending") requeue("classify_complaint", c.id, () => undefined);
  for (const l of d.laws) if (["queued", "processing"].includes(l.status)) requeue("ingest_law_document", l.id, () => { l.status = "queued"; });
  for (const s of d.statements) if (["queued", "processing"].includes(s.transcript_status)) requeue("finalize_statement", s.id, () => { s.transcript_status = "queued"; });
}

const RUNNERS: Record<Job[0], (id: string) => Promise<void>> = {
  async process_evidence(id) {
    const row = db().evidence.find((e) => e.id === id);
    if (!row || row.processing_status === "done") return;
    row.processing_status = "processing";
    row.processing_error = null;
    save();
    const warnings: string[] = [];
    try {
      const blob = await files.get(row.file_id);
      if (!blob) throw new Error("The stored file is missing.");
      let text = "", pages: string[] = [], confidence: number | null = null, pageCount: number | null = null, method = "none";
      if (AUDIO_VIDEO_EXTENSIONS.has(extensionOf(row.original_filename)) || /^(audio|video)\//.test(row.content_type)) {
        try {
          text = (await transcribe(blob)).text;
          method = "speech_to_text";
          if (repeatsItself(text)) warnings.push(LOOP_WARNING);
        } catch (e) {
          warnings.push(`Speech-to-text could not run (${(e as Error).message}); the recording was stored without a transcript.`);
        }
      } else {
        const extracted = await extractText(blob, row.original_filename);
        ({ text, pages } = extracted);
        confidence = extracted.mean_confidence;
        pageCount = extracted.page_count;
        method = extracted.method;
        warnings.push(...extracted.warnings);
      }
      let intelligence = { entities: [] as any[], charges_mentioned: [] as string[], offence_mentions: [] as any[], legal_references: [] as any[], timeline_events: [] as any[], warnings: [] as string[] };
      let aiSummary = null;
      if (text.trim()) {
        intelligence = await runCaseIntelligence(row.case_id, text);
        warnings.push(...intelligence.warnings);
        aiSummary = { summary: await extractiveSummary(text, 5), offence_mentions: intelligence.offence_mentions,
                      legal_references: intelligence.legal_references.slice(0, 20) };
      }
      const current = db().evidence.find((e) => e.id === id);
      if (!current) return;
      Object.assign(current, {
        processing_status: "done", processed_at: nowISO(), processing_error: warnings.join("; ").slice(0, 2000) || null,
        ocr_confidence: confidence, ocr_language: text.trim() ? (isArabic(text) ? "ar" : "en") : null, page_count: pageCount,
        text_length: text.length, entity_count: intelligence.entities.length, ai_summary: aiSummary,
        text, entities: intelligence.entities, charges: intelligence.charges_mentioned, meta: { method, warnings, pages: pages.length },
      });
      const kase = db().cases.find((c) => c.id === current.case_id);
      if (kase) {
        for (const ev of intelligence.timeline_events.slice(0, 60)) {
          kase.timeline.push({ id: uuid(), case_id: kase.id, event_date: ev.event_date, description: ev.description.slice(0, 1000),
                               source_document_id: id, source_label: current.label, entity_type: "event", created_at: nowISO() });
        }
      }
      save();
    } catch (e) {
      const current = db().evidence.find((x) => x.id === id);
      if (current) Object.assign(current, { processing_status: "failed", processing_error: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 2000) });
      save();
    }
  },

  async classify_complaint(id) {
    const complaint = db().complaints.find((c) => c.id === id);
    if (!complaint) return;
    try {
      const others = db().complaints.filter((c) => c.id !== id).slice(-300)
        .map((c) => ({ id: c.id, text: c.description, reference_number: c.reference_number }));
      const learned = db().complaints.filter((c) => c.category_confirmed && c.id !== id).slice(-400)
        .map((c) => [c.description, c.case_type] as [string, string]);
      const result = await triageComplaint({ id, text: complaint.description, citizenCategory: complaint.case_type,
                                             submittedOn: complaint.submitted_at.slice(0, 10), others, learned });
      const current = db().complaints.find((c) => c.id === id);
      if (current) Object.assign(current, result);
    } catch (e) {
      const current = db().complaints.find((c) => c.id === id);
      if (current) Object.assign(current, { ai_status: "failed", ai_explanation: `Automatic triage failed: ${(e as Error).name}. A clerk should classify it manually.` });
    }
    save();
  },

  async finalize_statement(id) {
    const find = () => db().statements.find((s) => s.id === id);
    const first = find();
    if (!first) return;
    let transcript = first.transcript ?? "";
    if (first.recording_file_id) {
      first.transcript_status = "processing";
      save();
      let recordingText = "";
      let failed = false;
      try {
        const blob = await files.get(first.recording_file_id);
        if (blob) recordingText = (await transcribe(blob, first.transcript_language)).text.trim();
      } catch (e) {
        console.warn("final transcription failed", e);
        failed = true;
      }
      const st = find();
      if (!st) return;
      if (recordingText) {
        // A dialogue keeps who said what, and a clerk's correction stands; in both cases the
        // recording's own transcription is stored beside the transcript instead of replacing it.
        // A transcription stuck in a loop never replaces a live transcript either.
        if ((st.speakers?.length ?? 0) > 1 || st.transcript_source === "edited" || (st.transcript && repeatsItself(recordingText))) st.recording_transcript = recordingText;
        else Object.assign(st, { transcript: recordingText, transcript_source: "final" });
      }
      transcript = st.transcript ?? "";
      st.transcript_status = transcript ? "done" : failed ? "failed" : "none";
      save();
    } else {
      first.transcript_status = transcript ? "done" : "none";
      save();
    }
    if (transcript) {
      const summary = await extractiveSummary(transcript, 4, 1000);
      const intelligence = await runCaseIntelligence(first.case_id ?? "", transcript);
      const st = find();
      if (!st) return;
      Object.assign(st, { summary, extracted_entities: intelligence.entities, offence_mentions: intelligence.offence_mentions });
      save();
    }
  },

  async summarize_statement(id) {
    const text = db().statements.find((s) => s.id === id)?.transcript;
    if (!text) return;
    const summary = await extractiveSummary(text, 4, 1000);
    const mentions = (await offenceMentions(text)).mentions;
    const st = db().statements.find((s) => s.id === id);
    if (st) Object.assign(st, { summary, offence_mentions: mentions });
    save();
  },

  async ingest_law_document(id) {
    const find = () => db().laws.find((l) => l.id === id);
    const first = find();
    if (!first || first.status === "indexed") return;
    Object.assign(first, { status: "processing", error: null });
    save();
    let result: Record<string, unknown>;
    try {
      const blob = await files.get(first.file_id);
      if (!blob) throw new Error("The stored file is missing.");
      const extracted = await extractText(blob, first.original_filename);
      if (extracted.text.trim().length < 50) throw new Error("No readable text was found in this file (it may be an image-only scan the OCR could not read).");
      const { articles, mode } = parseArticles(extracted.text);
      if (!articles.length) throw new Error("The text could not be split into articles or sections.");
      const notes = [...extracted.warnings];
      if (mode === "sections") notes.push("No 'Article (N)' / 'المادة (N)' markers were found, so the text was indexed as numbered sections.");
      const label = mode === "articles" ? "Art." : "Section";
      result = { status: "indexed", article_count: articles.length, parse_mode: mode, indexed_at: nowISO(), error: notes.join("; ") || null,
                 articles: articles.map((x) => ({ number: x.number, label: `${label} ${x.number}`, body: x.body })) };
    } catch (e) {
      result = { status: "failed", error: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 2000) };
    }
    const law = find();
    if (law) Object.assign(law, result);
    save();
  },
};
