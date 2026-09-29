/**
 * Grounded drafting (port of app/ai/drafting.py): stream tokens from the
 * writing model, stop on foreign script, reject the wrong language, check
 * every sentence against the numbered sources and withhold drafts that
 * mostly don't match. Always ends with exactly one "draft" event.
 */
import { groundingCheck, renderGrounded, type Grounding } from "./analysis";
import { describeWriter, generate, MAX_WAITING_DRAFTS, modelState, ModelUnavailable, writerQueueLength, WriterBusy } from "./models";
import { arabicRatio, hasForeignScript, splitSentences, stripMarkdown, wordOverlap } from "./text";

export type DraftEvent =
  | ["status", { phase: string; ahead?: number; model?: string; progress?: number }]
  | ["token", { text: string }]
  | ["draft", { status: "ok"; text: string; grounding: Grounding; unsupported: number; removed?: number; model: string } | { status: "ai_unavailable" | "ai_busy" | "discarded"; reason: string }];

export function languageProblem(text: string, language: string): string | null {
  if (hasForeignScript(text)) return "The draft drifted into another language, so it was withheld.";
  const ratio = arabicRatio(text);
  if (language === "ar" && ratio < 0.6) return "The draft was not written in Arabic, so it was withheld.";
  if (language === "en" && ratio > 0.3) return "The draft was not written in English, so it was withheld.";
  return null;
}

function dropRepeats(text: string): string {
  const kept: string[] = [];
  for (const sentence of splitSentences(text, 40)) {
    if (kept.some((earlier) => wordOverlap(sentence, earlier) > 0.8)) continue;
    kept.push(sentence);
  }
  return kept.length ? kept.join(" ") : text;
}

class ForeignScript extends Error {}

export async function* streamGroundedDraft(messages: { role: string; content: string }[], sources: string[], language: string,
                                           maxTokens = 450, minSupported = 0.34): AsyncGenerator<DraftEvent> {
  const ahead = writerQueueLength();
  if (ahead >= MAX_WAITING_DRAFTS) {
    yield ["draft", { status: "ai_busy", reason: "The writing model is busy with other drafts." }];
    return;
  }
  yield ["status", { phase: ahead ? "waiting" : modelState("writer").loaded ? "writing" : "loading", ahead, model: describeWriter() }];

  // Bridge the callback-based generator into this async stream.
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: unknown = null;
  let started = false;
  let foreign = false;
  const generation = generate(messages, maxTokens, (piece) => {
    if (foreign) return;
    if (hasForeignScript(piece)) foreign = true;
    queue.push(piece);
    wake?.();
  });
  const job = generation.done.then(() => { finished = true; wake?.(); }, (e) => { failure = e; finished = true; wake?.(); });

  const written: string[] = [];
  let lastProgress = -1;
  try {
    for (;;) {
      if (!queue.length && !finished) {
        // Wake at least once a second so a first-time model download can report its progress.
        await new Promise<void>((r) => { wake = r; window.setTimeout(r, 1000); });
      }
      wake = null;
      const writer = modelState("writer");
      if (!started && writer.loading && writer.progress !== lastProgress) {
        lastProgress = writer.progress;
        yield ["status", { phase: "loading", progress: writer.progress, model: describeWriter() }];
      }
      while (queue.length) {
        const piece = queue.shift()!;
        if (!started) {
          started = true;
          yield ["status", { phase: "writing", model: describeWriter() }];
        }
        written.push(piece);
        if (hasForeignScript(piece)) throw new ForeignScript();
        yield ["token", { text: piece }];
      }
      if (finished && !queue.length) break;
    }
    await job;
    if (failure) throw failure;
  } catch (e) {
    generation.cancel();
    if (e instanceof ForeignScript) {
      yield ["draft", { status: "discarded", reason: "The draft drifted into another language, so it was withheld." }];
    } else if (e instanceof WriterBusy) {
      yield ["draft", { status: "ai_busy", reason: "The writing model is busy with other drafts." }];
    } else {
      console.warn("draft unavailable", e);
      yield ["draft", { status: "ai_unavailable", reason: e instanceof ModelUnavailable
        ? "The writing model could not be loaded on this device." : "The writing model is not available right now." }];
    }
    return;
  } finally {
    // The reader went away (Stop, or the page moved on): stop the model too.
    if (!finished) generation.cancel();
  }
  const text = dropRepeats(stripMarkdown(written.join("")));
  yield ["status", { phase: "checking" }];
  const problem = text ? languageProblem(text, language) : "The writing model returned nothing.";
  if (problem) {
    yield ["draft", { status: "discarded", reason: problem }];
    return;
  }
  const checked = await groundingCheck(text, sources);
  let result = checked;
  let removed = 0;
  if (checked.supported_ratio < minSupported) {
    // The small browser model tends to follow a correct sentence with filler of its own.
    // Every sentence has been checked, so keep the ones the sources support and drop the rest;
    // withhold the draft only when none of it matches.
    const kept = checked.sentences.filter((s) => s.support === "supported" || s.support === "partial");
    if (!kept.some((s) => s.support === "supported")) {
      yield ["draft", { status: "discarded", reason: "The draft did not match the sources closely enough, so it was withheld." }];
      return;
    }
    removed = checked.sentences.filter((s) => s.support !== "heading").length - kept.length;
    const counted = kept.length;
    result = { ...checked, sentences: kept,
               supported_ratio: counted ? Math.round((kept.filter((s) => s.support === "supported").length / counted) * 100) / 100 : 0 };
  }
  const unsupported = result.sentences.filter((s) => s.support === "unsupported").length;
  yield ["draft", { status: "ok", text: renderGrounded(result), grounding: result, unsupported, removed, model: describeWriter() }];
}
