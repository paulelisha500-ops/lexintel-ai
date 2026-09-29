/** Cases: docket, priority, parties, timeline + extraction, comparison, similar/related, brief, notes, statements, ruling. */
import { extractiveSummary } from "../ai/analysis";
import { streamGroundedDraft } from "../ai/drafting";
import { compareSources, parseDate, runCaseIntelligence } from "../ai/intelligence";
import { dot, embed, ModelUnavailable } from "../ai/models";
import { round, tokenSimilarity } from "../ai/text";
import { embedDocument, scoreCase, todayISO } from "../ai/triage";
import {
  audit, CASE_BUILDERS, CASE_EDITORS, HttpError, isUuid, notFoundUnlessUuid, nowISO, rateHit, requireRole, STAFF, uuid,
} from "../core";
import { bool, has, isoDate, oneOf, plausibleDeadline, route, Sse, Status, str } from "../router";
import { db, save, type CaseRow } from "../store";
import {
  CASE_STATUSES, CASE_TYPES, caseOr404, casesForPerson, caseView, HEARING_ROLES, hearingView, ilike, nextCaseNumber,
  partiesOf, personView, statementsForCase, statementView,
} from "../views";
import { addParty, createPersonFrom } from "./scheduling";

// ---------------------------------------------------------------------------
// Docket
// ---------------------------------------------------------------------------

route("GET", "/cases", (req) => {
  const user = requireRole(req.user(), STAFF);
  const q = req.query;
  const status = q.get("status"), type = q.get("case_type"), priority = q.get("priority"), text = q.get("q")?.trim();
  const openOnly = bool(q.get("open_only"));
  const judgeId = bool(q.get("mine")) && user.role === "judge" ? user.id : null;
  const rows = db().cases.filter((c) =>
    (!status || c.status === status) && (!openOnly || ["intake", "under_investigation", "ready_for_hearing", "in_hearing", "awaiting_ruling"].includes(c.status))
    && (!type || c.case_type === type)
    && (!priority || (priority === "unscored" ? !c.priority : c.priority?.level === priority))
    && (!judgeId || c.assigned_judge_id === judgeId)
    && (!text || ilike(c.title, text) || ilike(c.case_number, text) || ilike(c.description, text)),
  ).sort((a, b) => (b.priority?.score ?? -Infinity) - (a.priority?.score ?? -Infinity) || b.created_at.localeCompare(a.created_at));
  const limit = Math.min(500, Math.max(1, parseInt(q.get("limit") ?? "", 10) || 100));
  const offset = Math.max(0, parseInt(q.get("offset") ?? "", 10) || 0);
  const now = new Date(Date.now() - 4 * 3600_000).toISOString();
  const items = rows.slice(offset, offset + limit).map((c) => {
    const next = db().hearings.filter((h) => h.case_id === c.id && h.scheduled_at >= now && ["scheduled", "in_progress"].includes(h.status))
      .map((h) => h.scheduled_at).sort()[0] ?? null;
    const { timeline: _t, ...rest } = caseView(c);
    return { ...rest, party_count: db().parties.filter((p) => p.case_id === c.id).length,
             evidence_count: db().evidence.filter((e) => e.case_id === c.id).length, next_hearing: next, timeline_count: c.timeline.length };
  });
  return { items, total: rows.length };
});

