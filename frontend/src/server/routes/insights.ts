/** Analytics, global search, and the admin system/audit screens. */
import { ocrState } from "../ai/documents";
import { describeWriter, modelState, unload, warm, writerQueueLength } from "../ai/models";
import { SEED_EXAMPLES } from "../ai/data";
import { HttpError, requireRole, STAFF } from "../core";
import { resumePendingJobs } from "../jobs";
import { route } from "../router";
import { db } from "../store";
import { ilike, OPEN_STATUSES } from "../views";
import { sttStatus } from "./courtroom";
import { DRAFTS_ENABLED } from "../../api/client";

const UAE = 4 * 3600_000;
const uaeDay = (iso: string) => new Date(Date.parse(iso) + UAE).toISOString().slice(0, 10);
const count = <T,>(items: T[], key: (t: T) => string | null | undefined) =>
  items.reduce<Record<string, number>>((acc, t) => { const k = key(t) ?? "unscored"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

route("GET", "/analytics/overview", (req) => {
  requireRole(req.user(), STAFF);
  const d = db();
  const now = Date.now();
  const today = uaeDay(new Date(now).toISOString());
  const todayStart = Date.parse(`${today}T00:00:00+04:00`);
  const open = d.cases.filter((c) => OPEN_STATUSES.has(c.status));
  const days = (date: string) => Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  const weekday = (new Date(todayStart + UAE).getUTCDay() + 6) % 7; // Monday = 0
  const weeks = Array.from({ length: 12 }, (_, k) => {
    const i = 11 - k;
    const start = todayStart - (weekday + 7 * i) * 86_400_000;
    const end = start + 7 * 86_400_000;
    return { week_start: uaeDay(new Date(start).toISOString()),
             cases_opened: d.cases.filter((c) => Date.parse(c.created_at) >= start && Date.parse(c.created_at) < end).length };
  });
  const perDay = Array.from({ length: 30 }, (_, k) => {
    const date = uaeDay(new Date(now - (29 - k) * 86_400_000).toISOString());
    return { date, complaints: d.complaints.filter((c) => uaeDay(c.submitted_at) === date).length };
  });
  const rulingDays = d.rulings.map((r) => {
    const c = d.cases.find((x) => x.id === r.case_id);
    return c ? Math.max(0, (Date.parse(r.entered_at) - Date.parse(c.created_at)) / 86_400_000) : null;
  }).filter((x): x is number => x !== null);
  const byStatus = count(d.complaints, (c) => c.status);
  const evidenceProcessing = count(d.evidence, (e) => e.processing_status);
  const evidenceReview = count(d.evidence, (e) => e.review_status);
  return {
    generated_at: new Date(now).toISOString(),
    cases: {
      total: d.cases.length, open: open.length, by_status: count(d.cases, (c) => c.status), by_type: count(d.cases, (c) => c.case_type),
      open_by_priority: count(open, (c) => c.priority?.level), needs_review: open.filter((c) => c.priority?.requires_human_review).length,
      deadlines_next_14_days: open.filter((c) => c.statutory_deadline && days(c.statutory_deadline) >= 0 && days(c.statutory_deadline) <= 14).length,
      overdue_deadlines: open.filter((c) => c.statutory_deadline && c.statutory_deadline < today).length, opened_per_week: weeks,
    },
    hearings: {
      today: d.hearings.filter((h) => uaeDay(h.scheduled_at) === today && h.status !== "cancelled").length,
      next_7_days: d.hearings.filter((h) => Date.parse(h.scheduled_at) >= todayStart && Date.parse(h.scheduled_at) < todayStart + 7 * 86_400_000
                                        && ["scheduled", "in_progress"].includes(h.status)).length,
    },
    complaints: {
      total: d.complaints.length, by_status: byStatus, by_category: count(d.complaints, (c) => c.ai_suggested_category ?? c.case_type),
      awaiting_triage: byStatus.received ?? 0, ai_status: count(d.complaints, (c) => c.ai_status), per_day_30: perDay,
    },
    evidence: { total: d.evidence.length, pending_review: evidenceReview.pending_review ?? 0, flagged: evidenceReview.flagged ?? 0,
                processing: (evidenceProcessing.queued ?? 0) + (evidenceProcessing.processing ?? 0), failed: evidenceProcessing.failed ?? 0 },
    rulings: { total: d.rulings.length, avg_days_to_ruling: rulingDays.length ? Math.round((rulingDays.reduce((a, b) => a + b, 0) / rulingDays.length) * 10) / 10 : null },
    statements: { total: d.statements.length },
    unavailable: [],
  };
});

route("GET", "/search", (req) => {
  const user = requireRole(req.user(), STAFF);
  const q = (req.query.get("q") ?? "").trim();
  if (q.length < 2) throw new HttpError(422, "q: String should have at least 2 characters");
  const d = db();
  const snippet = (text: string | null | undefined) => {
    const t = text ?? "";
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? t.slice(0, 160) : (i > 60 ? "…" : "") + t.slice(Math.max(0, i - 60), i + 100);
  };
  const results: Record<string, any[]> = {
    cases: d.cases.filter((c) => ilike(c.title, q) || ilike(c.case_number, q) || ilike(c.description, q)).slice(0, 6)
      .map((c) => ({ id: c.id, title: c.title, subtitle: c.case_number, snippet: snippet(c.description), case_id: c.id })),
    people: d.people.filter((p) => ilike(p.full_name, q)).slice(0, 6).map((p) => ({ id: p.id, title: p.full_name, subtitle: p.role_in_case ?? "", snippet: "" })),
    evidence: d.evidence.filter((e) => ilike(e.text, q) || ilike(e.label, q)).slice(0, 6)
      .map((e) => ({ id: e.id, title: e.label, subtitle: d.cases.find((c) => c.id === e.case_id)?.case_number ?? "", snippet: snippet(e.text), case_id: e.case_id })),
    statements: d.statements.filter((s) => ilike(s.transcript, q) || ilike(s.person_name, q)).slice(0, 6)
      .map((s) => ({ id: s.id, title: s.person_name ?? "Statement", subtitle: s.role, snippet: snippet(s.transcript), case_id: s.case_id })),
    law: d.laws.flatMap((l) => l.articles.filter((a) => ilike(a.body, q) || ilike(l.title, q)).map((a) => ({ l, a }))).slice(0, 6)
      .map(({ l, a }) => ({ id: `${l.id}:${a.number}`, title: l.title, subtitle: a.label, snippet: snippet(a.body), law_document_id: l.id })),
  };
  if (["case_officer", "clerk", "admin"].includes(user.role)) {
    results.complaints = d.complaints.filter((c) => ilike(c.description, q) || ilike(c.reference_number, q) || ilike(c.complainant_name, q)).slice(0, 6)
      .map((c) => ({ id: c.id, title: c.reference_number, subtitle: c.status, snippet: snippet(c.description) }));
  }
  return { query: q, source: "fallback", results };
});

async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e?.quota) return null;
    return { path: "IndexedDB", free_gb: Math.round(((e.quota - (e.usage ?? 0)) / 1e9) * 10) / 10, total_gb: Math.round((e.quota / 1e9) * 10) / 10 };
  } catch {
    return null;
  }
}

