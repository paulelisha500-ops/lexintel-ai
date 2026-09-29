/**
 * Case intelligence (port of app/agents/case_intelligence_agent.py and
 * arabic_ner.py): structured entities (dates, AED amounts, Emirates IDs,
 * case references, UAE authorities and emirates, English names/places),
 * offence mentions and cited laws, and a dated timeline. Structure only --
 * no charge is ever labelled proven and no party is ranked.
 */
import { legalReferences, offenceMentions } from "./analysis";
import { dot, embed, ModelUnavailable } from "./models";
import { figures, isArabic, round, splitSentences } from "./text";

export interface Entity { text: string; label: string; source_span: string }

const PATTERNS: [string, RegExp][] = [
  ["EMIRATES_ID", /\b784-\d{4}-\d{7}-\d\b/g],
  ["AMOUNT_AED", /(?:AED|درهم)\s?[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d+)?\s?(?:AED|درهم)(?![\p{L}])/giu],
  ["DATE", /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g],
  ["CASE_REF", /\b[A-Z]{2,5}-\d{4}-\d{3,6}\b/g],
];

function span(text: string, start: number, end: number, pad = 40): string {
  return text.slice(Math.max(start - pad, 0), Math.min(end + pad, text.length));
}

/** The sentence (or line) containing text[start:end], trimmed to at most ~300 characters. */
export function sentenceAround(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const from = Math.max(before.lastIndexOf("\n"), ...[". ", "? ", "! ", "؟ "].map((p) => { const i = before.lastIndexOf(p); return i < 0 ? -1 : i + 1; })) + 1;
  const after = text.slice(end);
  const stops = ["\n", ". ", "? ", "! ", "؟ "].map((p) => after.indexOf(p)).filter((i) => i >= 0);
  const to = end + (stops.length ? Math.min(...stops) + 1 : after.length);
  let sentence = text.slice(from, to).replace(/\s+/g, " ").trim();
  if (sentence.length > 300) sentence = span(text, start, end, 140).replace(/\s+/g, " ").trim();
  return sentence;
}

export function structuredEntities(text: string): Entity[] {
  const out: Entity[] = [];
  for (const [label, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const at = m.index!, end = at + m[0].length;
      out.push({ text: m[0], label, source_span: label === "DATE" ? sentenceAround(text, at, end) : span(text, at, end) });
    }
  }
  return out;
}

const GAZETTEER: Record<string, string> = {
  "وزارة العدل": "ORG", "المحكمة الاتحادية العليا": "ORG", "النيابة العامة": "ORG", "النيابة العامة الاتحادية": "ORG",
  "دائرة القضاء": "ORG", "أبوظبي": "LOCATION", "أبو ظبي": "LOCATION", "دبي": "LOCATION", "الشارقة": "LOCATION",
  "عجمان": "LOCATION", "أم القيوين": "LOCATION", "الفجيرة": "LOCATION", "رأس الخيمة": "LOCATION",
};
const GAZETTEER_EN: Record<string, string> = {
  "Ministry of Justice": "ORG", "Federal Supreme Court": "ORG", "Public Prosecution": "ORG", "Dubai Courts": "ORG",
  "Abu Dhabi Judicial Department": "ORG", "Dubai Police": "ORG", "Abu Dhabi Police": "ORG", "Sharjah Police": "ORG",
  "Abu Dhabi": "LOCATION", "Dubai": "LOCATION", "Sharjah": "LOCATION", "Ajman": "LOCATION", "Umm Al Quwain": "LOCATION",
  "Fujairah": "LOCATION", "Ras Al Khaimah": "LOCATION", "Al Ain": "LOCATION",
};

function gazetteerEntities(text: string, table: Record<string, string>): Entity[] {
  const out: Entity[] = [];
  const covered: [number, number][] = [];
  for (const term of Object.keys(table).sort((a, b) => b.length - a.length)) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(term, from);
      if (i < 0) break;
      from = i + term.length;
      if (covered.some(([s, e]) => i < e && i + term.length > s)) continue;
      covered.push([i, i + term.length]);
      out.push({ text: term, label: table[term], source_span: span(text, i, i + term.length) });
    }
  }
  return out;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const WRITTEN_DATE = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}\\s+\\d{4}\\b|\\b${MONTH_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "g");
