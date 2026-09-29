/**
 * Courtroom stand -- one person at a time: open/resume a session for a
 * hearing, call a party (identity confirmed by the clerk), live transcript
 * from short audio chunks, step down, full recording re-transcribed.
 * Nothing here analyses expression, tone or affect.
 */
import { AUDIO_VIDEO_EXTENSIONS, extensionOf, sha256Hex } from "../ai/documents";
import { modelState, ModelUnavailable, transcribe, warm } from "../ai/models";
import { audit, COURTROOM_STAFF, HttpError, nowISO, requireRole, STAFF, uuid } from "../core";
import { dispatch } from "../jobs";
import { oneOf, Raw, route, str } from "../router";
import { db, files, save, type SessionRow, type StatementRow } from "../store";
import { HEARING_ROLES, statementView } from "../views";
import { uploadedFile } from "./evidence";
import { addParty, createPersonFrom } from "./scheduling";

export function sttStatus() {
  const s = modelState("speech");
  return { name: "speech_to_text", available: !s.error, loaded: s.loaded, model: "Whisper base", error: s.error };
}

function sessionView(session: SessionRow) {
  let statements = db().statements.filter((s) => s.hearing_id === session.hearing_id).sort((a, b) => a.sequence_number - b.sequence_number);
  const own = statements.filter((s) => s.session_id === null || s.session_id === session.id);
  if (own.length) statements = own;
  const active = statements.find((s) => s.id === session.active_statement_id);
  return {
    session,
    active_statement: active ? statementView(active) : null,
    statements: statements.filter((s) => s.id !== session.active_statement_id).map(statementView),
    stt: sttStatus(),
  };
}

const sessionOr404 = (id: string) => {
  const s = db().sessions.find((x) => x.id === id);
  if (!s) throw new HttpError(404, "Session not found.");
  return s;
};
const statementOr404 = (id: string) => {
  const s = db().statements.find((x) => x.id === id);
  if (!s) throw new HttpError(404, "Statement not found.");
  return s;
};

route("POST", "/courtroom/hearings/{hearing_id}/session", (req) => {
  const user = requireRole(req.user(), COURTROOM_STAFF);
  const hearing = db().hearings.find((h) => h.id === req.params.hearing_id);
  if (!hearing) throw new HttpError(404, "Hearing not found.");
  if (hearing.status === "cancelled") throw new HttpError(409, "This hearing was cancelled.");
  let session = db().sessions.filter((s) => s.hearing_id === hearing.id && !s.session_closed_at)
    .sort((a, b) => b.session_started_at.localeCompare(a.session_started_at))[0];
  if (!session) {
    session = { id: uuid(), hearing_id: hearing.id, case_id: hearing.case_id, camera_device_id: "stand-cam-01", active_statement_id: null,
                statements: [], opened_by: user.id, session_started_at: nowISO(), session_closed_at: null };
    db().sessions.push(session);
    Object.assign(hearing, { status: "in_progress", updated_at: nowISO() });
    const kase = db().cases.find((c) => c.id === hearing.case_id);
    if (kase && ["intake", "under_investigation", "ready_for_hearing"].includes(kase.status)) Object.assign(kase, { status: "in_hearing", updated_at: nowISO() });
    save();
    audit(user, "courtroom.session_opened", "case", hearing.case_id, { hearing_id: hearing.id, session_id: session.id });
  }
  warm("speech").catch(() => undefined); // be ready by the time someone speaks
  return sessionView(session);
});

route("GET", "/courtroom/sessions/{session_id}", (req) => {
  requireRole(req.user(), STAFF);
  return sessionView(sessionOr404(req.params.session_id));
});

route("POST", "/courtroom/sessions/{session_id}/call-to-stand", async (req) => {
  const user = requireRole(req.user(), COURTROOM_STAFF);
  const session = sessionOr404(req.params.session_id);
  if (session.session_closed_at) throw new HttpError(409, "This session has been closed.");
  if (session.active_statement_id) {
    const active = db().statements.find((s) => s.id === session.active_statement_id);
    throw new HttpError(409, `${active?.person_name ?? "Someone"} is still at the stand. Step them down first.`);
  }
  const role = oneOf(req.body.role, HEARING_ROLES, "role")!;
  let person;
  if (req.body.person_id) {
    person = db().people.find((p) => p.id === req.body.person_id);
    if (!person) throw new HttpError(404, "Person not found.");
  } else if (req.body.new_person) {
    person = await createPersonFrom(req.body.new_person, role);
  } else {
    throw new HttpError(422, "Choose a party or enter the person's details.");
  }
  const caseId = session.case_id ?? db().hearings.find((h) => h.id === session.hearing_id)?.case_id ?? null;
  if (caseId) addParty(caseId, person.id, role);
  const sequence = db().statements.filter((s) => s.hearing_id === session.hearing_id).length + 1;
  const statement: StatementRow = {
    id: uuid(), hearing_id: session.hearing_id, case_id: caseId, session_id: session.id, person_id: person.id, person_name: person.full_name,
    role, identity_verification: "manual_confirm", started_at: nowISO(), ended_at: null, recording_file_id: null,
    recording_content_type: null, recording_size_bytes: null, recording_sha256: null, transcript: null, transcript_confidence: null,
    transcript_source: null, transcript_status: "live", transcript_language: null, live_segments: [], extracted_entities: [],
    summary: null, offence_mentions: [], sequence_number: sequence,
  };
  db().statements.push(statement);
  session.active_statement_id = statement.id;
  save();
  audit(user, "courtroom.called_to_stand", "case", caseId, { person: person.full_name, role, statement_id: statement.id });
  return sessionView(session);
});