route("POST", "/cases", (req) => {
  const user = requireRole(req.user(), CASE_BUILDERS);
  const b = req.body;
  const number = (str(b, "case_number", { max: 64, pattern: /^[A-Za-z0-9\-/]*$/ }) ?? "").trim();
  const caseType = oneOf(b.case_type, CASE_TYPES, "case_type")!;
  const title = str(b, "title", { required: true, min: 4, max: 500 })!.trim();
  const description = str(b, "description", { max: 20000 });
  const deadline = plausibleDeadline(b.statutory_deadline);
  if (number && db().cases.some((c) => c.case_number === number)) throw new HttpError(409, "A case with that case number already exists.");
  const id = uuid();
  const signals = { case_id: id, case_opened_on: todayISO(), statutory_deadline: deadline, public_safety_flag: !!b.public_safety_flag,
                    vulnerable_victim: !!b.vulnerable_victim, missing_critical_evidence: !!b.missing_critical_evidence };
  const row: CaseRow = {
    id, case_number: number || nextCaseNumber(caseType), case_type: caseType, status: "intake", title, description: description || null,
    timeline: [], priority: scoreCase(signals), priority_signals: signals, assigned_judge_id: b.assigned_judge_id || null,
    source_complaint_id: null, created_at: nowISO(), updated_at: null, closed_at: null, statutory_deadline: deadline,
  };
  db().cases.push(row);
  save();
  audit(user, "case.created", "case", id, { case_number: row.case_number });
  return new Status(201, caseView(row));
});

route("GET", "/cases/{case_id}", (req) => {
  const user = req.user();
  const c = caseOr404(req.params.case_id);
  const judge = c.assigned_judge_id ? db().users.find((u) => u.id === c.assigned_judge_id) : null;
  const ruling = db().rulings.find((r) => r.case_id === c.id);
  const evidence = db().evidence.filter((e) => e.case_id === c.id);
  return {
    ...caseView(c),
    parties: partiesOf(c.id),
    hearings: db().hearings.filter((h) => h.case_id === c.id).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).map((h) => {
      const { case_number: _n, case_title: _t, case_type: _y, judge_name: _j, ends_at: _e, ...rest } = hearingView(h);
      return rest;
    }),
    evidence_summary: { total: evidence.length, pending_review: evidence.filter((e) => e.review_status === "pending_review").length,
                        processing: evidence.filter((e) => ["queued", "processing"].includes(e.processing_status)).length },
    ruling: ruling ?? null,
    assigned_judge: judge ? { id: judge.id, full_name: judge.full_name } : null,
    research_note_count: db().notes.filter((n) => n.case_id === c.id).length,
    statement_count: statementsForCase(c.id).length,
    can_enter_ruling: user.role === "judge",
  };
});

route("PATCH", "/cases/{case_id}", (req) => {
  const user = requireRole(req.user(), CASE_EDITORS);
  const c = caseOr404(req.params.case_id);
  const b = req.body;
  const fields: Partial<CaseRow> = {};
  if (has(b, "title") && b.title !== null) fields.title = str(b, "title", { min: 4, max: 500 })!;
  if (has(b, "description")) fields.description = str(b, "description", { max: 20000 });
  if (has(b, "status") && b.status !== null) fields.status = oneOf(b.status, CASE_STATUSES, "status")!;
  if (has(b, "statutory_deadline")) fields.statutory_deadline = plausibleDeadline(b.statutory_deadline);
  if (has(b, "assigned_judge_id")) {
    if (b.assigned_judge_id) {
      const judge = db().users.find((u) => u.id === b.assigned_judge_id);
      if (!judge || judge.role !== "judge") throw new HttpError(422, "The assigned judge must be an active judge account.");
    }
    fields.assigned_judge_id = b.assigned_judge_id || null;
  }
  if (user.role === "judge" && Object.keys(fields).some((k) => k !== "status")) {
    throw new HttpError(403, "Judges can update a case's status; other case details are edited by case staff.");
  }
  if (fields.status && ["resolved", "closed"].includes(fields.status) && !c.closed_at) fields.closed_at = nowISO();
  if (fields.status && !["resolved", "closed"].includes(fields.status)) fields.closed_at = null;
  Object.assign(c, fields, { updated_at: nowISO() });
  save();
  audit(user, "case.updated", "case", c.id, b);
  return caseView(c);
});

