/** Legal research (sources first, then an optional checked draft) and the Law Library that feeds it. */
import { keyPassages } from "../ai/analysis";
import { sha256Hex } from "../ai/documents";
import { streamGroundedDraft } from "../ai/drafting";
import { inForce, retrieve, type Hit } from "../ai/law";
import { languageOf } from "../ai/text";
import { audit, HttpError, LIBRARIANS, notFoundUnlessUuid, nowISO, rateHit, requireRole, STAFF, uuid } from "../core";
import { dispatch } from "../jobs";
import { isoDate, oneOf, Raw, route, Sse, Status } from "../router";
import { db, files, save, type LawRow } from "../store";
import { JURISDICTIONS } from "../views";
import { uploadedFile } from "./evidence";

const SYSTEM_EN = "You answer questions about UAE law for lawyers, prosecutors and judges. Answer ONLY from the law text the user gives you. "
  + "Write 2 to 4 short sentences in your own words that directly answer the question. If the law text does not answer it, say so in one sentence. "
  + "Do not list the sources, do not add anything that is not in the law text, never predict how a case will be decided, never advise on strategy, "
  + "and never comment on anyone's guilt or credibility. Write plain sentences: no markdown, no headings, no bullet points and no numbering.";
const SYSTEM_AR = "أنت تجيب عن أسئلة حول القانون الإماراتي للمحامين وأعضاء النيابة والقضاة. أجب فقط من نص القانون الذي يقدمه المستخدم. "
  + "اكتب من جملتين إلى أربع جمل قصيرة باللغة العربية الفصحى فقط تجيب عن السؤال مباشرة. إذا لم يجب نص القانون عن السؤال فقل ذلك في جملة واحدة. "
  + "لا تسرد المصادر، ولا تضف أي شيء غير موجود في نص القانون، ولا تتنبأ بنتيجة أي قضية، ولا تقدم نصائح بشأن الاستراتيجية، ولا تعلق على إدانة أحد أو مصداقيته. "
  + "اكتب جملاً عادية دون تنسيق أو عناوين أو نقاط أو ترقيم.";
const FREE_ZONES: Record<string, [string, string]> = { difc: ["DIFC law", "قانون مركز دبي المالي العالمي"], adgm: ["ADGM law", "قانون سوق أبوظبي العالمي"] };

const citation = (h: Hit) => ({
  source_title: h.law.title, article: h.article, article_label: h.label || `Art. ${h.article}`, url: h.law.source_url ?? "",
  effective_from: h.law.effective_from, effective_to: h.law.effective_to, jurisdiction: h.law.jurisdiction, law_document_id: h.law.id,
  excerpt: h.text.slice(0, 700),
});

const corpusAvailable = () => db().laws.some((l) => l.status === "indexed" && l.articles.length);

interface Prepared { public: Record<string, any>; docs: Hit[] }

async function prepare(question: string, asOf: string | null, jurisdiction: string | null): Promise<Prepared> {
  const base = { question, as_of_date: asOf ?? new Date().toISOString().slice(0, 10), language: languageOf(question), answer: "", grounding: null };
  if (!corpusAvailable()) {
    return { docs: [], public: { ...base, status: "no_corpus", answer_status: "no_corpus", citations: [], key_passages: [], confidence: 0,
      needs_human_review: true, retrieval_sources: [], review_reason: "The Law Library is empty. Upload official law PDFs in the Law Library to enable research." } };
  }
  const { hits, sources } = await retrieve(question, db().laws, jurisdiction);
  const docs = inForce(hits, asOf);
  if (!docs.length) {
    return { docs: [], public: { ...base, status: "ok", answer_status: "no_sources", citations: [], key_passages: [], confidence: 0,
      needs_human_review: true, retrieval_sources: sources, review_reason: "No in-force article in the Law Library matched this question." } };
  }
  const passages = await keyPassages(question, docs.map((d) => d.text), 4);
  return { docs, public: {
    ...base, status: "ok", answer_status: "sources_only", citations: docs.map(citation),
    key_passages: passages.passages.map((p) => ({ ...p, source_number: p.source_index + 1 })), key_passages_method: passages.method,
    confidence: Math.round(Math.min(0.95, 0.3 + 0.1 * docs.length) * 100) / 100, needs_human_review: true,
    review_reason: "These are the most relevant in-force articles. Read them in full before relying on them.", retrieval_sources: sources,
  } };
}