route("GET", "/admin/system", async (req) => {
  requireRole(req.user(), ["admin"]);
  const emb = modelState("embeddings"), writer = modelState("writer"), speech = modelState("speech");
  const articles = db().laws.filter((l) => l.status === "indexed").reduce((a, l) => a + (l.article_count ?? 0), 0);
  const slot = (s: ReturnType<typeof modelState>, unloadAfter: number | null) => ({
    available: !s.error, loaded: s.loaded, loading: s.loading, progress: s.progress, in_use: s.inUse > 0, error: s.error,
    idle_seconds: s.loaded && s.lastUsed ? Math.round((Date.now() - s.lastUsed) / 1000) : null,
    unloads_after_seconds: unloadAfter ?? undefined, load_seconds: s.loadSeconds,
  });
  return {
    services: [
      { name: "database", available: true, latency_ms: 0, error: null, detail: "IndexedDB" },
      { name: "background_jobs", available: true, error: null, detail: "Web Worker" },
      ...(!DRAFTS_ENABLED ? [] : [{ name: "llm", available: !writer.error, error: writer.error, loaded: writer.loaded, model: writer.name, detail: describeWriter() }]),
      sttStatus(),
    ],
    ai_models: [
      { key: "embeddings", name: "paraphrase-multilingual-MiniLM-L12-v2", runtime: "ONNX Runtime Web · WebAssembly", ...slot(emb, null) },
      { key: "classifier", name: "Nearest-neighbour complaint classifier", runtime: "uses the embeddings model", available: !emb.error, loaded: emb.loaded, loading: emb.loading,
        examples: Object.values(SEED_EXAMPLES).reduce((a, v) => a + v.length, 0), learned_examples: db().complaints.filter((c) => c.category_confirmed).length },
      ...(!DRAFTS_ENABLED ? [] : [{ key: "writer" as const, name: "Qwen2.5 0.5B Instruct", runtime: "ONNX Runtime Web · WebAssembly", ...slot(writer, 600), queue: writerQueueLength() }]),
      { key: "speech_to_text", name: "Whisper base", runtime: "ONNX Runtime Web · WebAssembly", ...slot(speech, 600) },
      { key: "ocr", name: "Tesseract (Arabic + English)", runtime: "tesseract.js · WebAssembly", available: !ocrState.error, loaded: ocrState.loaded ? true : null, error: ocrState.error },
    ],
    memory: { free_mb: null, writing_model_needs_mb: 550, embeddings_need_mb: 130, writing_model_loaded: writer.loaded, can_start_writing_model: true },
    storage: await storageEstimate(),
    corpus: { indexed_articles: articles, faiss_index_present: articles > 0, search_index_articles: articles },
    fallbacks: {
      llm: "Research shows the in-force articles and key passages without a written draft; case briefs show the quoted key facts.",
      speech_to_text: "Clerks type or correct the statement transcript by hand.",
    },
  };
});

