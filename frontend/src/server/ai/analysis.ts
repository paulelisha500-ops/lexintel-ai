/**
 * Reading aids over case text: offence mentions, cited laws, extractive
 * summaries, key passages and the grounding check for written drafts.
 * Ports of app/ai/offences.py, summarize.py and grounding.py -- same
 * thresholds, same fallbacks when the meaning model is not loaded.
 */
import { OFFENCES } from "./data";
import { dot, embed, meanVector, ModelUnavailable, ready } from "./models";
import { contentWords, numericFigures, round, splitSentences, westernDigits, wordOverlap } from "./text";

// ---------------------------------------------------------------------------
// Legal references (patterns only -- nothing inferred)
// ---------------------------------------------------------------------------

export interface LegalRef { kind: "law" | "article"; reference: string; context: string; source?: string }

const LAW_EN = /(?:Federal\s+)?(?:Decree[- ]Law|Law|Decree|Cabinet\s+Resolution)\s+No\.?\s*\(?(\d{1,4})\)?\s+of\s+(\d{4})(?:\s+(?:on|concerning|regarding)\s+(?:the\s+)?([A-Z][A-Za-z ,'&-]{3,80}))?/gi;
const ARTICLE_EN = /\b(?:Article|Art\.)\s*\(?(\d{1,4})\)?(?:\s*(?:\(\d+\)|bis))?(?:\s+of\s+(?:the\s+)?((?:[A-Z][A-Za-z-]+\s+){0,5}(?:Code|Law|Decree-Law)))?/g;
const LAW_AR = /(?:مرسوم\s+بقانون|المرسوم\s+بقانون|القانون|قانون|المرسوم|قرار\s+مجلس\s+الوزراء)\s+(?:(?:ال)?اتحادي\s+)?رقم\s*\(?\s*([0-9٠-٩]{1,4})\s*\)?\s+لسنة\s+([0-9٠-٩]{4})/g;
const ARTICLE_AR = /المادة\s*\(?\s*([0-9٠-٩]{1,4})\s*\)?/g;

export function legalReferences(text: string, limit = 40): LegalRef[] {
  const found = new Map<string, LegalRef>();
  const add = (kind: LegalRef["kind"], label: string, m: RegExpMatchArray) => {
    const key = `${kind}:${label.toLowerCase()}`;
    if (found.has(key) || found.size >= limit) return;
    const start = Math.max((m.index ?? 0) - 70, 0);
    const end = Math.min((m.index ?? 0) + m[0].length + 70, text.length);
    found.set(key, { kind, reference: label, context: text.slice(start, end).split(/\s+/).join(" ").trim() });
  };
  for (const m of text.matchAll(LAW_EN)) add("law", `Law No. ${m[1]} of ${m[2]}${m[3] ? ` on ${m[3].trim()}` : ""}`, m);
  for (const m of text.matchAll(LAW_AR)) add("law", `رقم ${westernDigits(m[1])} لسنة ${westernDigits(m[2])}`, m);
  for (const m of text.matchAll(ARTICLE_EN)) add("article", `Article ${m[1]}${m[2] ? ` of the ${m[2].trim()}` : ""}`, m);
  for (const m of text.matchAll(ARTICLE_AR)) add("article", `المادة ${westernDigits(m[1])}`, m);
  return [...found.values()];
}

// ---------------------------------------------------------------------------
// Offence mentions (by meaning, anchored by wording in the middle band)
// ---------------------------------------------------------------------------

export interface OffenceMention { offence: string; label_en: string; label_ar: string; sentence: string; score: number; support: string }

// Meaning alone must be strong; a fair match also needs the offence's own words in the text.
// (0.66 rather than the server's 0.60: the quantized browser model scores a little higher.)
const STRONG = 0.66;
const SUPPORTED = 0.45;

const hasWord = (haystack: string, key: string) => OFFENCES[key].words.some((w) => haystack.includes(w));

export async function offenceMentions(text: string, limit = 6, wait = true): Promise<{ mentions: OffenceMention[]; method: string }> {
  const sentences = splitSentences(text, 250);
  if (!sentences.length) return { mentions: [], method: "none" };
  const keys: string[] = [];
  const descriptions: string[] = [];
  for (const [key, spec] of Object.entries(OFFENCES)) for (const d of spec.describe) { keys.push(key); descriptions.push(d); }
  let descVectors: Float32Array[], sentVectors: Float32Array[];
  try {
    descVectors = await embed(descriptions, wait);
    sentVectors = await embed(sentences, wait);
  } catch (e) {
    if (e instanceof ModelUnavailable) return { mentions: [], method: "unavailable" };
    throw e;
  }
  const lowered = text.toLowerCase();
  const perOffence: Record<string, number[]> = {};
  keys.forEach((key, d) => {
    const scores = (perOffence[key] ??= new Array(sentences.length).fill(-1));
    sentVectors.forEach((sv, s) => { scores[s] = Math.max(scores[s], dot(sv, descVectors[d])); });
  });
  const best = Object.entries(perOffence).map(([key, scores]) => {
    let idx = 0;
    scores.forEach((v, i) => { if (v > scores[idx]) idx = i; });
    return { key, score: scores[idx], idx };
  }).sort((a, b) => b.score - a.score);
  const mentions: OffenceMention[] = [];
  for (const { key, score, idx } of best) {
    const supported = hasWord(lowered, key);
    if (score < SUPPORTED || (score < STRONG && !supported)) continue;
    let sIdx = idx;
    if (!hasWord(sentences[sIdx].toLowerCase(), key)) {
      const scores = perOffence[key];
      const candidates = sentences.map((s, i) => [s, i] as const).filter(([s]) => hasWord(s.toLowerCase(), key)).map(([, i]) => i);
      if (candidates.length) sIdx = candidates.reduce((a, b) => (scores[b] > scores[a] ? b : a));
    }
    mentions.push({ offence: key, label_en: OFFENCES[key].en, label_ar: OFFENCES[key].ar, sentence: sentences[sIdx],
                    score: round(score), support: supported ? "wording+meaning" : "meaning" });
    if (mentions.length >= limit) break;
  }
  return { mentions, method: "semantic" };
}

// ---------------------------------------------------------------------------
// Extractive summaries (original sentences only)
// ---------------------------------------------------------------------------

export interface Summary {
  sentences: { index: number; text: string; rank: number }[];
  method: "semantic" | "word-frequency" | "none";
  coverage: number;
  sentence_count?: number;
}

export async function extractiveSummary(text: string, maxSentences = 5, maxChars = 1400, waitForModel = true): Promise<Summary> {
  const sentences = splitSentences(text, 400);
  const totalChars = sentences.reduce((a, s) => a + s.length, 0) || 1;
  if (!sentences.length) return { sentences: [], method: "none", coverage: 0 };
  let picked: number[];
  let method: Summary["method"];
  try {
    if (!waitForModel && !ready("embeddings")) throw new ModelUnavailable("still loading");
    picked = await semanticPick(sentences, maxSentences);
    method = "semantic";
  } catch (e) {
    if (!(e instanceof ModelUnavailable)) throw e;
    picked = frequencyPick(sentences, maxSentences);
    method = "word-frequency";
  }
  const rank = new Map(picked.map((i, r) => [i, r]));
  const chosen: Summary["sentences"] = [];
  let used = 0;
  for (const i of [...picked].sort((a, b) => a - b)) {
    if (used + sentences[i].length > maxChars && chosen.length) break;
    chosen.push({ index: i, text: sentences[i], rank: rank.get(i)! });
    used += sentences[i].length;
  }
  return { sentences: chosen, method, coverage: round(used / totalChars), sentence_count: sentences.length };
}

async function semanticPick(sentences: string[], k: number): Promise<number[]> {
  const vectors = await embed(sentences);
  const centroid = meanVector(vectors);
  const n = sentences.length;
  const relevance = vectors.map((v, i) => dot(v, centroid) * (0.55 + 0.45 * Math.min(1, sentences[i].length / 90)) + 0.03 * (1 - i / n));
  const selected: number[] = [];
  while (selected.length < Math.min(k, n)) {
    let bestI = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
      if (selected.includes(i)) continue;
      const redundancy = selected.length ? Math.max(...selected.map((j) => dot(vectors[i], vectors[j]))) : 0;
      const score = 0.72 * relevance[i] - 0.28 * redundancy;
      if (score > bestScore) { bestScore = score; bestI = i; }
    }
    selected.push(bestI);
  }
  return selected;
}

function frequencyPick(sentences: string[], k: number): number[] {
  const freq = new Map<string, number>();
  for (const s of sentences) for (const w of contentWords(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  if (!freq.size) return sentences.slice(0, k).map((_, i) => i);
  const top = Math.max(...freq.values());
  const scores = sentences.map((s, i) => {
    const words = contentWords(s);
    const score = words.reduce((a, w) => a + (freq.get(w) ?? 0) / top, 0) / Math.sqrt(words.length || 1);
    return score * Math.min(1, s.length / 90) + 0.1 * (1 - i / sentences.length);
  });
  const picked: number[] = [];
  for (const i of sentences.map((_, i) => i).sort((a, b) => scores[b] - scores[a])) {
    if (picked.every((j) => wordOverlap(sentences[i], sentences[j]) < 0.7)) picked.push(i);
    if (picked.length >= k) break;
  }
  return picked;
}

/** The sentences across `sources` that best answer `question`. */
export async function keyPassages(question: string, sources: string[], k = 4, perSource = 2, minScore = 0.3) {
  const candidates: [number, string][] = [];
  sources.forEach((text, idx) => splitSentences(text, 80).forEach((s) => candidates.push([idx, s])));
  if (!candidates.length) return { passages: [] as { source_index: number; text: string; score: number }[], method: "none" };
  let scores: number[];
  let method = "semantic";
  try {
    const vectors = await embed([question, ...candidates.map((c) => c[1])], false);
    scores = vectors.slice(1).map((v) => dot(v, vectors[0]));
  } catch (e) {
    if (!(e instanceof ModelUnavailable)) throw e;
    scores = candidates.map((c) => wordOverlap(question, c[1]));
    method = "word-overlap";
    minScore = 0.2;
  }
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const taken = new Map<number, number>();
  const passages: { source_index: number; text: string; score: number }[] = [];
  for (const i of order) {
    if (scores[i] < minScore) break;
    const [src, sentence] = candidates[i];
    if ((taken.get(src) ?? 0) >= perSource) continue;
    taken.set(src, (taken.get(src) ?? 0) + 1);
    passages.push({ source_index: src, text: sentence, score: round(scores[i]) });
    if (passages.length >= k) break;
  }
  return { passages, method };
}

// ---------------------------------------------------------------------------
// Grounding check for model-written drafts
// ---------------------------------------------------------------------------

export interface GroundedSentence { text: string; support: "supported" | "partial" | "unsupported" | "heading"; score: number; sources: number[]; invented_figures: string[] }
export interface Grounding { sentences: GroundedSentence[]; supported_ratio: number; method: string }

export async function groundingCheck(answer: string, sources: string[]): Promise<Grounding> {
  const answerSentences = splitSentences(answer, 80);
  const sourceSentences: [number, string][] = [];
  sources.forEach((text, idx) => splitSentences(text, 120).forEach((s) => sourceSentences.push([idx + 1, s])));
  if (!answerSentences.length) return { sentences: [], supported_ratio: 0, method: "none" };
  if (!sourceSentences.length) {
    return { sentences: answerSentences.map((s) => ({ text: s, support: "unsupported", score: 0, sources: [], invented_figures: [] })),
             supported_ratio: 0, method: "none" };
  }
  const stripped = answerSentences.map((s) => s.replace(/\s*\[(\d{1,2})\]/g, "").trim());
  let sims: number[][];
  let method = "semantic", hi = 0.62, lo = 0.48;
  try {
    const vectors = await embed([...stripped, ...sourceSentences.map((s) => s[1])]);
    const a = vectors.slice(0, stripped.length), s = vectors.slice(stripped.length);
    sims = a.map((av) => s.map((sv) => dot(av, sv)));
  } catch (e) {
    if (!(e instanceof ModelUnavailable)) throw e;
    sims = stripped.map((a) => sourceSentences.map(([, s]) => wordOverlap(a, s)));
    method = "word-overlap"; hi = 0.6; lo = 0.35;
  }
  const sourceFigures = new Set<string>();
  for (const t of sources) for (const f of numericFigures(t)) sourceFigures.add(f);
  const out: GroundedSentence[] = [];
  let supported = 0, counted = 0;
  stripped.forEach((text, i) => {
    if (/[:：]$/.test(text) && text.length < 90) {
      out.push({ text, support: "heading", score: 0, sources: [], invented_figures: [] });
      return;
    }
    counted++;
    const row = sims[i];
    const best = Math.max(...row);
    let cited = [...new Set(row.map((v, j) => (v >= Math.max(lo, best - 0.05) ? sourceSentences[j][0] : 0)).filter(Boolean))].sort((a, b) => a - b);
    let support: GroundedSentence["support"] = best >= hi ? "supported" : best >= lo ? "partial" : "unsupported";
    if (support === "unsupported") cited = [];
    const invented = [...numericFigures(text)].filter((f) => !sourceFigures.has(f)).sort();
    if (invented.length) { support = "unsupported"; cited = []; }
    if (support === "supported") supported++;
    out.push({ text, support, score: round(best), sources: cited.slice(0, 3), invented_figures: invented });
  });
  return { sentences: out, supported_ratio: counted ? round(supported / counted) : 0, method };
}

export function renderGrounded(checked: Grounding): string {
  return checked.sentences.map((s) => {
    const marks = s.sources.map((n) => ` [${n}]`).join("");
    return marks && /[.!?؟]$/.test(s.text) ? `${s.text.slice(0, -1)}${marks}${s.text.slice(-1)}` : `${s.text}${marks}`;
  }).join(" ");
}
