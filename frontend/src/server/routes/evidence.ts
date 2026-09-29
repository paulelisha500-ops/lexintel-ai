/** Evidence: upload (SHA-256 on the way in) -> background OCR/transcription -> case intelligence; chain of custody. */
import { AUDIO_VIDEO_EXTENSIONS, extensionOf, extractText, IMAGE_EXTENSIONS, sha256Hex, TEXT_EXTENSIONS, verifySignature } from "../ai/documents";
import { audit, EVIDENCE_SUBMITTERS, HttpError, isUuid, notFoundUnlessUuid, nowISO, requireRole, STAFF, uuid } from "../core";
import { dispatch } from "../jobs";
import { Raw, route, Status } from "../router";
import { db, files, save, type EvidenceRow } from "../store";
import { EVIDENCE_TYPES } from "../views";

const ALLOWED = new Set([...IMAGE_EXTENSIONS, ...TEXT_EXTENSIONS, ...AUDIO_VIDEO_EXTENSIONS, "pdf", "docx", "doc", "xlsx", "zip", "eml", "msg"]);
const MAX_DOCUMENT_MB = 25;
const MAX_RECORDING_MB = 600;

export function evidenceView(e: EvidenceRow) {
  const { file_id: _f, text: _t, entities: _e, charges: _c, meta: _m, ...rest } = e;
  return rest;
}

function evidenceOr404(id: string): EvidenceRow {
  const e = isUuid(id) ? db().evidence.find((x) => x.id === id) : undefined;
  if (!e) throw new HttpError(404, "Evidence not found.");
  return e;
}

export function uploadedFile(form: FormData | null, field: string, maxMb: number, allowed: Set<string>): File {
  const file = form?.get(field);
  if (!(file instanceof File) || !file.name) throw new HttpError(422, `${field}: Field required`);
  const ext = extensionOf(file.name);
  if (!allowed.has(ext)) throw new HttpError(422, `Files of type .${ext || "(none)"} are not accepted here.`);
  if (file.size > maxMb * 1024 * 1024) throw new HttpError(413, `The file is larger than ${maxMb} MB.`);
  if (file.size === 0) throw new HttpError(422, "The file is empty.");
  return file;
}

function guessType(ext: string, declared: string | null): string {
  if (declared) return declared;
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (["mp4", "mov", "mkv", "webm"].includes(ext)) return "video";
  if (AUDIO_VIDEO_EXTENSIONS.has(ext)) return "audio";
  return "document";
}

route("GET", "/cases/{case_id}/evidence", (req) => {
  requireRole(req.user(), STAFF);
  const cid = notFoundUnlessUuid(req.params.case_id, "Case");
  if (!db().cases.some((c) => c.id === cid)) throw new HttpError(404, "Case not found.");
  return db().evidence.filter((e) => e.case_id === cid).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).map(evidenceView);
});

route("POST", "/cases/{case_id}/evidence", async (req) => {
  const user = requireRole(req.user(), EVIDENCE_SUBMITTERS);
  const cid = notFoundUnlessUuid(req.params.case_id, "Case");
  if (!db().cases.some((c) => c.id === cid)) throw new HttpError(404, "Case not found.");
  const raw = req.form?.get("file");
  const isMedia = raw instanceof File && AUDIO_VIDEO_EXTENSIONS.has(extensionOf(raw.name));
  const file = uploadedFile(req.form, "file", isMedia ? MAX_RECORDING_MB : MAX_DOCUMENT_MB, ALLOWED);
  const ext = extensionOf(file.name);
  const label = String(req.form?.get("label") ?? "").slice(0, 255).trim();
  const declared = String(req.form?.get("evidence_type") ?? "") || null;
  if (declared && !(EVIDENCE_TYPES as readonly string[]).includes(declared)) throw new HttpError(422, "evidence_type: Input should be a valid type");
  const processable = IMAGE_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(ext) || AUDIO_VIDEO_EXTENSIONS.has(ext) || ext === "pdf";
  const fileId = uuid();
  await files.put(fileId, file);
  const sha = await sha256Hex(file);
  const row: EvidenceRow = {
    id: uuid(), case_id: cid, label: label || file.name, evidence_type: guessType(ext, declared), original_filename: file.name,
    content_type: file.type || "application/octet-stream", size_bytes: file.size, sha256: sha, uploaded_by: user.id, uploaded_at: nowISO(),
    processing_status: processable ? "queued" : "skipped",
    processing_error: processable ? null : `Automatic text extraction isn't available for .${ext} files.`,
    processed_at: null, ocr_confidence: null, ocr_language: null, page_count: null, text_length: null, entity_count: null,
    signature_check: null, ai_summary: null, review_status: "pending_review", review_note: null, reviewed_by: null, reviewed_at: null,
    file_id: fileId, text: null, entities: [], charges: [], meta: {},
  };
  db().evidence.push(row);
  save();
  audit(user, "evidence.uploaded", "evidence", row.id, { case_id: cid, sha256: sha, size: file.size, file: file.name });
  audit(user, "case.evidence_added", "case", cid, { evidence_id: row.id, label: row.label });
  const mode = processable ? dispatch("process_evidence", row.id) : null;
  return new Status(201, { ...evidenceView(row), processing_mode: mode });
});

route("GET", "/evidence/{evidence_id}", (req) => {
  requireRole(req.user(), STAFF);
  return evidenceView(evidenceOr404(req.params.evidence_id));
});

