/**
 * Law Library corpus (port of app/ingestion/law_library.py and the retrieval
 * half of app/agents/legal_research_agent.py): article parsing, and hybrid
 * retrieval -- meaning search plus keyword (BM25) search merged by
 * reciprocal rank -- with law not in force on the chosen date removed
 * before anything is shown or drafted.
 */
import type { LawRow } from "../store";
import { dot, embed, ModelUnavailable } from "./models";
import { contentWords, westernDigits } from "./text";

const ARTICLE_RE = /(?:^|\n)\s*(?:Article\s*\(?\s*(\d{1,4})\s*\)?|(?:ال)?مادة\s*\(?\s*(\d{1,4})\s*\)?)\s*(?=[\n:\-–.]|\s)/gi;

export function normalize(text: string): string {
  return westernDigits(text).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/\r\n?/g, "\n").replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Join lines that were wrapped inside a paragraph; keep blank-line paragraph breaks. */
function unwrap(text: string): string {
  return text.replace(/([^\n])\n(?!\n)/g, "$1 ").replace(/ {2,}/g, " ");
}

export function parseArticles(text: string): { articles: { number: string; body: string; kind: string }[]; mode: "articles" | "sections" } {
  const clean = normalize(text);
  const matches = [...clean.matchAll(ARTICLE_RE)];
  const articles: { number: string; body: string; kind: string }[] = [];
  if (matches.length >= 2) {
    let startIndex = matches.findIndex((m) => (m[1] ?? m[2]) === "1");
    if (startIndex < 0) startIndex = 0;
    const seen = new Set<string>();
    for (let i = startIndex; i < matches.length; i++) {
      const m = matches[i];
      const number = m[1] ?? m[2];
      const end = i + 1 < matches.length ? matches[i + 1].index! : clean.length;
      const body = clean.slice(m.index! + m[0].length, end).replace(/^[\s\n:\-–.]+|[\s\n:\-–.]+$/g, "");
      if (body.length < 15) continue;
      if (seen.has(number)) {
        if (articles.length) articles[articles.length - 1].body += "\n" + body;
        continue;
      }
      seen.add(number);
      articles.push({ number, body: unwrap(body).slice(0, 12000), kind: "article" });
    }
  }
  if (articles.length >= 2) return { articles, mode: "articles" };
  const sections: { number: string; body: string; kind: string }[] = [];
  let buffer = "";
  for (const para of clean.split(/\n\s*\n/)) {
    if (buffer.length + para.length > 1200 && buffer) {
      sections.push({ number: String(sections.length + 1), body: unwrap(buffer.trim()), kind: "section" });
      buffer = "";
    }
    buffer += para + "\n\n";
  }
  if (buffer.trim()) sections.push({ number: String(sections.length + 1), body: unwrap(buffer.trim()), kind: "section" });
  return { articles: sections, mode: "sections" };
}

export interface Hit { key: string; law: LawRow; article: string; label: string; text: string }

function corpus(laws: LawRow[], jurisdiction: string | null): Hit[] {
  return laws.filter((l) => l.status === "indexed" && (!jurisdiction || l.jurisdiction === jurisdiction))
    .flatMap((l) => l.articles.map((a) => ({ key: `${l.id}:${a.number}`, law: l, article: a.number, label: a.label, text: a.body })));
}

function bm25(question: string, docs: Hit[], k = 10): Hit[] {
  const q = [...new Set(contentWords(question))];
  if (!q.length || !docs.length) return [];
  const tokenized = docs.map((d) => contentWords(`${d.law.title} ${d.text}`));
  const avg = tokenized.reduce((a, t) => a + t.length, 0) / tokenized.length || 1;
  const df = new Map<string, number>();
  for (const t of tokenized) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const scores = tokenized.map((t) => {
    const tf = new Map<string, number>();
    for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    return q.reduce((s, w) => {
      const f = tf.get(w) ?? 0;
      if (!f) return s;
      const idf = Math.log(1 + (docs.length - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      return s + idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * t.length / avg));
    }, 0);
  });
  return docs.map((d, i) => [d, scores[i]] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, k).map(([d]) => d);
}

async function semantic(question: string, docs: Hit[], k = 10): Promise<Hit[] | null> {
  if (!docs.length) return [];
  try {
    const [q] = await embed([question], false);
    const vectors = await embed(docs.map((d) => d.text.slice(0, 1500)), false);
    return docs.map((d, i) => [d, dot(vectors[i], q)] as const).sort((a, b) => b[1] - a[1]).slice(0, k).map(([d]) => d);
  } catch (e) {
    if (e instanceof ModelUnavailable) return null;
    throw e;
  }
}

export async function retrieve(question: string, laws: LawRow[], jurisdiction: string | null): Promise<{ hits: Hit[]; sources: string[] }> {
  const docs = corpus(laws, jurisdiction);
  const scores = new Map<string, number>();
  const byKey = new Map<string, Hit>();
  const sources: string[] = [];
  const merge = (ranked: Hit[]) => ranked.forEach((h, rank) => {
    byKey.set(h.key, h);
    scores.set(h.key, (scores.get(h.key) ?? 0) + 1 / (60 + rank));
  });
  const meaning = await semantic(question, docs);
  if (meaning) { merge(meaning); sources.push("semantic"); }
  const keyword = bm25(question, docs);
  if (keyword.length || !meaning) { merge(keyword); sources.push("keyword"); }
  return { hits: [...byKey.keys()].sort((a, b) => scores.get(b)! - scores.get(a)!).map((k) => byKey.get(k)!), sources };
}

export function inForce(hits: Hit[], asOf: string | null, max = 6): Hit[] {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  return hits.filter(({ law }) => {
    if (law.legislation_state === "repealed" && !law.effective_to) return false;
    if (law.effective_from && law.effective_from > date) return false;
    if (law.effective_to && law.effective_to < date) return false;
    return true;
  }).slice(0, max);
}