route("POST", "/cases/{case_id}/priority", (req) => {
  const user = requireRole(req.user(), CASE_EDITORS);
  const c = caseOr404(req.params.case_id);
  const newDeadline = plausibleDeadline(req.body.statutory_deadline);
  const deadline = newDeadline ?? c.statutory_deadline;
  const signals = { case_id: c.id, case_opened_on: c.created_at.slice(0, 10), public_safety_flag: !!req.body.public_safety_flag,
                    vulnerable_victim: !!req.body.vulnerable_victim, missing_critical_evidence: !!req.body.missing_critical_evidence,
                    statutory_deadline: deadline };
  const assessment = scoreCase(signals);
  c.priority = assessment;
  c.priority_signals = signals;
  if (newDeadline && newDeadline !== c.statutory_deadline) c.statutory_deadline = newDeadline;
  c.updated_at = nowISO();
  save();
  audit(user, "case.priority_scored", "case", c.id, { level: assessment.level, score: assessment.score });
  return assessment;
});

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

route("GET", "/cases/{case_id}/parties", (req) => {
  requireRole(req.user(), STAFF);
  return partiesOf(caseOr404(req.params.case_id).id);
});

route("POST", "/cases/{case_id}/parties", async (req) => {
  const user = requireRole(req.user(), CASE_EDITORS);
  const c = caseOr404(req.params.case_id);
  const role = oneOf(req.body.role, HEARING_ROLES, "role")!;
  let person;
  if (req.body.person_id) {
    person = db().people.find((p) => p.id === req.body.person_id);
    if (!person) throw new HttpError(404, "Person not found.");
  } else if (req.body.new_person) {
    person = await createPersonFrom(req.body.new_person, role);
  } else {
    throw new HttpError(422, "Provide either person_id or new_person.");
  }
  addParty(c.id, person.id, role);
  audit(user, "case.party_added", "case", c.id, { person_id: person.id, role });
  return new Status(201, { person: personView(person), role });
});

route("DELETE", "/cases/{case_id}/parties/{person_id}", (req) => {
  const user = requireRole(req.user(), CASE_BUILDERS);
  const c = caseOr404(req.params.case_id);
  const pid = notFoundUnlessUuid(req.params.person_id, "Person");
  const before = db().parties.length;
  db().parties = db().parties.filter((p) => !(p.case_id === c.id && p.person_id === pid));
  if (db().parties.length === before) throw new HttpError(404, "Party not found on this case.");
  save();
  audit(user, "case.party_removed", "case", c.id, { person_id: pid });
  return new Status(204);
});

// ---------------------------------------------------------------------------
// Timeline + extraction
// ---------------------------------------------------------------------------

route("POST", "/cases/{case_id}/timeline", (req) => {
  const user = requireRole(req.user(), CASE_EDITORS);
  const c = caseOr404(req.params.case_id);
  const description = str(req.body, "description", { required: true, min: 3, max: 2000 })!;
  c.timeline.push({ id: uuid(), case_id: c.id, event_date: isoDate(req.body.event_date, "event_date"), description,
                    source_document_id: null, source_label: `Added by ${user.full_name}`, entity_type: "manual", created_at: nowISO() });
  save();
  audit(user, "case.timeline_added", "case", c.id, { description: description.slice(0, 200) });
  return new Status(201, c.timeline);
});

route("DELETE", "/cases/{case_id}/timeline/{event_id}", (req) => {
  const user = requireRole(req.user(), CASE_BUILDERS);
  const c = caseOr404(req.params.case_id);
  const before = c.timeline.length;
  c.timeline = c.timeline.filter((t) => t.id !== req.params.event_id);
  if (c.timeline.length === before) throw new HttpError(404, "Timeline event not found.");
  save();
  audit(user, "case.timeline_removed", "case", c.id, { event_id: req.params.event_id });
  return new Status(204);
});

route("POST", "/cases/{case_id}/extract", async (req) => {
  const user = requireRole(req.user(), CASE_EDITORS);
  const c = caseOr404(req.params.case_id);
  const label = str(req.body, "document_label", { required: true, min: 2, max: 200 })!;
  const raw = str(req.body, "raw_text", { required: true, min: 10, max: 200_000 })!;
  const result = await runCaseIntelligence(c.id, raw);
  for (const e of result.timeline_events.slice(0, 60)) {
    c.timeline.push({ id: uuid(), case_id: c.id, event_date: e.event_date ? parseDate(e.event_date) : null, description: e.description,
                      source_document_id: null, source_label: label, entity_type: "event", created_at: nowISO() });
  }
  save();
  audit(user, "case.intelligence_extracted", "case", c.id, { label, entities: result.entities.length });
  return { entities: result.entities, charges_mentioned: result.charges_mentioned, offence_mentions: result.offence_mentions,
           legal_references: result.legal_references, timeline_events: result.timeline_events, warnings: result.warnings,
           ai_used: result.offence_mentions.length > 0 };
});