route("GET", "/evidence/{evidence_id}/text", (req) => {
  const user = requireRole(req.user(), STAFF);
  const ev = evidenceOr404(req.params.evidence_id);
  audit(user, "evidence.text_viewed", "evidence", ev.id);
  return { evidence_id: ev.id, text: ev.text ?? "", entities: ev.entities, charges: ev.charges, meta: ev.meta };
});

route("GET", "/evidence/{evidence_id}/file", async (req) => {
  const user = requireRole(req.user(), STAFF);
  const ev = evidenceOr404(req.params.evidence_id);
  const blob = await files.get(ev.file_id);
  if (!blob) throw new HttpError(410, "The stored file is missing. This has been recorded in the audit log.");
  audit(user, "evidence.downloaded", "evidence", ev.id);
  return new Raw(blob, ev.content_type, ev.original_filename);
});

route("POST", "/evidence/{evidence_id}/verify-integrity", async (req) => {
  const user = requireRole(req.user(), STAFF);
  const ev = evidenceOr404(req.params.evidence_id);
  const blob = await files.get(ev.file_id);
  const result = blob ? { intact: (await sha256Hex(blob)) === ev.sha256, stored_sha256: ev.sha256, current_sha256: await sha256Hex(blob) }
                      : { intact: false, reason: "Stored file is missing." };
  audit(user, "evidence.integrity_checked", "evidence", ev.id, result);
  return result;
});

route("POST", "/evidence/{evidence_id}/reprocess", (req) => {
  const user = requireRole(req.user(), EVIDENCE_SUBMITTERS);
  const ev = evidenceOr404(req.params.evidence_id);
  // Timeline events from the previous run are replaced by the new run's.
  const kase = db().cases.find((c) => c.id === ev.case_id);
  if (kase) kase.timeline = kase.timeline.filter((t) => t.source_document_id !== ev.id);
  Object.assign(ev, { processing_status: "queued", processing_error: null });
  save();
  audit(user, "evidence.reprocess_requested", "evidence", ev.id);
  return { processing_status: "queued", mode: dispatch("process_evidence", ev.id) };
});

route("POST", "/evidence/{evidence_id}/review", (req) => {
  const user = requireRole(req.user(), STAFF);
  const ev = evidenceOr404(req.params.evidence_id);
  const status = String(req.body.review_status ?? "");
  if (!["reviewed", "flagged", "pending_review"].includes(status)) throw new HttpError(422, "review_status: String should match pattern '^(reviewed|flagged|pending_review)$'");
  const note = req.body.note ? String(req.body.note).slice(0, 4000) : null;
  Object.assign(ev, { review_status: status, review_note: note, reviewed_by: user.id, reviewed_at: nowISO() });
  save();
  audit(user, `evidence.${status}`, "evidence", ev.id, { note: (note ?? "").slice(0, 300) });
  return evidenceView(ev);
});

const SCAN_TYPES = new Set([...IMAGE_EXTENSIONS, "pdf"]);

route("POST", "/evidence/{evidence_id}/signature-check", async (req) => {
  const user = requireRole(req.user(), EVIDENCE_SUBMITTERS);
  const ev = evidenceOr404(req.params.evidence_id);
  if (!SCAN_TYPES.has(extensionOf(ev.original_filename))) throw new HttpError(422, "Signature checks work on scanned documents (images or PDF).");
  const blob = await files.get(ev.file_id);
  if (!blob) throw new HttpError(422, "Signature checks work on scanned documents (images or PDF).");
  const ref = req.form?.get("reference");
  const reference = ref instanceof File && ref.name ? uploadedFile(req.form, "reference", 15, SCAN_TYPES) : null;
  let result;
  try {
    result = await verifySignature(blob.type ? blob : new Blob([blob], { type: ev.content_type }), reference);
  } catch (e) {
    throw new HttpError(422, `The document image couldn't be analysed (${(e as Error).name}).`);
  }
  ev.signature_check = result;
  save();
  audit(user, "evidence.signature_checked", "evidence", ev.id, { present: result.signature_present, score: result.match_score });
  return evidenceView(ev);
});

route("GET", "/evidence/{evidence_id}/custody", (req) => {
  requireRole(req.user(), STAFF);
  const ev = evidenceOr404(req.params.evidence_id);
  return db().audit.filter((a) => a.entity_type === "evidence" && a.entity_id === ev.id).sort((a, b) => b.id - a.id).slice(0, 500);
});

route("POST", "/documents/ocr", async (req) => {
  requireRole(req.user(), EVIDENCE_SUBMITTERS);
  const file = uploadedFile(req.form, "file", MAX_DOCUMENT_MB, new Set([...IMAGE_EXTENSIONS, ...TEXT_EXTENSIONS, "pdf"]));
  try {
    const x = await extractText(file, file.name);
    return { text: x.text, confidence: x.mean_confidence, method: x.method, pages: x.page_count, warnings: x.warnings };
  } catch (e) {
    throw new HttpError(422, `Couldn't read that document (${(e as Error).name}).`);
  }
});

route("POST", "/documents/verify-signature", async (req) => {
  requireRole(req.user(), EVIDENCE_SUBMITTERS);
  const doc = uploadedFile(req.form, "document", 15, SCAN_TYPES);
  const ref = req.form?.get("reference");
  const reference = ref instanceof File && ref.name ? uploadedFile(req.form, "reference", 15, SCAN_TYPES) : null;
  try {
    return await verifySignature(doc, reference);
  } catch (e) {
    throw new HttpError(422, `The image couldn't be analysed (${(e as Error).name}).`);
  }
});
