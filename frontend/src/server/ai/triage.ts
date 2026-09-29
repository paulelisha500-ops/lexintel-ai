/**
 * Case priority (app/agents/prioritization_agent.py) and complaint intake
 * triage (app/agents/graph_orchestrator.py + app/ai/classifier.py): a
 * nearest-neighbour classifier over the meaning model that learns from staff
 * decisions, a bilingual keyword fallback, duplicate detection and priority.
 * Every output is a suggestion with a visible explanation for a human.
 */
import { KEYWORDS, SEED_EXAMPLES } from "./data";
import { dot, embed, meanVector, ModelUnavailable } from "./models";
import { round, splitSentences, tokenSimilarity } from "./text";

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export const PRIORITY_WEIGHTS = {
  public_safety_flag: 0.3,
  days_to_statutory_deadline: 0.25,
  vulnerable_victim: 0.2,
  missing_critical_evidence: -0.15,
  days_case_open: 0.1,
};

export interface CaseSignals {
  case_id: string;
  public_safety_flag?: boolean;
  statutory_deadline?: string | null;
  vulnerable_victim?: boolean;
  missing_critical_evidence?: boolean;
  case_opened_on?: string;
}

export function todayISO(): string {
  const d = new Date(Date.now() + 4 * 3600 * 1000); // UAE (UTC+4)
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);
}

export function scoreCase(signals: CaseSignals) {
  const w = PRIORITY_WEIGHTS;
  const today = todayISO();
  const factors: Record<string, number> = {};
  factors.public_safety_flag = signals.public_safety_flag ? w.public_safety_flag : 0;
  let daysLeft: number | null = null;
  if (signals.statutory_deadline) {
    daysLeft = daysBetween(today, signals.statutory_deadline);
    const urgency = daysLeft <= 0 ? 1 : daysLeft <= 30 ? (30 - daysLeft) / 30 : 0;
    factors.approaching_statutory_deadline = w.days_to_statutory_deadline * urgency;
  } else {
    factors.approaching_statutory_deadline = 0;
  }
  factors.vulnerable_victim = signals.vulnerable_victim ? w.vulnerable_victim : 0;
  factors.missing_critical_evidence = signals.missing_critical_evidence ? w.missing_critical_evidence : 0;
  const ageDays = Math.max(0, daysBetween(signals.case_opened_on ?? today, today));
  factors.case_age = w.days_case_open * Math.min(1, ageDays / 180);
  const total = Object.values(factors).reduce((a, b) => a + b, 0);
  const level = total >= 0.5 ? "high" : total >= 0.25 ? "medium" : "low";
  const parts: string[] = [];
  if (factors.public_safety_flag > 0) parts.push("an active public-safety flag");
  if (factors.approaching_statutory_deadline > 0) {
    parts.push(daysLeft !== null && daysLeft <= 0 ? "a statutory deadline that has passed" : `a statutory deadline in ${daysLeft} days`);
  }
  if (factors.vulnerable_victim > 0) parts.push("a vulnerable victim on record");
  if (factors.missing_critical_evidence < 0) parts.push("critical evidence still missing (flagged for human review)");
  if (factors.case_age > w.days_case_open * 0.5) parts.push(`the case has been open ${ageDays} days`);
  const explanation = `Recommended as ${level.toUpperCase()} priority based on: ${parts.length ? parts.join(", ") : "no elevated-priority factors"}. `
    + "This is a workload recommendation only -- it reflects nothing about the merits of the case or any party's guilt.";
  return {
    case_id: signals.case_id,
    level: level as "high" | "medium" | "low",
    score: round(total, 3),
    factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, round(v, 3)])),
    explanation,
    generated_at: new Date().toISOString(),
    requires_human_review: !!signals.missing_critical_evidence,
  };
}

// ---------------------------------------------------------------------------
// Complaint classification
// ---------------------------------------------------------------------------

export const CATEGORIES = ["criminal", "civil", "cybercrime", "traffic", "grievance"] as const;

export const DEFAULT_DEPARTMENTS: Record<string, string> = {
  criminal: "Public Prosecution",
  cybercrime: "Police - Cybercrime Unit",
  traffic: "Traffic Department",
  civil: "Civil Courts - Case Management Office",
  grievance: "Government Services Grievance Office",
};