function sourceText(c: CaseRow, ref: string): [string, string] {
  const [kind, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
  if (kind === "evidence") {
    const ev = db().evidence.find((e) => e.id === id);
    if (!ev || ev.case_id !== c.id) throw new HttpError(404, "Evidence not found on this case.");
    return [ev.label, ev.text ?? ""];
  }
  if (kind === "statement") {
    const st = db().statements.find((s) => s.id === id);
    if (!st || st.case_id !== c.id) throw new HttpError(404, "Statement not found on this case.");
    return [`Statement: ${st.person_name ?? st.role}`, st.transcript ?? ""];
  }
  throw new HttpError(422, "Sources must look like 'evidence:<id>' or 'statement:<id>'.");
}

route("POST", "/cases/{case_id}/compare", async (req) => {
  const user = requireRole(req.user(), STAFF);
  const c = caseOr404(req.params.case_id);
  const [la, ta] = sourceText(c, String(req.body.source_a ?? ""));
  const [lb, tb] = sourceText(c, String(req.body.source_b ?? ""));
  if (ta.trim().length < 20 || tb.trim().length < 20) throw new HttpError(422, "Both sources need extracted text to compare. Wait for processing to finish.");
  audit(user, "case.sources_compared", "case", c.id, { a: req.body.source_a, b: req.body.source_b });
  return compareSources(la, ta, lb, tb);
});

// ---------------------------------------------------------------------------
// Similar & related cases
// ---------------------------------------------------------------------------

const semanticText = (c: CaseRow) => [c.title, c.description ?? "", ...c.timeline.slice(0, 20).map((t) => t.description)].filter(Boolean).join("\n");

route("GET", "/cases/{case_id}/similar", async (req) => {
  requireRole(req.user(), STAFF);
  const c = caseOr404(req.params.case_id);
  const text = [c.title, c.description ?? "", ...c.timeline.slice(0, 50).map((t) => t.description)].filter(Boolean).join("\n");
  const others = [...db().cases].filter((o) => o.id !== c.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 150);
  let meanings: number[] | null = null;
  let warming = false;
  try {
    const v = await embedDocument(semanticText(c).slice(0, 1500), false);
    const vs = await embed(others.map((o) => semanticText(o).slice(0, 1500)), false);
    meanings = vs.map((x) => dot(x, v));
  } catch (e) {
    if (!(e instanceof ModelUnavailable)) throw e;
    warming = true;
  }
  const ranked = others.map((o, i) => {
    const wording = round(tokenSimilarity(text, [o.title, o.description ?? ""].join("\n")));
    const meaning = meanings ? round(Math.max(meanings[i], 0)) : null;
    const scaled = Math.min(1, wording / 0.4);
    return { o, meaning, wording, relevance: meaning !== null ? 0.7 * meaning + 0.3 * scaled : scaled };
  }).filter((r) => !((r.meaning ?? 0) < 0.55 && r.wording < 0.25)).sort((a, b) => b.relevance - a.relevance).slice(0, 8);
  const items = ranked.map(({ o, meaning, wording, relevance }) => {
    const reasons: string[] = [];
    if (meaning !== null && meaning >= 0.55) reasons.push(`similar meaning (${Math.round(meaning * 100)}%)`);
    if (wording >= 0.25) reasons.push(`shared wording (${Math.round(wording * 100)}%)`);
    const reason = reasons.join(" and ") || "related wording";
    return { case_id: o.id, case_number: o.case_number, title: o.title, status: o.status, case_type: o.case_type,
             relevance: round(relevance), meaning, wording, reason: reason[0].toUpperCase() + reason.slice(1) + "." };
  });
  return { source: "fallback", items, methods: warming ? ["wording"] : ["meaning", "wording"], meaning_model_warming: warming,
           note: "Leads for review only -- similarity says nothing about the outcome of either case." };
});

route("GET", "/cases/{case_id}/related", (req) => {
  requireRole(req.user(), STAFF);
  const c = caseOr404(req.params.case_id);
  const shared_parties = partiesOf(c.id).flatMap(({ person }) => casesForPerson(person.id).filter((o) => o.case_id !== c.id).map((o) => ({
    person_id: person.id, person_name: person.full_name, role_in_other_case: o.role, case_id: o.case_id,
    case_number: o.case_number, title: o.title, status: o.status,
  })));
  // Cases whose saved research cites the same law articles.
  const refs = (caseId: string) => new Set(db().notes.filter((n) => n.case_id === caseId).flatMap((n) => n.citations.map((x: any) =>
    `${x.source_title ?? ""} | ${x.article_label ?? x.article ?? ""}`.replace(/^[\s|]+|[\s|]+$/g, ""))).filter(Boolean));
  const mine = refs(c.id);
  const shared_citations = mine.size ? db().cases.filter((o) => o.id !== c.id).map((o) => {
    const common = [...refs(o.id)].filter((r) => mine.has(r));
    return common.length ? { case_id: o.id, case_number: o.case_number, title: o.title, citations: common } : null;
  }).filter(Boolean) : [];
  return { source: "fallback", shared_parties, shared_citations, note: "Connections are leads for a human to review, not conclusions." };
});

// ---------------------------------------------------------------------------
// Case brief: quoted key facts + an optional checked draft
// ---------------------------------------------------------------------------

async function gatherBrief(c: CaseRow) {
  const sections: any[] = [];
  const offences = new Map<string, any>();
  const references = new Map<string, any>();
  const addOffences = (mentions: any[] | undefined, source: string) => {
    for (const m of mentions ?? []) {
      const entry = offences.get(m.offence) ?? { offence: m.offence, label_en: m.label_en, label_ar: m.label_ar, sources: [], example: m.sentence };
      if (!entry.sources.includes(source)) entry.sources.push(source);
      offences.set(m.offence, entry);
    }
  };
  const best = (s: any[]) => [...s].sort((a, b) => (a.rank ?? a.index) - (b.rank ?? b.index)).slice(0, 2).sort((a, b) => a.index - b.index).map((x) => x.text);
  if ((c.description ?? "").trim()) {
    const summary = await extractiveSummary(c.description!, 3, 700, false);
    if (summary.sentences.length) {
      sections.push({ kind: "case", label: "Case description", label_ar: "وصف القضية", ref: null, sentences: summary.sentences.map((s) => s.text), method: summary.method });
    }
  }
  let evidenceSections = 0;
  for (const ev of db().evidence.filter((e) => e.case_id === c.id).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).slice(0, 16)) {
    const info = ev.ai_summary ?? {};
    const sentences = best(info.summary?.sentences ?? []);
    if (!sentences.length) continue;
    sections.push({ kind: "evidence", label: ev.label, label_ar: ev.label, ref: `evidence:${ev.id}`, sentences, method: info.summary?.method });
    addOffences(info.offence_mentions, ev.label);
    for (const r of info.legal_references ?? []) if (!references.has(r.reference.toLowerCase())) references.set(r.reference.toLowerCase(), { ...r, source: ev.label });
    if (++evidenceSections >= 8) break;
  }
  for (const st of statementsForCase(c.id).slice(0, 8)) {
    const label = `Statement: ${st.person_name ?? st.role}`;
    let sentences = best(st.summary?.sentences ?? []);
    if (!sentences.length && (st.transcript ?? "").trim()) sentences = (await extractiveSummary(st.transcript!, 2, 1400, false)).sentences.map((s) => s.text);
    if (sentences.length) sections.push({ kind: "statement", label, label_ar: `إفادة: ${st.person_name ?? st.role}`, ref: `statement:${st.id}`, sentences });
    addOffences(st.offence_mentions, label);
  }
  const timeline = c.timeline.filter((t) => t.event_date).sort((a, b) => a.event_date!.localeCompare(b.event_date!)).slice(0, 12)
    .map((t) => ({ date: t.event_date, description: t.description.slice(0, 300), source: t.source_label }));
  return {
    case_id: c.id, sections, timeline,
    offence_mentions: [...offences.values()].sort((a, b) => b.sources.length - a.sources.length),
    legal_references: [...references.values()].slice(0, 20), notes: [] as string[], generated_at: nowISO(),
    disclaimer: "Key sentences are quoted from the file. Offence mentions show where a topic is discussed; they are not charges and say nothing about whether anything happened.",
  };
}

