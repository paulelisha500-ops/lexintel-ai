/**
 * Persistent storage for the in-browser server: one IndexedDB database
 * holding the records (as a single JSON document, written back shortly
 * after every change) and the uploaded files (as Blobs). Other tabs of the
 * same browser are told about each write and reload, so two open tabs
 * don't overwrite each other.
 */

export interface UserRow {
  id: string; username: string; full_name: string; role: string; is_active: boolean;
  created_at: string; last_login_at: string | null;
  password_hash: string; password_salt: string; password_changed_at: string | null;
}
export interface PersonRow {
  id: string; full_name: string; emirates_id_hash: string | null; emirates_id_last4: string | null;
  role_in_case: string | null; reference_photo_on_file: boolean; contact_phone: string | null;
  preferred_language: string; created_at: string;
}
export interface TimelineRow {
  id: string; case_id: string; event_date: string | null; description: string; source_document_id: string | null;
  source_label: string | null; entity_type: string; created_at: string;
}
export interface CaseRow {
  id: string; case_number: string; case_type: string; status: string; title: string; description: string | null;
  timeline: TimelineRow[]; priority: any | null; priority_signals: Record<string, unknown> | null;
  assigned_judge_id: string | null; source_complaint_id: string | null; created_at: string; updated_at: string | null;
  closed_at: string | null; statutory_deadline: string | null;
}
export interface PartyRow { case_id: string; person_id: string; role: string; added_at: string }
export interface EvidenceRow {
  id: string; case_id: string; label: string; evidence_type: string; original_filename: string; content_type: string;
  size_bytes: number; sha256: string; uploaded_by: string; uploaded_at: string; processing_status: string;
  processing_error: string | null; processed_at: string | null; ocr_confidence: number | null; ocr_language: string | null;
  page_count: number | null; text_length: number | null; entity_count: number | null; signature_check: any | null;
  ai_summary: any | null; review_status: string; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null;
  file_id: string; text: string | null; entities: any[]; charges: string[]; meta: Record<string, unknown>;
}
export interface HearingRow {
  id: string; case_id: string; scheduled_at: string; duration_minutes: number; hearing_type: string | null;
  courtroom: string | null; status: string; presiding_judge_id: string | null; notes: string | null;
  created_at: string; updated_at: string | null;
}
export interface ComplaintRow {
  id: string; reference_number: string; submitted_by: string; case_type: string; description: string; location: string | null;
  complainant_name: string | null; complainant_phone: string | null; complainant_email: string | null;
  preferred_language: string | null; status: string; submitted_at: string; updated_at: string | null;
  ai_status: string; ai_suggested_category: string | null; ai_duplicate_of: string | null; ai_suggested_department: string | null;
  ai_confidence: number | null; ai_explanation: string | null; ai_priority_level: string | null;
  duplicate_candidates: any[] | null; ai_details: any | null; category_confirmed: boolean; assigned_department: string | null;
  staff_notes: string | null; case_id: string | null; tracking_code_hash: string;
}
export interface RulingRow { case_id: string; entered_by: string; ruling_text: string; entered_at: string; ai_assisted_research_refs: string[] }
export interface NoteRow {
  id: string; case_id: string | null; question: string; answer: string; citations: any[]; confidence: number;
  needs_human_review: boolean; created_by: string; created_at: string;
}
export interface StatementRow {
  id: string; hearing_id: string; case_id: string | null; session_id: string | null; person_id: string; person_name: string | null;
  role: string; identity_verification: string; started_at: string | null; ended_at: string | null;
  recording_file_id: string | null; recording_content_type: string | null; recording_size_bytes: number | null; recording_sha256: string | null;
  transcript: string | null; transcript_confidence: number | null; transcript_source: string | null; transcript_status: string;
  transcript_language: string | null; live_segments: { seq: number; text: string; language: string | null; received_at: string }[];
  extracted_entities: any[]; summary: any | null; offence_mentions: any[]; sequence_number: number;
}
export interface SessionRow {
  id: string; hearing_id: string; case_id: string | null; camera_device_id: string; active_statement_id: string | null;
  statements: string[]; opened_by: string | null; session_started_at: string; session_closed_at: string | null;
}
export interface ArticleRow { number: string; label: string; body: string }
export interface LawRow {
  id: string; title: string; law_number: string | null; year: number | null; jurisdiction: string; language: string;
  effective_from: string | null; effective_to: string | null; legislation_state: string; source_url: string | null;
  original_filename: string; sha256: string; size_bytes: number; status: string; error: string | null;
  article_count: number | null; parse_mode: string | null; uploaded_by: string; uploaded_at: string; indexed_at: string | null;
  file_id: string; articles: ArticleRow[];
}
export interface AuditRow {
  id: number; at: string; user_id: string | null; username: string | null; role: string | null; action: string;
  entity_type: string | null; entity_id: string | null; detail: Record<string, unknown> | null; ip: string | null;
}
export interface TokenRow { token: string; user_id: string; iat: number; exp: number }