async function* answer(prepared: Prepared): AsyncGenerator<[string, unknown]> {
  const p = prepared.public;
  if (p.answer_status !== "sources_only") { yield ["final", p]; return; }
  const arabic = p.language === "ar";
  const docs = prepared.docs.slice(0, 4);
  const lawText = docs.map((d, i) => {
    const zone = FREE_ZONES[p.citations[i].jurisdiction];
    const text = d.text.slice(0, 1100).trim();
    return zone ? `(${arabic ? zone[1] : zone[0]}) ${text}` : text;
  }).join("\n\n");
  const user = arabic ? `نص القانون:\n${lawText}\n\nالسؤال: ${p.question}\nالإجابة:` : `Law text:\n${lawText}\n\nQuestion: ${p.question}\nAnswer:`;
  const messages = [{ role: "system", content: arabic ? SYSTEM_AR : SYSTEM_EN }, { role: "user", content: user }];
  for await (const [kind, payload] of streamGroundedDraft(messages, docs.map((d) => d.text), p.language, 450, 0.34)) {
    if (kind !== "draft") { yield [kind, payload]; continue; }
    const r: any = payload;
    if (r.status !== "ok") {
      yield ["final", { ...p, answer: "", answer_status: r.status, needs_human_review: true,
                        review_reason: `${r.reason} The most relevant in-force articles and key passages are shown instead.` }];
      return;
    }
    let reason = "Draft written by a small local model and checked against the sources: sentences that match no source are marked, "
      + "and so are figures the sources don't contain. It can still join two points that belong apart, so read the cited articles before relying on it.";
    if (r.unsupported) reason = `${r.unsupported} sentence(s) could not be matched to any source and are marked. ${reason}`;
    yield ["final", { ...p, answer: r.text, answer_status: "ok", grounding: r.grounding, model: r.model, needs_human_review: true, review_reason: reason }];
  }
}

function readQuery(body: any) {
  const question = String(body.question ?? "").trim();
  if (question.length < 3 || question.length > 4000) throw new HttpError(422, "question: String should have at least 3 characters");
  const jurisdiction = body.jurisdiction ? oneOf(body.jurisdiction, JURISDICTIONS, "jurisdiction") : null;
  return { question, asOf: isoDate(body.as_of_date, "as_of_date"), jurisdiction };
}

route("POST", "/research/ask", async (req) => {
  const user = requireRole(req.user(), STAFF);
  if (!rateHit(`research:${user.id}`, 60, 3600)) throw new HttpError(429, "Research limit reached for this hour. Please try again later.");
  const { question, asOf, jurisdiction } = readQuery(req.body);
  const prepared = await prepare(question, asOf, jurisdiction);
  let result = prepared.public;
  if (req.body.write !== false) for await (const [kind, payload] of answer(prepared)) if (kind === "final") result = payload as any;
  audit(user, "research.asked", "research", null, { question: question.slice(0, 300), status: result.answer_status, citations: result.citations?.length ?? 0 });
  return result;
});

route("POST", "/research/ask/stream", (req) => {
  const user = requireRole(req.user(), STAFF);
  if (!rateHit(`research:${user.id}`, 60, 3600)) throw new HttpError(429, "Research limit reached for this hour. Please try again later.");
  const { question, asOf, jurisdiction } = readQuery(req.body);
  audit(user, "research.asked", "research", null, { question: question.slice(0, 300), stream: true });
  async function* events(): AsyncGenerator<[string, unknown]> {
    yield ["status", { phase: "retrieving" }];
    let prepared: Prepared;
    try {
      prepared = await prepare(question, asOf, jurisdiction);
    } catch (e) {
      console.error("research retrieval failed", e);
      yield ["final", { status: "error", answer_status: "error", citations: [], key_passages: [], answer: "", needs_human_review: true,
                        review_reason: "The law library could not be searched just now. Please try again." }];
      return;
    }
    yield ["sources", prepared.public];
    try {
      yield* answer(prepared);
    } catch (e) {
      console.error("research draft failed", e);
      yield ["final", prepared.public];
    }
  }
  return new Sse(events());
});

// ---------------------------------------------------------------------------
// Law Library
// ---------------------------------------------------------------------------

export function lawView(l: LawRow) {
  const { file_id: _f, articles: _a, ...rest } = l;
  return rest;
}

const lawOr404 = (id: string) => {
  const l = db().laws.find((x) => x.id === notFoundUnlessUuid(id, "Law document"));
  if (!l) throw new HttpError(404, "Law document not found.");
  return l;
};

route("GET", "/library/documents", (req) => {
  requireRole(req.user(), STAFF);
  return [...db().laws].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).map(lawView);
});