const BRIEF_SYSTEM_EN = `You write a short, neutral case brief for a judge, using ONLY the numbered notes below.
Rules:
1. At most one sentence per note and at most 6 sentences in total, in plain English.
2. Attribute each point to where it comes from ("the police report states...", "the witness said...").
3. Do not add facts, names, dates or numbers that are not in the notes. If a party's position is not in the notes, do not describe one.
4. Never say or imply that anyone is guilty, innocent, lying or credible, never say what the case "hinges on", and never recommend a decision.
5. Write plain sentences: no markdown, no headings, no bullet points and no numbering.`;
const BRIEF_SYSTEM_AR = `اكتب ملخصاً محايداً وقصيراً للقضية موجهاً للقاضي، معتمداً فقط على الملاحظات المرقمة أدناه.
القواعد:
1. جملة واحدة على الأكثر لكل ملاحظة، وست جمل على الأكثر إجمالاً، باللغة العربية الفصحى فقط.
2. انسب كل معلومة إلى مصدرها (مثل: "يذكر محضر الشرطة..."، "أفاد الشاهد...").
3. لا تضف وقائع أو أسماء أو تواريخ أو أرقاماً غير موجودة في الملاحظات، وإذا لم يرد موقف أحد الأطراف فلا تصفه.
4. لا تذكر ولا تلمح إلى أن أحداً مدان أو بريء أو كاذب أو صادق، ولا تحدد ما تتوقف عليه القضية، ولا توصِ بأي قرار.
5. اكتب جملاً عادية دون تنسيق أو عناوين أو نقاط أو ترقيم.`;

