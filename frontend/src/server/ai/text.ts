/** Bilingual text helpers shared by the task models (port of app/ai/text.py). */

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;
const FOREIGN_SCRIPT = /[぀-ヿ㐀-䶿一-鿿가-힯Ѐ-ӿ฀-๿]/;
const SPLIT = /(?<=[.!?؟۔])\s+|\n+/;
const WS = /[ \t ]+/g;
const WORD = /[\p{L}\p{N}_؀-ۿ]{3,}/gu;
const MAX_SENTENCE = 400;
const MIN_SENTENCE = 12;

export const STOPWORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "was", "were", "are", "has", "have", "had", "not",
  "but", "his", "her", "their", "they", "them", "which", "who", "been", "will", "shall", "may", "any",
  "all", "such", "its", "into", "upon", "than", "then", "also", "there", "where", "when", "what",
  "في", "من", "على", "إلى", "الى", "عن", "أن", "ان", "التي", "الذي", "هذا", "هذه", "ذلك", "تلك", "كان",
  "كانت", "مع", "أو", "او", "ما", "لا", "قد", "كل", "بعد", "قبل", "عند", "حيث", "وقد", "وفي", "ولا",
]);

export function arabicRatio(text: string): number {
  const ar = (text.match(ARABIC) ?? []).length;
  const lat = (text.match(LATIN) ?? []).length;
  return ar + lat ? ar / (ar + lat) : 0;
}

export function languageOf(text: string): "ar" | "en" {
  return arabicRatio(text) >= 0.4 ? "ar" : "en";
}

/** True when Arabic letters are more than 30% of all letters (arabic_ner.is_arabic). */
export function isArabic(text: string, threshold = 0.3): boolean {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (!letters) return false;
  return (text.match(ARABIC) ?? []).length / letters > threshold;
}

export function hasForeignScript(text: string): boolean {
  return FOREIGN_SCRIPT.test(text);
}

function stripEdges(s: string): string {
  return s.replace(/^[\s\-•*‏‎]+|[\s\-•*‏‎]+$/g, "");
}

/** Sentences of 12-400 characters; overlong ones are cut at clause boundaries. */
export function splitSentences(text: string, limit = 600): string[] {
  const out: string[] = [];
  for (const raw of (text || "").split(SPLIT)) {
    if (raw === undefined) continue;
    let sentence = stripEdges(raw.replace(WS, " "));
    if (sentence.length < MIN_SENTENCE) continue;
    while (sentence.length > MAX_SENTENCE) {
      let cut = Math.max(...[";", "؛", "،", ",", " "].map((sep) => sentence.lastIndexOf(sep, MAX_SENTENCE - 1)));
      cut = cut > MAX_SENTENCE / 2 ? cut : MAX_SENTENCE;
      out.push(sentence.slice(0, cut + 1).trim());
      sentence = sentence.slice(cut + 1).trim();
    }
    if (sentence.length >= MIN_SENTENCE) out.push(sentence);
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

export function stripMarkdown(text: string): string {
  const cleaned = (text || "").replace(/(\*\*|__|`+|~~)/g, "").replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d{1,2}[.)]\s+)/gm, "");
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

const DIGITS_AR: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
export function westernDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => DIGITS_AR[d]);
}

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60",
  seventy: "70", eighty: "80", ninety: "90", hundred: "100", thousand: "1000",
  "واحد": "1", "اثنين": "2", "ثلاثة": "3", "أربعة": "4", "خمسة": "5", "ستة": "6", "سبعة": "7", "ثمانية": "8",
  "تسعة": "9", "عشرة": "10", "عشرين": "20", "ثلاثين": "30", "أربعين": "40", "خمسين": "50", "ستين": "60",
  "سبعين": "70", "ثمانين": "80", "تسعين": "90", "مئة": "100", "مائة": "100", "ألف": "1000",
};
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

function withoutArabicPrefix(word: string): string {
  let base = word;
  while ("وفبلك".includes(base[0] ?? "x") && base.length > 4) base = base.slice(1);
  if (base.startsWith("ال") && base.length > 4) base = base.slice(2);
  return base;
}

/** Dates, times, amounts and other numbers, normalised (see app/ai/text.py::figures). */
export function figures(text: string): Set<string> {
  const normalised = westernDigits(text || "");
  const found = new Set<string>();
  for (const m of normalised.matchAll(/\d+(?:[:.,/-]\d+)*/g)) {
    const token = m[0].replace(/^[.,]+|[.,]+$/g, "");
    if (!token) continue;
    found.add(token.replace(/,/g, ""));
    for (const part of token.split(/[:/.-]/)) if (part) found.add(part.replace(/^0+/, "") || "0");
  }
  for (const m of normalised.matchAll(/[A-Za-z؀-ۿ]+/g)) {
    const word = m[0].toLowerCase();
    const digit = NUMBER_WORDS[word] ?? NUMBER_WORDS[withoutArabicPrefix(word)];
    if (digit) found.add(digit);
  }
  for (const m of normalised.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi)) found.add(m[1].toLowerCase());
  for (const month of MONTHS_AR) if (normalised.includes(month)) found.add(month);
  return found;
}

export function numericFigures(text: string): Set<string> {
  return new Set([...figures(text)].filter((f) => /^\d/.test(f)));
}

export function contentWords(text: string): string[] {
  return ((text || "").toLowerCase().match(WORD) ?? []).filter((w) => !STOPWORDS.has(w));
}

/** Share of `a`'s content words that also appear in `b` (0-1). */
export function wordOverlap(a: string, b: string): number {
  const wa = new Set(contentWords(a));
  const wb = new Set(contentWords(b));
  if (!wa.size) return 0;
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n / wa.size;
}

/** Jaccard overlap of 3+ letter tokens (graph_orchestrator.token_similarity). */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set((a.toLowerCase().match(WORD) ?? []));
  const tb = new Set((b.toLowerCase().match(WORD) ?? []));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
