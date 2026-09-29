/**
 * First-run setup: staff accounts, the initial case files with their
 * documents, hearings, citizen complaints and the Law Library texts.
 * Documents and complaints are queued for the same AI processing as
 * anything uploaded later.
 */
import { hashPassword, keyedHash, newTrackingCode, nowISO, uuid } from "./core";
import { parseArticles } from "./ai/law";
import { scoreCase } from "./ai/triage";
import { sha256Hex } from "./ai/documents";
import { SEED_CASES, SEED_COMPLAINTS, SEED_LAWS } from "./seedData";
import { files, SCHEMA_VERSION, type Database, type UserRow } from "./store";

export const INITIAL_PASSWORD = "LexIntel@2026";

export const ACCOUNTS: [string, string, string][] = [
  ["admin", "System Administrator", "admin"],
  ["judge", "Judge Mariam Al Nuaimi", "judge"],
  ["judge2", "Judge Khalid Al Suwaidi", "judge"],
  ["clerk", "Hessa Al Mazrouei, Court Clerk", "clerk"],
  ["officer", "Omar Haddad, Case Officer", "case_officer"],
  ["prosecutor", "Layla Farouk, Prosecutor", "prosecutor"],
];

const DAY = 86_400_000;

/** A UAE (UTC+4) wall-clock time `dayOffset` days from today, as an ISO instant. */
function uaeAt(dayOffset: number, hour: number, minute: number): string {
  const uaeNow = new Date(Date.now() + 4 * 3600_000);
  const d = new Date(Date.UTC(uaeNow.getUTCFullYear(), uaeNow.getUTCMonth(), uaeNow.getUTCDate() + dayOffset, hour - 4, minute));
  return d.toISOString();
}

function uaeDate(dayOffset: number): string {
  return new Date(Date.now() + 4 * 3600_000 + dayOffset * DAY).toISOString().slice(0, 10);
}

export async function buildInitialDatabase(): Promise<Database> {
  const now = nowISO();
  const db: Database = {
    version: SCHEMA_VERSION, users: [], people: [], cases: [], parties: [], evidence: [], hearings: [], complaints: [],
    rulings: [], notes: [], statements: [], sessions: [], laws: [], audit: [], tokens: [], counters: { audit: 0 }, rate: {},
    installed_at: now,
  };

  const { hash, salt } = await hashPassword(INITIAL_PASSWORD);
  for (const [username, full_name, role] of ACCOUNTS) {
    db.users.push({ id: uuid(), username, full_name, role, is_active: true, created_at: now, last_login_at: null,
                    password_hash: hash, password_salt: salt, password_changed_at: null } satisfies UserRow);
  }
  const user = (name: string) => db.users.find((u) => u.username === name)!;
  const judge = user("judge"), officer = user("officer"), clerk = user("clerk");

  for (const spec of SEED_CASES) {
    const opened = new Date(Date.now() - spec.opened_days_ago * DAY).toISOString();
    const deadline = spec.deadline_days != null ? uaeDate(spec.deadline_days) : null;
    const caseId = uuid();
    const signals = { ...spec.signals, case_id: caseId, case_opened_on: opened.slice(0, 10), statutory_deadline: deadline };
    db.cases.push({
      id: caseId, case_number: spec.number, case_type: spec.type, status: spec.status, title: spec.title,
      description: spec.description, statutory_deadline: deadline, created_at: opened, updated_at: null, closed_at: null,
      assigned_judge_id: judge.id, source_complaint_id: null, priority: scoreCase(signals), priority_signals: signals,
      timeline: spec.timeline.map(([d, text]) => ({
        id: uuid(), case_id: caseId, event_date: d, description: text, source_document_id: null,
        source_label: "Case intake", entity_type: "manual", created_at: opened,
      })),
    });
    for (const [name, role] of spec.parties) {
      const personId = uuid();
      db.people.push({ id: personId, full_name: name, emirates_id_hash: null, emirates_id_last4: null, role_in_case: role,
                       reference_photo_on_file: false, contact_phone: null, preferred_language: "ar", created_at: opened });
      db.parties.push({ case_id: caseId, person_id: personId, role, added_at: opened });
    }
    for (const [dayOffset, hour, minute, room, kind] of spec.hearings) {
      db.hearings.push({ id: uuid(), case_id: caseId, scheduled_at: uaeAt(dayOffset, hour, minute), duration_minutes: 60,
                         hearing_type: kind, courtroom: room, status: "scheduled", presiding_judge_id: judge.id, notes: null,
                         created_at: opened, updated_at: null });
    }
    for (const [label, filename, text] of spec.documents) {
      const blob = new Blob([text], { type: "text/plain" });
      const fileId = uuid();
      await files.put(fileId, blob);
      db.evidence.push({
        id: uuid(), case_id: caseId, label, evidence_type: "document", original_filename: filename, content_type: "text/plain",
        size_bytes: blob.size, sha256: await sha256Hex(blob), uploaded_by: officer.id, uploaded_at: opened,
        processing_status: "queued", processing_error: null, processed_at: null, ocr_confidence: null, ocr_language: null,
        page_count: null, text_length: null, entity_count: null, signature_check: null, ai_summary: null,
        review_status: "pending_review", review_note: null, reviewed_by: null, reviewed_at: null,
        file_id: fileId, text: null, entities: [], charges: [], meta: {},
      });
    }
  }

  let n = 0;
  for (const [caseType, description, location] of SEED_COMPLAINTS) {
    n++;
    const submitted = new Date(Date.now() - n * 2 * DAY).toISOString();
    db.complaints.push({
      id: uuid(), reference_number: `CMP-${new Date().getFullYear()}-${crypto.getRandomValues(new Uint8Array(3)).reduce((s, b) => s + b.toString(16).padStart(2, "0").toUpperCase(), "")}`,
      submitted_by: uuid(), case_type: caseType, description, location, complainant_name: null, complainant_phone: null,
      complainant_email: null, preferred_language: "en", status: "received", submitted_at: submitted, updated_at: null,
      ai_status: "pending", ai_suggested_category: null, ai_duplicate_of: null, ai_suggested_department: null,
      ai_confidence: null, ai_explanation: null, ai_priority_level: null, duplicate_candidates: null, ai_details: null,
      category_confirmed: false, assigned_department: null, staff_notes: null, case_id: null,
      tracking_code_hash: await keyedHash(newTrackingCode()),
    });
  }

  for (const spec of SEED_LAWS) {
    const blob = new Blob([spec.text], { type: "text/plain" });
    const fileId = uuid();
    await files.put(fileId, blob);
    const { articles, mode } = parseArticles(spec.text);
    const label = mode === "articles" ? "Art." : "Section";
    db.laws.push({
      id: uuid(), title: spec.title, law_number: spec.law_number, year: spec.year, jurisdiction: spec.jurisdiction,
      language: spec.language, effective_from: spec.effective_from, effective_to: null, legislation_state: "active",
      source_url: null, original_filename: spec.filename, sha256: await sha256Hex(blob), size_bytes: blob.size,
      status: "indexed", error: null, article_count: articles.length, parse_mode: mode, uploaded_by: clerk.id,
      uploaded_at: now, indexed_at: now, file_id: fileId,
      articles: articles.map((a) => ({ number: a.number, label: `${label} ${a.number}`, body: a.body })),
    });
  }
  return db;
}
