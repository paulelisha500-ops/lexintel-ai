/** Citizen complaints: public filing + tracking, and the staff triage screen. */
import { scoreCase } from "../ai/triage";
import { audit, CASE_BUILDERS, HttpError, keyedHash, newTrackingCode, notFoundUnlessUuid, nowISO, rateHit, requireRole, uuid } from "../core";
import { dispatch } from "../jobs";
import { has, isoDate, oneOf, route, Status, str } from "../router";
import { db, save, type ComplaintRow } from "../store";
import { CASE_TYPES, caseView, COMPLAINT_STATUSES, HEARING_ROLES, ilike, nextCaseNumber } from "../views";
import { addParty } from "./scheduling";

const PUBLIC_STATUS_TEXT: Record<string, string> = {
  received: "Received -- waiting for review",
  under_review: "Under review by a case officer",
  case_opened: "A case has been opened",
  resolved: "Resolved",
  rejected: "Closed without further action",
  duplicate: "Merged with an earlier complaint",
};

export function complaintView(c: ComplaintRow) {
  const { tracking_code_hash: _h, submitted_by: _s, ...rest } = c;
  return rest;
}

function complaintOr404(id: string): ComplaintRow {
  const c = db().complaints.find((x) => x.id === notFoundUnlessUuid(id, "Complaint"));
  if (!c) throw new HttpError(404, "Complaint not found.");
  return c;
}