export function keywordClassify(text: string, citizen?: string | null): [string, number, string] {
  const lowered = text.toLowerCase();
  const scores: Record<string, number> = {};
  const matched: Record<string, string[]> = {};
  for (const [category, words] of Object.entries(KEYWORDS)) {
    const hits = words.filter((w) => lowered.includes(w));
    if (hits.length) { scores[category] = hits.length; matched[category] = hits.slice(0, 4); }
  }
  if (!Object.keys(scores).length) {
    const fallback = citizen && (CATEGORIES as readonly string[]).includes(citizen) ? citizen : "grievance";
    return [fallback, 0.35, "No strong keyword signal; kept the category chosen by the citizen."];
  }
  const best = Object.keys(scores).sort((a, b) => scores[b] - scores[a] || Number(b === citizen) - Number(a === citizen))[0];
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  return [best, round(Math.min(0.8, 0.4 + (0.4 * scores[best]) / total)), `Keyword match (${matched[best].join(", ")}).`];
}

/** One vector for a long text: normalised mean of sentence groups (embeddings.embed_document). */
export async function embedDocument(text: string, wait = true): Promise<Float32Array> {
  const sentences = splitSentences(text, 36);
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) chunks.push(sentences.slice(i, i + 3).join(" "));
  const vectors = await embed(chunks.slice(0, 12).length ? chunks.slice(0, 12) : [text.slice(0, 1000)], wait);
  return meanVector(vectors);
}

async function semanticClassify(text: string, citizen: string | null | undefined, learned: [string, string][]) {
  const examples: [string, string, string][] = [
    ...Object.entries(SEED_EXAMPLES).flatMap(([cat, texts]) => texts.map((t) => [t, cat, "example"] as [string, string, string])),
    ...learned.filter(([t, c]) => t && (CATEGORIES as readonly string[]).includes(c)).map(([t, c]) => [t.slice(0, 1000), c, "staff decision"] as [string, string, string]),
  ].filter((e) => e[0] !== text.slice(0, 1000));
  const matrix = await embed(examples.map((e) => e[0]));
  const query = await embedDocument(text);
  const sims = matrix.map((v) => dot(v, query));
  const categoryScores: Record<string, number> = {};
  for (const cat of CATEGORIES) {
    const catSims = sims.filter((_, i) => examples[i][1] === cat).sort((a, b) => b - a).slice(0, 3);
    categoryScores[cat] = catSims.length ? catSims.reduce((a, b) => a + b, 0) / catSims.length : 0;
  }
  const maxScore = Math.max(...Object.values(categoryScores));
  const exps = Object.fromEntries(Object.entries(categoryScores).map(([c, s]) => [c, Math.exp((s - maxScore) / 0.08)]));
  const total = Object.values(exps).reduce((a, b) => a + b, 0);
  const probabilities = Object.fromEntries(Object.entries(exps).map(([c, v]) => [c, round(v / total, 3)]));
  const ranked = Object.keys(probabilities).sort((a, b) => probabilities[b] - probabilities[a]);
  const best = ranked[0];
  const neighbours = sims.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([s, i]) => ({
    text: examples[i][0].slice(0, 180), category: examples[i][1], similarity: round(s), source: examples[i][2],
  }));
  let chosen: string, confidence: number, reason: string;
  if (categoryScores[best] < 0.28) {
    chosen = citizen && (CATEGORIES as readonly string[]).includes(citizen) ? citizen : best;
    confidence = 0.3;
    reason = "Nothing in the examples or earlier decisions closely resembles this complaint, so the category chosen by the citizen was kept.";
  } else {
    chosen = best;
    confidence = Math.min(0.95, probabilities[best]);
    const runner = ranked[1];
    reason = `Closest to earlier ${best} complaints (similarity ${categoryScores[best].toFixed(2)}); next most likely: ${runner} (${Math.round(probabilities[runner] * 100)}%).`;
  }
  return { case_type: chosen, confidence: round(confidence), reason,
           details: { method: "semantic", model: "paraphrase-multilingual-MiniLM-L12-v2", probabilities, neighbours, learned_examples: learned.length } };
}