route("GET", "/library/stats", (req) => {
  requireRole(req.user(), STAFF);
  const docs = db().laws;
  const byJurisdiction: Record<string, number> = {};
  for (const d of docs) if (d.status === "indexed") byJurisdiction[d.jurisdiction] = (byJurisdiction[d.jurisdiction] ?? 0) + (d.article_count ?? 0);
  return {
    documents: docs.length, indexed_documents: docs.filter((d) => d.status === "indexed").length,
    processing: docs.filter((d) => ["queued", "processing"].includes(d.status)).length, failed: docs.filter((d) => d.status === "failed").length,
    articles: Object.values(byJurisdiction).reduce((a, b) => a + b, 0), articles_by_jurisdiction: byJurisdiction, corpus_available: corpusAvailable(),
  };
});

route("POST", "/library/documents", async (req) => {
  const user = requireRole(req.user(), LIBRARIANS);
  const f = req.form;
  const get = (k: string) => { const v = f?.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
  const title = get("title");
  if (!title || title.length < 3 || title.length > 500) throw new HttpError(422, "title: String should have at least 3 characters");
  const jurisdiction = oneOf(get("jurisdiction"), JURISDICTIONS, "jurisdiction")!;
  const language = oneOf(get("language") ?? "en", ["ar", "en"], "language")!;
  const year = get("year") ? parseInt(get("year")!, 10) : null;
  if (year !== null && (Number.isNaN(year) || year < 1900 || year > 2100)) throw new HttpError(422, "year: Input should be between 1900 and 2100");
  const effectiveFrom = isoDate(get("effective_from"), "effective_from");
  const effectiveTo = isoDate(get("effective_to"), "effective_to");
  const state = oneOf(get("legislation_state") ?? "active", ["active", "amended", "repealed"], "legislation_state")!;
  const sourceUrl = get("source_url");
  if (sourceUrl && !/^https?:\/\//.test(sourceUrl)) throw new HttpError(422, "Source URL must start with http:// or https://");
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) throw new HttpError(422, "'In force until' can't be earlier than 'in force from'.");
  const file = uploadedFile(f, "file", 80, new Set(["pdf", "txt"]));
  const sha = await sha256Hex(file);
  const existing = db().laws.find((l) => l.sha256 === sha);
  if (existing) throw new HttpError(409, `This exact file is already in the library as '${existing.title}'.`);
  const fileId = uuid();
  await files.put(fileId, file);
  const doc: LawRow = {
    id: uuid(), title, law_number: get("law_number"), year, jurisdiction, language, effective_from: effectiveFrom, effective_to: effectiveTo,
    legislation_state: state, source_url: sourceUrl, original_filename: file.name, sha256: sha, size_bytes: file.size, status: "queued",
    error: null, article_count: null, parse_mode: null, uploaded_by: user.id, uploaded_at: nowISO(), indexed_at: null, file_id: fileId, articles: [],
  };
  db().laws.push(doc);
  save();
  audit(user, "library.document_uploaded", "law_document", doc.id, { title, jurisdiction, sha256: sha });
  return new Status(201, { ...lawView(doc), processing_mode: dispatch("ingest_law_document", doc.id) });
});

route("GET", "/library/documents/{doc_id}", (req) => {
  requireRole(req.user(), STAFF);
  return lawView(lawOr404(req.params.doc_id));
});

route("GET", "/library/documents/{doc_id}/articles", (req) => {
  requireRole(req.user(), STAFF);
  const l = lawOr404(req.params.doc_id);
  const articles = l.articles.map((a) => ({ article: a.number, label: a.label, text: a.body }))
    .sort((a, b) => (parseInt(a.article, 10) || 1e9) - (parseInt(b.article, 10) || 1e9));
  return { document: lawView(l), articles };
});

route("GET", "/library/documents/{doc_id}/file", async (req) => {
  requireRole(req.user(), STAFF);
  const l = lawOr404(req.params.doc_id);
  const blob = await files.get(l.file_id);
  if (!blob) throw new HttpError(404, "File not found.");
  return new Raw(blob, l.original_filename.endsWith(".pdf") ? "application/pdf" : "text/plain", l.original_filename);
});

route("POST", "/library/documents/{doc_id}/reindex", (req) => {
  const user = requireRole(req.user(), LIBRARIANS);
  const l = lawOr404(req.params.doc_id);
  Object.assign(l, { status: "queued", error: null });
  save();
  audit(user, "library.document_reindex", "law_document", l.id);
  return { status: "queued", mode: dispatch("ingest_law_document", l.id) };
});

route("DELETE", "/library/documents/{doc_id}", async (req) => {
  const user = requireRole(req.user(), ["admin", "clerk", "case_officer"]);
  const l = lawOr404(req.params.doc_id);
  if (l.status === "processing") throw new HttpError(409, "This document is being indexed right now. Try again when it finishes.");
  db().laws = db().laws.filter((x) => x.id !== l.id);
  save();
  await files.delete(l.file_id).catch(() => undefined);
  audit(user, "library.document_deleted", "law_document", l.id, { title: l.title });
  return new Status(204);
});