export interface Database {
  version: number;
  users: UserRow[];
  people: PersonRow[];
  cases: CaseRow[];
  parties: PartyRow[];
  evidence: EvidenceRow[];
  hearings: HearingRow[];
  complaints: ComplaintRow[];
  rulings: RulingRow[];
  notes: NoteRow[];
  statements: StatementRow[];
  sessions: SessionRow[];
  laws: LawRow[];
  audit: AuditRow[];
  tokens: TokenRow[];
  counters: { audit: number };
  rate: Record<string, number[]>;
  installed_at: string;
}

export const SCHEMA_VERSION = 1;
const DB_NAME = "lexintel";
const STATE_KEY = "db";

const STORES = ["state", "files"];

function openIdb(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      const idb = req.result;
      for (const name of STORES) if (!idb.objectStoreNames.contains(name)) idb.createObjectStore(name);
    };
    req.onsuccess = () => {
      const idb = req.result;
      // A database left without its stores (e.g. an interrupted first run) is repaired by an upgrade.
      if (STORES.every((name) => idb.objectStoreNames.contains(name))) {
        idb.onversionchange = () => idb.close();
        resolve(idb);
        return;
      }
      const next = idb.version + 1;
      idb.close();
      openIdb(next).then(resolve, reject);
    };
    req.onerror = () => reject(req.error);
  });
}

let idbPromise: Promise<IDBDatabase> | null = null;
const idb = () => (idbPromise ??= openIdb());

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const files = {
  put: (id: string, blob: Blob) => tx("files", "readwrite", (s) => s.put(blob, id)).then(() => undefined),
  get: (id: string) => tx<Blob | undefined>("files", "readonly", (s) => s.get(id)),
  delete: (id: string) => tx("files", "readwrite", (s) => s.delete(id)).then(() => undefined),
};

let current: Database | null = null;
let saveTimer: number | null = null;
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("lexintel-db") : null;
const TAB_ID = crypto.randomUUID();

export async function loadDatabase(): Promise<Database | null> {
  const stored = await tx<Database | undefined>("state", "readonly", (s) => s.get(STATE_KEY));
  current = stored && stored.version === SCHEMA_VERSION ? stored : null;
  return current;
}

export function setDatabase(db: Database): void {
  current = db;
}

export function db(): Database {
  if (!current) throw new Error("The database is not open yet.");
  return current;
}

async function writeNow(): Promise<void> {
  if (saveTimer !== null) { window.clearTimeout(saveTimer); saveTimer = null; }
  if (!current) return;
  await tx("state", "readwrite", (s) => s.put(current, STATE_KEY));
  channel?.postMessage({ from: TAB_ID, kind: "saved" });
}

/** Persist soon (coalesces bursts of writes). */
export function save(): void {
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => { writeNow().catch((e) => console.error("could not save", e)); }, 150);
}

export const flush = writeNow;

window.addEventListener("pagehide", () => { writeNow().catch(() => undefined); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") writeNow().catch(() => undefined); });

const listeners = new Set<() => void>();
export function onExternalChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
channel?.addEventListener("message", (e) => {
  if (e.data?.from === TAB_ID || e.data?.kind !== "saved") return;
  loadDatabase().then(() => listeners.forEach((fn) => fn())).catch(() => undefined);
});

export async function resetDatabase(): Promise<void> {
  current = null;
  await tx("state", "readwrite", (s) => s.clear());
  await tx("files", "readwrite", (s) => s.clear());
}