const TIME = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[AaPp]\.?[Mm]\.?)?\b/g;
const ORG_SUFFIX = /\b(?:[A-Z][A-Za-z&'-]+\s+){0,4}(?:LLC|L\.L\.C\.|Ltd|PJSC|FZE|FZ-LLC|Bank|Police|Court|Courts|Company|Group|Authority|Municipality|Ministry)\b/g;
const PLACE_WORDS = "Road|Street|St|Mall|Tower|Towers|Area|Marina|Hospital|Clinic|Park|Bridge|Junction|Roundabout|Interchange|Beach|Island|Centre|Center|Airport|Port";
// A title followed by a name -- unless the "name" is really a place ("Sheikh Zayed Road").
const NAME_WORD = String.raw`(?!(?:${PLACE_WORDS})\b)[A-Z][a-z]+`;
const PERSON_TITLE = new RegExp(String.raw`\b(?:Mr|Mrs|Ms|Dr|Judge|Officer|Sheikh|Sheikha)\.?\s+${NAME_WORD}(?:\s+${NAME_WORD}){0,2}\b(?!\s+(?:${PLACE_WORDS})\b)`, "g");
// Named places: "Al Wasl Road", "Sheikh Zayed Road", "Dubai Marina", "Rashid Hospital".
const PLACE_PREFIX = new RegExp(String.raw`\b(?:[A-Z][a-z]+\s+){1,3}(?:${PLACE_WORDS})\b`, "g");

function englishEntities(text: string): Entity[] {
  const out: Entity[] = [];
  const add = (label: string, re: RegExp) => {
    for (const m of text.matchAll(re)) {
      const at = m.index!, end = at + m[0].length;
      out.push({ text: m[0].trim(), label, source_span: label === "DATE" ? sentenceAround(text, at, end) : span(text, at, end, 60) });
    }
  };
  add("DATE", WRITTEN_DATE);
  add("TIME", TIME);
  add("ORG", ORG_SUFFIX);
  add("PERSON", PERSON_TITLE);
  add("LOCATION", PLACE_PREFIX);
  return out;
}

function dedupe(entities: Entity[]): Entity[] {
  const seen = new Set<string>();
  return entities.filter((e) => {
    const key = `${e.label}:${e.text.trim().toLowerCase()}`;
    if (!e.text.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generalEntities(text: string): { entities: Entity[]; warnings: string[] } {
  if (isArabic(text)) return { entities: dedupe([...gazetteerEntities(text, GAZETTEER), ...structuredEntities(text)]), warnings: [] };
  return { entities: dedupe([...structuredEntities(text), ...englishEntities(text), ...gazetteerEntities(text, GAZETTEER_EN)]), warnings: [] };
}

/** Best-effort absolute date parsing; relative dates stay undated. */
export function parseDate(raw: string): string | null {
  const t = raw.trim().replace(/,/g, " ").replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  const iso = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  };
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  const monthIndex = (s: string) => MONTHS.findIndex((mm) => mm.startsWith(s.toLowerCase().slice(0, 3))) + 1;
  m = t.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (m && monthIndex(m[2])) return iso(+m[3], monthIndex(m[2]), +m[1]);
  m = t.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})/);
  if (m && monthIndex(m[1])) return iso(+m[3], monthIndex(m[1]), +m[2]);
  return null;
}

export interface IntelligenceResult {
  entities: Entity[];
  charges_mentioned: string[];
  offence_mentions: Awaited<ReturnType<typeof offenceMentions>>["mentions"];
  legal_references: ReturnType<typeof legalReferences>;
  timeline_events: { case_id: string; event_date: string | null; event_date_raw: string; description: string; entity_type: string }[];
  warnings: string[];
}

export async function runCaseIntelligence(caseId: string, rawText: string, wait = true): Promise<IntelligenceResult> {
  try {
    const { entities, warnings } = generalEntities(rawText);
    const references = legalReferences(rawText);
    const mentions = await offenceMentions(rawText, 6, wait);
    if (mentions.method === "unavailable") {
      warnings.push("The meaning-matching model is still loading, so offence mentions were skipped; cited laws, entities and the timeline were still extracted.");
    }
    const all = dedupe([...entities, ...references.map((r) => ({ text: r.reference, label: "LEGAL_REF", source_span: r.context }))]);
    const events = all.filter((e) => e.label === "DATE").map((e) => ({
      case_id: caseId, event_date: parseDate(e.text), event_date_raw: e.text,
      description: e.source_span.replace(/\s+/g, " ").trim() || e.text, entity_type: "event",
    })).sort((a, b) => (a.event_date === null ? 1 : 0) - (b.event_date === null ? 1 : 0) || (a.event_date ?? "").localeCompare(b.event_date ?? ""));
    return { entities: all, charges_mentioned: mentions.mentions.map((m) => m.label_en), offence_mentions: mentions.mentions,
             legal_references: references, timeline_events: events, warnings };
  } catch (e) {
    console.error("case intelligence failed", e);
    return { entities: [], charges_mentioned: [], offence_mentions: [], legal_references: [], timeline_events: [],
             warnings: [`Case intelligence failed: ${(e as Error)?.name ?? "Error"}`] };
  }
}

// ---------------------------------------------------------------------------
// Fact comparison between two sources (a reading aid, never a credibility judgment)
// ---------------------------------------------------------------------------

const COMPARE_LABELS = new Set(["DATE", "TIME", "LOCATION", "AMOUNT", "AMOUNT_AED", "EMIRATES_ID", "CASE_REF", "PERSON", "ORG"]);

async function alignedDifferences(textA: string, textB: string) {
  const sa = splitSentences(textA, 150), sb = splitSentences(textB, 150);
  if (!sa.length || !sb.length) return { differences: [] as any[], method: "none" };
  let vectors: Float32Array[];
  try {
    vectors = await embed([...sa, ...sb]);
  } catch (e) {
    if (e instanceof ModelUnavailable) return { differences: [] as any[], method: "unavailable" };
    throw e;
  }
  const va = vectors.slice(0, sa.length), vb = vectors.slice(sa.length);
  const sims = va.map((a) => vb.map((b) => dot(a, b)));
  const out: any[] = [];
  const seenB = new Set<number>();
  sims.forEach((row, i) => {
    let j = 0;
    row.forEach((v, k) => { if (v > row[j]) j = k; });
    let bestI = 0;
    sims.forEach((r, k) => { if (r[j] > sims[bestI][j]) bestI = k; });
    if (row[j] < 0.62 || bestI !== i || seenB.has(j)) return;
    const fa = figures(sa[i]), fb = figures(sb[j]);
    const same = fa.size === fb.size && [...fa].every((f) => fb.has(f));
    if (fa.size && fb.size && !same) {
      seenB.add(j);
      const sym = [...fa].filter((f) => !fb.has(f)).concat([...fb].filter((f) => !fa.has(f))).sort();
      out.push({ topic: sym.join(", ").slice(0, 120), source_a: sa[i].slice(0, 600), source_b: sb[j].slice(0, 600), similarity: round(row[j]) });
    }
  });
  out.sort((a, b) => b.similarity - a.similarity);
  return { differences: out.slice(0, 20), method: "semantic" };
}

export async function compareSources(labelA: string, textA: string, labelB: string, textB: string) {
  const group = (ents: Entity[]) => {
    const out: Record<string, Record<string, string>> = {};
    for (const e of ents) if (COMPARE_LABELS.has(e.label)) (out[e.label] ??= {})[e.text.trim().toLowerCase()] = e.source_span || e.text;
    return out;
  };
  const ga = group(generalEntities(textA).entities), gb = group(generalEntities(textB).entities);
  const only: { label: string; value: string; present_in: string; context: string }[] = [];
  for (const label of [...new Set([...Object.keys(ga), ...Object.keys(gb)])].sort()) {
    const a = Object.keys(ga[label] ?? {}), b = Object.keys(gb[label] ?? {});
    if (a.length && b.length) {
      a.filter((k) => !b.includes(k)).sort().slice(0, 8).forEach((k) => only.push({ label, value: k, present_in: labelA, context: ga[label][k] }));
      b.filter((k) => !a.includes(k)).sort().slice(0, 8).forEach((k) => only.push({ label, value: k, present_in: labelB, context: gb[label][k] }));
    }
  }
  const { differences, method } = await alignedDifferences(textA, textB);
  const summary = method === "semantic"
    ? (differences.length ? `${differences.length} point(s) are described in both sources with different figures, dates or times.`
                          : "No point described in both sources states different figures, dates or times.")
    : null;
  return { source_a: labelA, source_b: labelB, detail_differences: only, ai_differences: differences, ai_summary: summary,
           ai_used: method === "semantic", method,
           disclaimer: "Lists differences in stated facts only. It does not assess truthfulness or credibility." };
}