route("POST", "/admin/ai/writer/{action}", async (req) => {
  requireRole(req.user(), ["admin"]);
  const action = req.params.action;
  if (action !== "load" && action !== "unload") throw new HttpError(404, "Unknown action.");
  try {
    if (action === "load") await warm("writer");
    else await unload("writer");
  } catch (e) {
    throw new HttpError(503, `The writing model could not be ${action}ed: ${(e as Error).message}`);
  }
  return { status: action === "load" ? "loaded" : "unloaded", model: describeWriter() };
});

route("GET", "/admin/audit", (req) => {
  requireRole(req.user(), ["admin"]);
  const q = req.query;
  const action = q.get("action"), type = q.get("entity_type"), id = q.get("entity_id"), username = q.get("username");
  const rows = db().audit.filter((a) => (!action || a.action.toLowerCase().startsWith(action.toLowerCase())) && (!type || a.entity_type === type)
    && (!id || a.entity_id === id) && (!username || ilike(a.username, username))).sort((a, b) => b.id - a.id);
  const limit = Math.min(500, Math.max(1, parseInt(q.get("limit") ?? "", 10) || 50));
  const offset = Math.max(0, parseInt(q.get("offset") ?? "", 10) || 0);
  return { items: rows.slice(offset, offset + limit), total: rows.length };
});

route("POST", "/admin/reindex", (req) => {
  requireRole(req.user(), ["admin"]);
  resumePendingJobs();
  return { mode: "inline" };
});