route("GET", "/cases/{case_id}/brief", async (req) => {
  requireRole(req.user(), STAFF);
  return gatherBrief(caseOr404(req.params.case_id));
});

route("POST", "/cases/{case_id}/brief/stream", async (req) => {
  const user = requireRole(req.user(), STAFF);
  const c = caseOr404(req.params.case_id);
  const lang = req.query.get("lang") === "ar" ? "ar" : "en";
  const brief = await gatherBrief(c);
  audit(user, "case.brief_drafted", "case", c.id, { language: lang });
  async function* events(): AsyncGenerator<[string, unknown]> {
    yield ["sources", brief];
    const sources = brief.sections.map((s: any) => `${s.label}: ${s.sentences.join(" ")}`).slice(0, 10);
    if (brief.sections.reduce((a: number, s: any) => a + s.sentences.length, 0) < 3) {
      yield ["final", { status: "no_sources", draft: "", reason: "The file has too little text for a useful draft yet -- the key facts above are the whole file." }];
      return;
    }
    const numbered = sources.map((t: string, i: number) => `[${i + 1}] ${t}`).join("\n");
    const header = `${c.case_number} — ${c.title}`;
    const messages = [{ role: "system", content: lang === "ar" ? BRIEF_SYSTEM_AR : BRIEF_SYSTEM_EN },
                      { role: "user", content: lang === "ar" ? `القضية: ${header}\n\nالملاحظات:\n${numbered}` : `Case: ${header}\n\nNotes:\n${numbered}` }];
    try {
      for await (const [kind, payload] of streamGroundedDraft(messages, sources, lang, 380)) {
        if (kind !== "draft") { yield [kind, payload]; continue; }
        const p: any = payload;
        if (p.status === "ok") {
          yield ["final", { status: "ok", draft: p.text, grounding: p.grounding, model: p.model, unsupported: p.unsupported,
            reason: "Draft by a small local model, checked against the key facts above. Sentences that match no note are marked, and so are figures the notes don't contain. It can still join two facts that belong apart, so read it against the notes below." }];
        } else {
          yield ["final", { status: p.status, draft: "", reason: `${p.reason} The quoted key facts above are unaffected.` }];
        }
      }
    } catch (e) {
      console.error("case brief draft failed", e);
      yield ["final", { status: "error", draft: "", reason: "The draft could not be written just now." }];
    }
  }
  return new Sse(events());
});