route("POST", "/complaints", async (req) => {
  const b = req.body;
  const caseType = oneOf(b.case_type, CASE_TYPES, "case_type")!;
  const description = str(b, "description", { required: true, min: 20, max: 8000 })!.trim();
  if (description.length < 20) throw new HttpError(422, "description: Please describe what happened in at least 20 characters.");
  const email = (str(b, "complainant_email", { max: 254 }) ?? "").trim() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email)) throw new HttpError(422, "complainant_email: Enter a valid email address.");
  const phone = (str(b, "complainant_phone", { max: 40 }) ?? "").trim() || null;
  if (phone && !/^[+\d][\d\s\-()]{6,39}$/.test(phone)) throw new HttpError(422, "complainant_phone: Enter a valid phone number.");
  const lang = b.preferred_language ? oneOf(b.preferred_language, ["ar", "en"], "preferred_language") : null;
  if (!rateHit("complaint", 10, 3600)) throw new HttpError(429, "Too many complaints from this connection. Please try again later.");
  const code = newTrackingCode();
  let reference: string;
  do {
    reference = `CMP-${new Date().getFullYear()}-${[...crypto.getRandomValues(new Uint8Array(3))].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  } while (db().complaints.some((c) => c.reference_number === reference));
  const row: ComplaintRow = {
    id: uuid(), reference_number: reference, submitted_by: uuid(), case_type: caseType, description,
    location: (str(b, "location", { max: 300 }) ?? "").trim() || null, complainant_name: (str(b, "complainant_name", { max: 200 }) ?? "").trim() || null,
    complainant_phone: phone, complainant_email: email, preferred_language: lang, status: "received", submitted_at: nowISO(), updated_at: null,
    ai_status: "pending", ai_suggested_category: null, ai_duplicate_of: null, ai_suggested_department: null, ai_confidence: null,
    ai_explanation: null, ai_priority_level: null, duplicate_candidates: null, ai_details: null, category_confirmed: false,
    assigned_department: null, staff_notes: null, case_id: null, tracking_code_hash: await keyedHash(`track:${code}`),
  };
  db().complaints.push(row);
  save();
  audit(null, "complaint.submitted", "complaint", row.id, { reference });
  dispatch("classify_complaint", row.id);
  return new Status(201, { id: row.id, reference_number: reference, tracking_code: code, status: row.status,
                           status_text: PUBLIC_STATUS_TEXT[row.status], submitted_at: row.submitted_at });
});

route("POST", "/complaints/track", async (req) => {
  const reference = String(req.body.reference ?? "").trim().toUpperCase();
  const code = String(req.body.code ?? "").trim().toUpperCase();
  if (reference.length < 6 || code.length < 6) throw new HttpError(422, "Enter the reference number and tracking code.");
  if (!rateHit("track", 30, 600)) throw new HttpError(429, "Too many lookups. Please wait a few minutes.");
  const c = db().complaints.find((x) => x.reference_number === reference);
  if (!c || c.tracking_code_hash !== (await keyedHash(`track:${code}`))) {
    throw new HttpError(404, "No complaint matches that reference number and tracking code.");
  }
  const kase = c.case_id ? db().cases.find((x) => x.id === c.case_id) : null;
  return { reference_number: c.reference_number, status: c.status, status_text: PUBLIC_STATUS_TEXT[c.status] ?? c.status,
           case_type: c.case_type, submitted_at: c.submitted_at, updated_at: c.updated_at, assigned_department: c.assigned_department,
           case_number: kase?.case_number ?? null };
});

route("GET", "/complaints", (req) => {
  requireRole(req.user(), CASE_BUILDERS);
  const q = req.query;
  const status = q.get("status"), type = q.get("case_type"), text = q.get("q")?.trim();
  const rows = db().complaints.filter((c) =>
    (!status || c.status === status) && (!type || c.case_type === type || c.ai_suggested_category === type)
    && (!text || ilike(c.description, text) || ilike(c.reference_number, text) || ilike(c.complainant_name, text) || ilike(c.location, text)),
  ).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const limit = Math.min(500, Math.max(1, parseInt(q.get("limit") ?? "", 10) || 100));
  const offset = Math.max(0, parseInt(q.get("offset") ?? "", 10) || 0);
  return { items: rows.slice(offset, offset + limit).map(complaintView), total: rows.length };
});

route("GET", "/complaints/{complaint_id}", (req) => {
  requireRole(req.user(), CASE_BUILDERS);
  return complaintView(complaintOr404(req.params.complaint_id));
});

route("PATCH", "/complaints/{complaint_id}", (req) => {
  const user = requireRole(req.user(), CASE_BUILDERS);
  const c = complaintOr404(req.params.complaint_id);
  const b = req.body;
  const fields: Partial<ComplaintRow> = {};
  if (has(b, "status") && b.status !== null) fields.status = oneOf(b.status, COMPLAINT_STATUSES, "status")!;
  if (fields.status === "case_opened") throw new HttpError(400, "Use 'Open case' to move a complaint to case_opened.");
  if (has(b, "assigned_department")) fields.assigned_department = str(b, "assigned_department", { max: 128 }) || null;
  if (has(b, "staff_notes")) fields.staff_notes = str(b, "staff_notes", { max: 8000 }) || null;
  if (has(b, "case_type") && b.case_type !== null) {
    fields.case_type = oneOf(b.case_type, CASE_TYPES, "case_type")!;
    fields.category_confirmed = true; // staff's decision -> the classifier learns from it
  }
  Object.assign(c, fields, { updated_at: nowISO() });
  save();
  audit(user, "complaint.updated", "complaint", c.id, b);
  return complaintView(c);
});

route("POST", "/complaints/{complaint_id}/reclassify", (req) => {
  const user = requireRole(req.user(), CASE_BUILDERS);
  const c = complaintOr404(req.params.complaint_id);
  c.ai_status = "pending";
  save();
  audit(user, "complaint.reclassify_requested", "complaint", c.id);
  return { status: "pending", mode: dispatch("classify_complaint", c.id) };
});

route("POST", "/complaints/{complaint_id}/open-case", (req) => {
  const user = requireRole(req.user(), CASE_BUILDERS);
  const complaint = complaintOr404(req.params.complaint_id);
  if (complaint.case_id) throw new HttpError(409, "A case has already been opened for this complaint.");
  const title = str(req.body, "title", { required: true, min: 4, max: 500 })!.trim();
  const caseType = req.body.case_type ? oneOf(req.body.case_type, CASE_TYPES, "case_type")! : complaint.case_type;
  const deadline = isoDate(req.body.statutory_deadline, "statutory_deadline");
  const addAs = has(req.body, "add_complainant_as") ? (req.body.add_complainant_as ? oneOf(req.body.add_complainant_as, HEARING_ROLES, "add_complainant_as") : null) : "plaintiff";
  const id = uuid();
  const signals = { case_id: id, case_opened_on: complaint.submitted_at.slice(0, 10), statutory_deadline: deadline,
                    public_safety_flag: complaint.ai_priority_level === "high", vulnerable_victim: false, missing_critical_evidence: false };
  const kase = {
    id, case_number: nextCaseNumber(caseType), case_type: caseType, status: "intake", title,
    description: `Opened from citizen complaint ${complaint.reference_number}.\n\n${complaint.description}`, timeline: [],
    priority: scoreCase(signals), priority_signals: signals, assigned_judge_id: null, source_complaint_id: complaint.id,
    created_at: nowISO(), updated_at: null, closed_at: null, statutory_deadline: deadline,
  };
  db().cases.push(kase);
  if (complaint.complainant_name && addAs) {
    const person = { id: uuid(), full_name: complaint.complainant_name, emirates_id_hash: null, emirates_id_last4: null, role_in_case: addAs,
                     reference_photo_on_file: false, contact_phone: complaint.complainant_phone, preferred_language: complaint.preferred_language ?? "ar",
                     created_at: nowISO() };
    db().people.push(person);
    addParty(id, person.id, addAs);
  }
  Object.assign(complaint, { status: "case_opened", case_id: id, case_type: caseType, category_confirmed: true, updated_at: nowISO() });
  save();
  audit(user, "case.created_from_complaint", "case", id, { complaint: complaint.reference_number, case_number: kase.case_number });
  return new Status(201, { case: caseView(kase) });
});