const isLikelyDuplicate = (c: { meaning: number | null; wording: number }) =>
  c.wording >= 0.75 || (c.meaning !== null && (c.meaning >= 0.7 || (c.meaning >= 0.65 && c.wording >= 0.25)));
const isCandidate = (c: { meaning: number | null; wording: number }) => c.wording >= 0.35 || (c.meaning !== null && c.meaning >= 0.6);

export interface TriageInput {
  id: string;
  text: string;
  citizenCategory: string;
  submittedOn: string;
  others: { id: string; text: string; reference_number: string | null }[];
  learned: [string, string][];
}

export async function triageComplaint(input: TriageInput) {
  const { text, citizenCategory } = input;
  const [kwType, kwConfidence, kwReason] = keywordClassify(text, citizenCategory);
  let caseType: string, confidence: number, reason: string, source: "semantic" | "keywords", details: Record<string, unknown>;
  try {
    const r = await semanticClassify(text, citizenCategory, input.learned);
    caseType = r.case_type; confidence = r.confidence; reason = r.reason; source = "semantic";
    if (kwConfidence > 0.35 && kwType === caseType) {
      confidence = Math.min(0.95, confidence + 0.1);
      reason += ` Keywords agree (${kwReason.replace(/^Keyword match /, "").replace(/^\(|\)\.?$/g, "")}).`;
    }
    details = { ...r.details, keyword_suggestion: kwType };
  } catch (e) {
    if (!(e instanceof ModelUnavailable)) throw e;
    caseType = kwType; confidence = kwConfidence; source = "keywords";
    reason = `${kwReason} The meaning-matching model is unavailable, so this is a keyword-based suggestion.`;
    details = { method: "keywords", error: String(e.message).slice(0, 200) };
  }

  // Duplicates: meaning + wording against earlier complaints.
  let candidates: { id: string; reference_number: string | null; meaning: number | null; wording: number; similarity: number }[] = [];
  if (input.others.length) {
    let meanings: number[] | null = null;
    try {
      const q = await embedDocument(text);
      const vs = await Promise.all(input.others.map((o) => embedDocument(o.text)));
      meanings = vs.map((v) => dot(v, q));
    } catch (e) {
      if (!(e instanceof ModelUnavailable)) throw e;
    }
    candidates = input.others.map((o, n) => {
      const wording = round(tokenSimilarity(text, o.text));
      const meaning = meanings ? round(meanings[n]) : null;
      return { id: o.id, reference_number: o.reference_number, meaning, wording, similarity: meaning ?? wording };
    }).sort((a, b) => b.similarity - a.similarity).slice(0, 3).filter(isCandidate);
  }
  const likely = candidates.find(isLikelyDuplicate) ?? null;
  if (likely) {
    const basis = likely.meaning !== null ? `same meaning ${Math.round(likely.meaning * 100)}%` : `text overlap ${Math.round(likely.similarity * 100)}%`;
    reason += ` Possible duplicate of ${likely.reference_number} (${basis}).`;
  }

  const lowered = text.toLowerCase();
  const priority = scoreCase({
    case_id: input.id,
    public_safety_flag: ["criminal", "cybercrime"].includes(caseType) && ["threat", "weapon", "violence", "تهديد", "سلاح", "عنف", "knife", "attack"].some((w) => lowered.includes(w)),
    vulnerable_victim: ["child", "minor", "elderly", "disabled", "طفل", "قاصر", "كبير السن"].some((w) => lowered.includes(w)),
    missing_critical_evidence: false,
    case_opened_on: input.submittedOn,
  });
  return {
    ai_status: source === "semantic" ? "done" : "fallback",
    ai_details: { ...details, priority_explanation: priority.explanation },
    ai_suggested_category: caseType,
    ai_suggested_department: DEFAULT_DEPARTMENTS[caseType],
    ai_confidence: round(confidence),
    ai_explanation: reason.trim(),
    ai_priority_level: priority.level,
    duplicate_candidates: candidates,
    ai_duplicate_of: likely?.id ?? null,
  };
}
