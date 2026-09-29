/**
 * Main-thread side of the AI worker: the same contract the Python backend's
 * model slots offered. A caller that cannot wait gets ModelUnavailable while
 * a model is still loading (and falls back to its non-AI path); background
 * jobs wait for the model.
 */
import { MODELS } from "./modelIds";

export class ModelUnavailable extends Error {}

type ModelKey = keyof typeof MODELS;

interface SlotState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  progress: number;
  loadSeconds: number | null;
  lastUsed: number | null;
  inUse: number;
}

const state: Record<ModelKey, SlotState> = {
  embeddings: { loaded: false, loading: false, error: null, progress: 0, loadSeconds: null, lastUsed: null, inUse: 0 },
  speech: { loaded: false, loading: false, error: null, progress: 0, loadSeconds: null, lastUsed: null, inUse: 0 },
  writer: { loaded: false, loading: false, error: null, progress: 0, loadSeconds: null, lastUsed: null, inUse: 0 },
};

const IDLE_UNLOAD_MS = 10 * 60 * 1000;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onToken?: (t: string) => void }>();
const fileProgress: Record<string, Record<string, number>> = {};

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.kind === "progress") {
      const files = (fileProgress[msg.model] ??= {});
      files[msg.file] = msg.progress;
      const values = Object.values(files);
      state[msg.model as ModelKey].progress = Math.round(Math.min(...values));
    } else if (msg.kind === "loaded") {
      Object.assign(state[msg.model as ModelKey], { loaded: true, loading: false, error: null, progress: 100, loadSeconds: msg.seconds });
    } else if (msg.kind === "failed") {
      Object.assign(state[msg.model as ModelKey], { loaded: false, loading: false, error: msg.error });
    } else if (msg.kind === "token") {
      pending.get(msg.id)?.onToken?.(msg.text);
    } else if (msg.kind === "result") {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (!p) return;
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new ModelUnavailable(msg.error));
    }
  };
  worker.onerror = (e) => {
    for (const k of Object.keys(state) as ModelKey[]) {
      if (state[k].loading) Object.assign(state[k], { loading: false, error: e.message || "The AI worker stopped." });
    }
  };
  return worker;
}

function call<T>(message: Record<string, unknown>, transfer: Transferable[] = [], onToken?: (t: string) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onToken });
    getWorker().postMessage({ ...message, id }, transfer);
  });
}

export function modelState(key: ModelKey): SlotState & { name: string } {
  return { ...state[key], name: MODELS[key] };
}

/** Start loading in the background (no-op if loaded or loading). */
export function warm(key: ModelKey): Promise<void> {
  const s = state[key];
  if (s.loaded) return Promise.resolve();
  s.loading = true;
  s.error = null;
  return call<boolean>({ op: "load", model: key }).then(() => undefined, (e) => {
    s.loading = false;
    s.error = String(e?.message ?? e);
    throw e;
  });
}

export async function unload(key: ModelKey): Promise<void> {
  await call({ op: "unload", model: key });
  Object.assign(state[key], { loaded: false, loading: false, progress: 0 });
}

export function ready(key: ModelKey): boolean {
  return state[key].loaded;
}

async function use<T>(key: ModelKey, wait: boolean, run: () => Promise<T>): Promise<T> {
  const s = state[key];
  if (!s.loaded) {
    if (!wait) {
      if (!s.loading) warm(key).catch(() => undefined);
      throw new ModelUnavailable(s.error ?? "The model is still loading.");
    }
    try {
      await warm(key);
    } catch (e) {
      throw new ModelUnavailable(String((e as Error)?.message ?? e));
    }
  }
  s.inUse++;
  try {
    return await run();
  } finally {
    s.inUse--;
    s.lastUsed = Date.now();
  }
}

// Give memory back when a model has been idle a while (the files stay cached).
setInterval(() => {
  for (const key of ["speech", "writer"] as ModelKey[]) {
    const s = state[key];
    if (s.loaded && !s.inUse && s.lastUsed && Date.now() - s.lastUsed > IDLE_UNLOAD_MS) unload(key).catch(() => undefined);
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

const vectorCache = new Map<string, Float32Array>();

/** Normalised vectors, one per text. `wait=false` throws ModelUnavailable while loading. */
export async function embed(texts: string[], wait = true): Promise<Float32Array[]> {
  const missing = [...new Set(texts.filter((t) => !vectorCache.has(t)))];
  if (missing.length) {
    const vectors = await use("embeddings", wait, () => call<number[][]>({ op: "embed", texts: missing }));
    missing.forEach((t, i) => {
      if (vectorCache.size > 20000) vectorCache.clear();
      vectorCache.set(t, Float32Array.from(vectors[i]));
    });
  } else if (!state.embeddings.loaded && !wait) {
    // Everything cached: no model needed.
  }
  return texts.map((t) => vectorCache.get(t)!);
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function meanVector(vectors: Float32Array[]): Float32Array {
  const out = new Float32Array(vectors[0].length);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i];
  let norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

/** Decode any browser-playable audio/video blob to 16 kHz mono samples. */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const data = await blob.arrayBuffer();
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  try {
    const buffer = await ctx.decodeAudioData(data);
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
    const out = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buffer.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close().catch(() => undefined);
  }
}

export async function transcribe(blob: Blob, language: string | null = null, wait = true): Promise<{ text: string }> {
  const audio = await decodeAudio(blob);
  if (audio.length < 1600) return { text: "" };
  return use("speech", wait, () => call<{ text: string }>({ op: "transcribe", audio, language }, [audio.buffer]));
}

// ---------------------------------------------------------------------------
// Writing model (one draft at a time, like the server's queue)
// ---------------------------------------------------------------------------

let writerQueue: Promise<unknown> = Promise.resolve();
let waiting = 0;
export const MAX_WAITING_DRAFTS = 3;

export function writerQueueLength(): number {
  return waiting;
}

export interface Generation { done: Promise<string>; cancel: () => void }

/** Queue a draft (one at a time). `cancel` stops it -- before it starts or mid-way. */
export function generate(messages: { role: string; content: string }[], maxTokens: number,
                         onToken: (text: string) => void): Generation {
  if (waiting >= MAX_WAITING_DRAFTS) return { done: Promise.reject(new WriterBusy()), cancel: () => undefined };
  waiting++;
  let cancelled = false;
  let requestId: number | null = null;
  const done = writerQueue.then(() => {
    waiting--;
    if (cancelled) return "";
    return use("writer", true, () => {
      requestId = nextId;
      return call<string>({ op: "generate", messages, maxTokens }, [], onToken);
    });
  });
  writerQueue = done.catch(() => undefined);
  return {
    done,
    cancel: () => {
      cancelled = true;
      if (requestId !== null) getWorker().postMessage({ op: "interrupt", id: -1, target: requestId });
    },
  };
}

export class WriterBusy extends Error {}

export function describeWriter(): string {
  return "Qwen2.5 0.5B Instruct · WebAssembly";
}