// ---------------------------------------------------------------------------
// Research notes, statements, audit, ruling
// ---------------------------------------------------------------------------

route("GET", "/cases/{case_id}/research-notes", (req) => {
  requireRole(req.user(), STAFF);
  const c = caseOr404(req.params.case_id);
  return db().notes.filter((n) => n.case_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
});

route("POST", "/cases/{case_id}/research-notes", (req) => {
  const user = requireRole(req.user(), STAFF);
  const c = caseOr404(req.params.case_id);
  const question = str(req.body, "question", { required: true, min: 3, max: 4000 })!;
  const citations = Array.isArray(req.body.citations) ? req.body.citations.slice(0, 20) : [];
  const confidence = Math.max(0, Math.min(1, Number(req.body.confidence ?? 0) || 0));
  const note = { id: uuid(), case_id: c.id, question, answer: String(req.body.answer ?? "").slice(0, 40000), citations, confidence,
                 needs_human_review: req.body.needs_human_review !== false, created_by: user.id, created_at: nowISO() };
  db().notes.push(note);
  save();
  audit(user, "case.research_saved", "case", c.id, { note_id: note.id });
  return new Status(201, note);
});

route("GET", "/cases/{case_id}/statements", (req) => {
  requireRole(req.user(), STAFF);
  const c = caseOr404(req.params.case_id);
  return statementsForCase(c.id).map((s) => {
    const { live_segments: _l, ...rest } = statementView(s);
    return rest;
  });
});

route("GET", "/cases/{case_id}/audit", (req) => {
  requireRole(req.user(), ["judge", "clerk", "admin", "case_officer"]);
  const c = caseOr404(req.params.case_id);
  const items = db().audit.filter((a) => a.entity_type === "case" && a.entity_id === c.id).sort((a, b) => b.id - a.id);
  return { items: items.slice(0, 200), total: items.length };
});

route("GET", "/cases/{case_id}/ruling", (req) => {
  requireRole(req.user(), STAFF);
  const c = caseOr404(req.params.case_id);
  const r = db().rulings.find((x) => x.case_id === c.id);
  if (!r) return null;
  return { ...r, entered_by_name: db().users.find((u) => u.id === r.entered_by)?.full_name ?? null };
});

route("POST", "/cases/{case_id}/ruling", (req) => {
  // Only a judge can enter a ruling, and it is always attributed to the signed-in judge.
  const judge = requireRole(req.user(), ["judge"]);
  const c = caseOr404(req.params.case_id);
  const text = str(req.body, "ruling_text", { required: true, min: 20, max: 100_000 })!;
  const refs = Array.isArray(req.body.ai_assisted_research_refs) ? req.body.ai_assisted_research_refs.slice(0, 50).map(String) : [];
  const ruling = { case_id: c.id, entered_by: judge.id, ruling_text: text, entered_at: nowISO(), ai_assisted_research_refs: refs };
  db().rulings = db().rulings.filter((r) => r.case_id !== c.id);
  db().rulings.push(ruling);
  if (req.body.close_case !== false) Object.assign(c, { status: "resolved", closed_at: nowISO(), updated_at: nowISO() });
  save();
  audit(judge, "case.ruling_entered", "case", c.id, { length: text.length });
  return { ...ruling, entered_by_name: judge.full_name };
});

export { isUuid, rateHit };