route("POST", "/courtroom/statements/{statement_id}/live-chunk", async (req) => {
  requireRole(req.user(), COURTROOM_STAFF);
  const statement = statementOr404(req.params.statement_id);
  const seq = parseInt(String(req.form?.get("seq") ?? ""), 10);
  if (Number.isNaN(seq) || seq < 0) throw new HttpError(422, "seq: Field required");
  if (statement.ended_at) return { seq, text: "", ignored: true };
  const audio = req.form?.get("audio");
  if (!(audio instanceof Blob) || !audio.size) throw new HttpError(422, "audio: Field required");
  const language = String(req.form?.get("language") ?? "") || null;
  let text = "";
  try {
    text = (await transcribe(audio, language, true)).text.trim();
  } catch (e) {
    return { seq, text: "", stt_available: !(e instanceof ModelUnavailable) || !modelState("speech").error, error: (e as Error).name };
  }
  if (text) {
    const current = statementOr404(statement.id);
    current.live_segments.push({ seq, text, language, received_at: nowISO() });
    save();
  }
  return { seq, text, language, stt_available: true };
});

route("POST", "/courtroom/sessions/{session_id}/step-down", (req) => {
  const user = requireRole(req.user(), COURTROOM_STAFF);
  const session = sessionOr404(req.params.session_id);
  if (!session.active_statement_id) throw new HttpError(409, "No one is currently at the stand in this session.");
  const statement = db().statements.find((s) => s.id === session.active_statement_id);
  if (!statement) {
    session.active_statement_id = null;
    save();
    throw new HttpError(409, "The active statement record was missing; the stand has been cleared.");
  }
  const live = [...statement.live_segments].sort((a, b) => a.seq - b.seq).map((s) => s.text).join(" ").trim();
  statement.ended_at = nowISO();
  const edited = str(req.body, "transcript", { max: 500_000 })?.trim();
  if (edited && edited !== live) Object.assign(statement, { transcript: edited, transcript_source: "edited" });
  else if (live) Object.assign(statement, { transcript: live, transcript_source: "live" });
  statement.transcript_status = statement.transcript ? "done" : "none";
  session.statements.push(statement.id);
  session.active_statement_id = null;
  save();
  audit(user, "courtroom.stepped_down", "case", statement.case_id, {
    statement_id: statement.id, person: statement.person_name,
    duration_seconds: statement.started_at ? Math.round((Date.parse(statement.ended_at) - Date.parse(statement.started_at)) / 1000) : null,
  });
  if (statement.transcript) dispatch("summarize_statement", statement.id);
  return sessionView(session);
});

route("POST", "/courtroom/statements/{statement_id}/recording", async (req) => {
  const user = requireRole(req.user(), COURTROOM_STAFF);
  const statement = statementOr404(req.params.statement_id);
  const file = uploadedFile(req.form, "recording", 600, new Set([...AUDIO_VIDEO_EXTENSIONS]));
  const fileId = uuid();
  await files.put(fileId, file);
  const sha = await sha256Hex(file);
  Object.assign(statement, { recording_file_id: fileId, recording_content_type: file.type || `audio/${extensionOf(file.name)}`,
                             recording_size_bytes: file.size, recording_sha256: sha, transcript_status: "queued" });
  save();
  audit(user, "courtroom.recording_uploaded", "case", statement.case_id, { statement_id: statement.id, sha256: sha, size: file.size });
  return { statement_id: statement.id, size_bytes: file.size, sha256: sha, mode: dispatch("finalize_statement", statement.id) };
});

route("GET", "/courtroom/statements/{statement_id}", (req) => {
  requireRole(req.user(), STAFF);
  return statementView(statementOr404(req.params.statement_id));
});

route("GET", "/courtroom/statements/{statement_id}/recording", async (req) => {
  const user = requireRole(req.user(), STAFF);
  const statement = statementOr404(req.params.statement_id);
  const blob = statement.recording_file_id ? await files.get(statement.recording_file_id) : undefined;
  if (!blob) throw new HttpError(404, "No recording is stored for this statement.");
  audit(user, "courtroom.recording_viewed", "case", statement.case_id, { statement_id: statement.id });
  return new Raw(blob, statement.recording_content_type ?? "application/octet-stream", `statement-${statement.sequence_number}`);
});

route("PATCH", "/courtroom/statements/{statement_id}", (req) => {
  const user = requireRole(req.user(), COURTROOM_STAFF);
  const statement = statementOr404(req.params.statement_id);
  const transcript = str(req.body, "transcript", { required: true, max: 500_000 })!.trim();
  Object.assign(statement, { transcript, transcript_source: "edited", transcript_status: "done" });
  save();
  audit(user, "courtroom.transcript_edited", "case", statement.case_id, { statement_id: statement.id, length: transcript.length });
  if (transcript) dispatch("summarize_statement", statement.id);
  return statementView(statement);
});

route("POST", "/courtroom/sessions/{session_id}/close", (req) => {
  const user = requireRole(req.user(), COURTROOM_STAFF);
  const session = sessionOr404(req.params.session_id);
  if (session.active_statement_id) throw new HttpError(409, "Step the current person down before closing the session.");
  session.session_closed_at = nowISO();
  const hearing = db().hearings.find((h) => h.id === session.hearing_id);
  if (hearing) Object.assign(hearing, { status: "completed", updated_at: nowISO() });
  save();
  audit(user, "courtroom.session_closed", "case", session.case_id, { session_id: session.id, statements: session.statements.length });
  return sessionView(session);
});

route("GET", "/courtroom/stt-status", (req) => {
  requireRole(req.user(), STAFF);
  return sttStatus();
});
