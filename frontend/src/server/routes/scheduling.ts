/** Hearings (with courtroom/judge conflict detection) and the people registry. */
import {
  audit, CASE_EDITORS, HttpError, isUuid, keyedHash, normalizeEmiratesId, notFoundUnlessUuid, nowISO, requireRole, SCHEDULERS, STAFF, uuid,
} from "../core";
import { bool, has, oneOf, route, Status, str } from "../router";
import { db, save, type HearingRow, type PersonRow } from "../store";
import { casesForPerson, HEARING_ROLES, HEARING_STATUSES, hearingView, ilike, personView } from "../views";

const UAE_OFFSET_MS = 4 * 3600_000;

/** Naive datetimes are UAE local time, like the server's _aware(). */
function instant(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new HttpError(422, `${label}: Field required`);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const t = Date.parse(hasZone ? value : `${value.length === 16 ? value + ":00" : value}+04:00`);
  if (Number.isNaN(t)) throw new HttpError(422, `${label}: Input should be a valid datetime`);
  return new Date(t).toISOString();
}

function validateJudge(id: string | null): void {
  if (!id) return;
  const judge = db().users.find((u) => u.id === id);
  if (!judge || judge.role !== "judge" || !judge.is_active) throw new HttpError(422, "The presiding judge must be an active judge account.");
}

function conflicts(start: string, minutes: number, courtroom: string | null, judgeId: string | null, excludeId?: string): HearingRow[] {
  if (!courtroom && !judgeId) return [];
  const s = Date.parse(start), e = s + minutes * 60_000;
  return db().hearings.filter((h) => {
    if (h.id === excludeId || ["cancelled", "completed", "adjourned"].includes(h.status)) return false;
    if (!((courtroom && h.courtroom === courtroom) || (judgeId && h.presiding_judge_id === judgeId))) return false;
    const hs = Date.parse(h.scheduled_at);
    return hs < e && hs + (h.duration_minutes || 60) * 60_000 > s;
  });
}

const conflictDetail = (list: HearingRow[]) => ({
  message: "This time overlaps another hearing in the same courtroom or with the same judge.",
  conflicts: list.map(hearingView),
});

route("GET", "/hearings", (req) => {
  const user = requireRole(req.user(), STAFF);
  const q = req.query;
  let start = q.get("start") ? instant(q.get("start"), "start") : null;
  let end = q.get("end") ? instant(q.get("end"), "end") : null;
  const day = q.get("day");
  if (day) {
    start = new Date(Date.parse(`${day}T00:00:00+04:00`)).toISOString();
    end = new Date(Date.parse(start) + 86_400_000).toISOString();
  }
  const judgeId = bool(q.get("mine")) && user.role === "judge" ? user.id : null;
  return db().hearings.filter((h) =>
    (!start || h.scheduled_at >= start) && (!end || h.scheduled_at < end) && (!q.get("case_id") || h.case_id === q.get("case_id"))
    && (!q.get("courtroom") || h.courtroom === q.get("courtroom")) && (!q.get("status") || h.status === q.get("status"))
    && (!judgeId || h.presiding_judge_id === judgeId),
  ).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 500).map(hearingView);
});

route("POST", "/hearings", (req) => {
  const user = requireRole(req.user(), SCHEDULERS);
  const b = req.body;
  const kase = isUuid(b.case_id) ? db().cases.find((c) => c.id === b.case_id) : undefined;
  if (!kase) throw new HttpError(404, "Case not found.");
  const judgeId = b.presiding_judge_id || null;
  validateJudge(judgeId);
  const scheduledAt = instant(b.scheduled_at, "scheduled_at");
  const duration = Number(b.duration_minutes ?? 60);
  if (!(duration >= 5 && duration <= 600)) throw new HttpError(422, "duration_minutes: Input should be between 5 and 600");
  const courtroom = (str(b, "courtroom", { max: 64 }) ?? "").trim() || null;
  const found = conflicts(scheduledAt, duration, courtroom, judgeId);
  if (found.length && !b.force) throw new HttpError(409, conflictDetail(found));
  const hearing: HearingRow = {
    id: uuid(), case_id: kase.id, scheduled_at: scheduledAt, duration_minutes: duration, hearing_type: str(b, "hearing_type", { max: 64 }) || null,
    courtroom, status: "scheduled", presiding_judge_id: judgeId || kase.assigned_judge_id, notes: str(b, "notes", { max: 4000 }) || null,
    created_at: nowISO(), updated_at: null,
  };
  db().hearings.push(hearing);
  if (["intake", "under_investigation"].includes(kase.status)) { kase.status = "ready_for_hearing"; kase.updated_at = nowISO(); }
  save();
  audit(user, "hearing.scheduled", "case", kase.id, { hearing_id: hearing.id, at: scheduledAt, forced: found.length > 0 });
  return new Status(201, hearingView(hearing));
});

route("GET", "/hearings/{hearing_id}", (req) => {
  requireRole(req.user(), STAFF);
  const h = db().hearings.find((x) => x.id === notFoundUnlessUuid(req.params.hearing_id, "Hearing"));
  if (!h) throw new HttpError(404, "Hearing not found.");
  return hearingView(h);
});

