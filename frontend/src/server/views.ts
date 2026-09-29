/** Record lookups and API views shared by the routes (the repositories' job on the server). */
import { HttpError, isUuid } from "./core";
import { db, type CaseRow, type HearingRow, type PersonRow, type StatementRow } from "./store";

export const CASE_TYPES = ["criminal", "civil", "cybercrime", "traffic", "grievance"] as const;
export const CASE_STATUSES = ["intake", "under_investigation", "ready_for_hearing", "in_hearing", "awaiting_ruling", "resolved", "closed"] as const;
export const OPEN_STATUSES = new Set(["intake", "under_investigation", "ready_for_hearing", "in_hearing", "awaiting_ruling"]);
export const HEARING_ROLES = ["defendant", "plaintiff", "witness", "expert_witness", "prosecutor", "defense_counsel", "interpreter", "victim"] as const;
export const HEARING_STATUSES = ["scheduled", "in_progress", "completed", "cancelled", "adjourned"] as const;
export const COMPLAINT_STATUSES = ["received", "under_review", "case_opened", "resolved", "rejected", "duplicate"] as const;
export const EVIDENCE_TYPES = ["document", "image", "video", "audio", "cctv", "digital", "contract"] as const;
export const JURISDICTIONS = ["federal", "difc", "adgm", "dubai", "abu_dhabi", "sharjah", "other_emirate"] as const;
export const CASE_PREFIX: Record<string, string> = { criminal: "CR", civil: "CV", cybercrime: "CY", traffic: "TR", grievance: "GR" };

export function caseOr404(id: string): CaseRow {
  const c = isUuid(id) ? db().cases.find((x) => x.id === id) : undefined;
  if (!c) throw new HttpError(404, "Case not found.");
  return c;
}

export function personView(p: PersonRow) {
  const { emirates_id_hash: _h, ...rest } = p;
  return rest;
}

export function partiesOf(caseId: string) {
  return db().parties.filter((p) => p.case_id === caseId).sort((a, b) => a.added_at.localeCompare(b.added_at)).map((link) => {
    const person = db().people.find((p) => p.id === link.person_id)!;
    return { person: personView(person), role: link.role, added_at: link.added_at };
  }).filter((p) => p.person);
}

export function caseView(c: CaseRow) {
  return {
    ...c,
    timeline: [...c.timeline],
    parties: db().parties.filter((p) => p.case_id === c.id).map((p) => p.person_id),
    evidence: db().evidence.filter((e) => e.case_id === c.id).map((e) => e.id),
  };
}

export function nextCaseNumber(caseType: string): string {
  const prefix = `${CASE_PREFIX[caseType] ?? "CS"}-${new Date().getFullYear()}-`;
  let highest = 0;
  for (const c of db().cases) {
    if (!c.case_number.startsWith(prefix)) continue;
    const n = parseInt(c.case_number.slice(prefix.length), 10);
    if (!Number.isNaN(n)) highest = Math.max(highest, n);
  }
  return `${prefix}${String(highest + 1).padStart(5, "0")}`;
}

export function hearingView(h: HearingRow) {
  const kase = db().cases.find((c) => c.id === h.case_id);
  const judge = h.presiding_judge_id ? db().users.find((u) => u.id === h.presiding_judge_id) : null;
  return {
    ...h,
    case_number: kase?.case_number ?? null, case_title: kase?.title ?? null, case_type: kase?.case_type ?? null,
    judge_name: judge?.full_name ?? null,
    ends_at: new Date(Date.parse(h.scheduled_at) + h.duration_minutes * 60_000).toISOString(),
  };
}

export function statementView(s: StatementRow) {
  const { recording_file_id, ...rest } = s;
  return { ...rest, has_recording: !!recording_file_id };
}

export function statementsForCase(caseId: string) {
  return db().statements.filter((s) => s.case_id === caseId).sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
}

export function casesForPerson(personId: string) {
  return db().parties.filter((p) => p.person_id === personId).map((p) => {
    const c = db().cases.find((x) => x.id === p.case_id)!;
    return c && { case_id: c.id, case_number: c.case_number, title: c.title, status: c.status, role: p.role };
  }).filter(Boolean) as { case_id: string; case_number: string; title: string; status: string; role: string }[];
}

export function paged<T>(items: T[], query: URLSearchParams, defaultLimit = 100, maxLimit = 500) {
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.get("limit") ?? "", 10) || defaultLimit));
  const offset = Math.max(0, parseInt(query.get("offset") ?? "", 10) || 0);
  return { items: items.slice(offset, offset + limit), total: items.length };
}

export const ilike = (haystack: string | null | undefined, needle: string) => (haystack ?? "").toLowerCase().includes(needle.toLowerCase());