route("PATCH", "/hearings/{hearing_id}", (req) => {
  const user = requireRole(req.user(), SCHEDULERS);
  const id = notFoundUnlessUuid(req.params.hearing_id, "Hearing");
  const h = db().hearings.find((x) => x.id === id);
  if (!h) throw new HttpError(404, "Hearing not found.");
  const b = req.body;
  const fields: Partial<HearingRow> = {};
  if (has(b, "presiding_judge_id")) { validateJudge(b.presiding_judge_id || null); fields.presiding_judge_id = b.presiding_judge_id || null; }
  if (has(b, "scheduled_at") && b.scheduled_at) fields.scheduled_at = instant(b.scheduled_at, "scheduled_at");
  if (has(b, "duration_minutes") && b.duration_minutes !== null) {
    const d = Number(b.duration_minutes);
    if (!(d >= 5 && d <= 600)) throw new HttpError(422, "duration_minutes: Input should be between 5 and 600");
    fields.duration_minutes = d;
  }
  if (has(b, "courtroom")) fields.courtroom = (str(b, "courtroom", { max: 64 }) ?? "").trim() || null;
  if (has(b, "hearing_type")) fields.hearing_type = str(b, "hearing_type", { max: 64 }) || null;
  if (has(b, "notes")) fields.notes = str(b, "notes", { max: 4000 }) || null;
  if (has(b, "status") && b.status !== null) fields.status = oneOf(b.status, HEARING_STATUSES, "status")!;
  if (["scheduled_at", "duration_minutes", "courtroom", "presiding_judge_id"].some((k) => k in fields)) {
    const found = conflicts(fields.scheduled_at ?? h.scheduled_at, fields.duration_minutes ?? h.duration_minutes,
                            "courtroom" in fields ? fields.courtroom! : h.courtroom,
                            "presiding_judge_id" in fields ? fields.presiding_judge_id! : h.presiding_judge_id, id);
    if (found.length && !b.force && fields.status !== "cancelled") throw new HttpError(409, conflictDetail(found));
  }
  Object.assign(h, fields, { updated_at: nowISO() });
  save();
  const { force: _f, ...detail } = b;
  audit(user, "hearing.updated", "case", h.case_id, { hearing_id: id, ...detail });
  return hearingView(h);
});

// ---------------------------------------------------------------------------
// People registry
// ---------------------------------------------------------------------------

export async function createPersonFrom(newPerson: any, role: string): Promise<PersonRow> {
  const fullName = str(newPerson, "full_name", { required: true, min: 2, max: 255, label: "full_name" })!;
  const lang = newPerson.preferred_language ?? "ar";
  if (!["ar", "en"].includes(lang)) throw new HttpError(422, "preferred_language: String should match pattern '^(ar|en)$'");
  let hash: string | null = null, last4: string | null = null;
  if (newPerson.emirates_id) {
    const normalized = normalizeEmiratesId(String(newPerson.emirates_id));
    if (!normalized) throw new HttpError(422, "Emirates ID must look like 784-YYYY-NNNNNNN-N.");
    hash = await keyedHash(`eid:${normalized}`);
    last4 = normalized.replace(/-/g, "").slice(-4);
    const existing = db().people.find((p) => p.emirates_id_hash === hash);
    if (existing) return existing;
  }
  const person: PersonRow = {
    id: uuid(), full_name: fullName.trim(), emirates_id_hash: hash, emirates_id_last4: last4, role_in_case: role,
    reference_photo_on_file: false, contact_phone: str(newPerson, "contact_phone", { max: 40 }) || null, preferred_language: lang,
    created_at: nowISO(),
  };
  db().people.push(person);
  save();
  return person;
}

export function addParty(caseId: string, personId: string, role: string): boolean {
  if (!db().cases.some((c) => c.id === caseId)) return false;
  const existing = db().parties.find((p) => p.case_id === caseId && p.person_id === personId);
  if (existing) existing.role = role;
  else db().parties.push({ case_id: caseId, person_id: personId, role, added_at: nowISO() });
  save();
  return true;
}

route("GET", "/people", (req) => {
  requireRole(req.user(), STAFF);
  const q = req.query.get("q")?.trim();
  return db().people.filter((p) => !q || ilike(p.full_name, q)).sort((a, b) => a.full_name.localeCompare(b.full_name)).slice(0, 100).map(personView);
});

route("GET", "/people/{person_id}", (req) => {
  requireRole(req.user(), STAFF);
  const p = db().people.find((x) => x.id === notFoundUnlessUuid(req.params.person_id, "Person"));
  if (!p) throw new HttpError(404, "Person not found.");
  return { ...personView(p), cases: casesForPerson(p.id) };
});

route("POST", "/people", async (req) => {
  const user = requireRole(req.user(), CASE_EDITORS);
  const role = req.body.role_in_case ? oneOf(req.body.role_in_case, HEARING_ROLES, "role_in_case")! : "witness";
  const person = await createPersonFrom(req.body, role);
  if (req.body.case_id && !addParty(req.body.case_id, person.id, role)) throw new HttpError(404, "Case not found.");
  audit(user, "person.created", "person", person.id);
  return new Status(201, personView(person));
});

route("PATCH", "/people/{person_id}", (req) => {
  const user = requireRole(req.user(), CASE_EDITORS);
  const p = db().people.find((x) => x.id === notFoundUnlessUuid(req.params.person_id, "Person"));
  if (!p) throw new HttpError(404, "Person not found.");
  const b = req.body;
  if (has(b, "full_name") && b.full_name !== null) p.full_name = str(b, "full_name", { min: 2, max: 255 })!;
  if (has(b, "contact_phone")) p.contact_phone = str(b, "contact_phone", { max: 40 }) || null;
  if (has(b, "preferred_language") && b.preferred_language !== null) p.preferred_language = oneOf(b.preferred_language, ["ar", "en"], "preferred_language")!;
  save();
  audit(user, "person.updated", "person", p.id, b);
  return personView(p);
});

export { UAE_OFFSET_MS };
