/// <reference lib="webworker" />
/**
 * The AI models, run in a Web Worker so the page never freezes while they
 * work. Everything runs on the user's own device through ONNX Runtime Web;
 * the model files come from the Hugging Face Hub once and are then cached by
 * the browser.
 *
 *   embed       paraphrase-multilingual-MiniLM-L12-v2 (Arabic + English meaning)
 *   transcribe  Whisper base (speech to text, Arabic + English)
 *   generate    Qwen2.5 0.5B Instruct (checked drafts; WebGPU when available)
 */
import { env, InterruptableStoppingCriteria, pipeline, TextStreamer } from "@huggingface/transformers";
import { MODELS } from "./modelIds";

env.allowLocalModels = false;

/**
 * Model files are cached by the browser (Cache API) so later visits start
 * quickly. Very large files can exceed what a browser is willing to store;
 * those are kept in memory for this session instead, so the model still runs.
 */
const inMemory = new Map<string, Blob>();
const CACHE_NAME = "transformers-cache";
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = {
  async match(key: string) {
    const blob = inMemory.get(key);
    if (blob) return new Response(blob, { headers: { "content-type": "application/octet-stream", "content-length": String(blob.size) } });
    return (await caches.open(CACHE_NAME)).match(key);
  },
  async put(key: string, response: Response) {
    try {
      await (await caches.open(CACHE_NAME)).put(key, response);
    } catch {
      /* not storable in this browser: it is simply downloaded again next session */
    }
  },
} as any;


type Request =
  | { id: number; op: "embed"; texts: string[] }
  | { id: number; op: "transcribe"; audio: Float32Array; language?: string | null }
  | { id: number; op: "generate"; messages: { role: string; content: string }[]; maxTokens: number }
  | { id: number; op: "load"; model: keyof typeof MODELS }
  | { id: number; op: "unload"; model: keyof typeof MODELS }
  | { id: number; op: "interrupt"; target: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const loaded: Partial<Record<keyof typeof MODELS, Promise<any>>> = {};
const running = new Map<number, InterruptableStoppingCriteria>();

/** True once the text keeps repeating itself: the same 4-word phrase three times in the last 60 words. */
function looping(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean).slice(-60);
  const seen = new Map<string, number>();
  for (let i = 0; i + 4 <= words.length; i++) {
    const key = words.slice(i, i + 4).join(" ");
    const n = (seen.get(key) ?? 0) + 1;
    if (n >= 3) return true;
    seen.set(key, n);
  }
  return false;
}

async function webgpuAvailable(): Promise<boolean> {
  try {
    const gpu = (navigator as any).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function progress(model: string) {
  return (p: any) => {
    if (p?.status === "progress" && typeof p.progress === "number") {
      scope.postMessage({ kind: "progress", model, file: p.file, progress: p.progress });
    }
  };
}

/**
 * Download one large model file in 16 MB ranges (each retried) into the cache
 * the pipeline reads from. A single multi-hundred-megabyte request is easily
 * cut off on a slow or flaky connection; ranges resume where they stopped.
 */
async function prefetch(model: string, repo: string, file: string): Promise<void> {
  const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
  const cache = await caches.open(CACHE_NAME);
  if (inMemory.has(url) || (await cache.match(url))) return;
  const head = await fetch(url, { headers: { Range: "bytes=0-0" } });
  const total = Number(head.headers.get("content-range")?.split("/")[1] ?? head.headers.get("content-length"));
  if (!head.ok || !total) throw new Error(`Could not reach ${file} (HTTP ${head.status}).`);
  const CHUNK = 16 * 1024 * 1024;
  const parts: Blob[] = [];
  for (let start = 0; start < total; start += CHUNK) {
    const end = Math.min(total, start + CHUNK) - 1;
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
        if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        if (blob.size !== end - start + 1) throw new Error("short read");
        parts.push(blob);
        break;
      } catch (e) {
        if (attempt >= 5) throw new Error(`Downloading ${file} failed: ${(e as Error).message}`);
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
    }
    scope.postMessage({ kind: "progress", model, file, progress: Math.round(((end + 1) / total) * 100) });
  }
  const blob = new Blob(parts);
  try {
    await cache.put(url, new Response(blob, { headers: { "content-type": "application/octet-stream", "content-length": String(total) } }));
  } catch {
    inMemory.set(url, blob); // too large for this browser's cache: keep it for this session
  }
}

function load(model: keyof typeof MODELS): Promise<any> {
  if (!loaded[model]) {
    const started = performance.now();
    const cb = progress(model);
    let p: Promise<any>;
    if (model === "embeddings") {
      p = pipeline("feature-extraction", MODELS.embeddings, { dtype: "q8", progress_callback: cb });
    } else if (model === "speech") {
      p = pipeline("automatic-speech-recognition", MODELS.speech, { dtype: "q8", progress_callback: cb });
    } else {
      // 4-bit with fp16 on the GPU; 8-bit integer on the CPU, where it runs faster than 4-bit.
      p = webgpuAvailable().then(async (gpu) => {
        await prefetch(model, MODELS.writer, gpu ? "onnx/model_q4f16.onnx" : "onnx/model_quantized.onnx");
        return pipeline("text-generation", MODELS.writer, {
          dtype: gpu ? "q4f16" : "q8",
          device: gpu ? "webgpu" : "wasm",
          progress_callback: cb,
        });
      });
    }
    loaded[model] = p.then(
      (pipe) => {
        scope.postMessage({ kind: "loaded", model, seconds: (performance.now() - started) / 1000 });
        return pipe;
      },
      (err) => {
        delete loaded[model];
        scope.postMessage({ kind: "failed", model, error: String(err?.message ?? err) });
        throw err;
      },
    );
  }
  return loaded[model]!;
}

async function handle(req: Request): Promise<unknown> {
  switch (req.op) {
    case "load":
      await load(req.model);
      return true;
    case "unload": {
      const p = loaded[req.model];
      delete loaded[req.model];
      if (p) (await p.catch(() => null))?.dispose?.();
      return true;
    }
    case "embed": {
      const extractor = await load("embeddings");
      const out: number[][] = [];
      // Small batches keep memory flat on long documents.
      for (let i = 0; i < req.texts.length; i += 16) {
        const batch = req.texts.slice(i, i + 16).map((t) => t || " ");
        const tensor = await extractor(batch, { pooling: "mean", normalize: true });
        out.push(...(tensor.tolist() as number[][]));
      }
      return out;
    }
    case "transcribe": {
      const asr = await load("speech");
      const result = await asr(req.audio, {
        language: req.language === "ar" ? "arabic" : req.language === "en" ? "english" : undefined,
        task: "transcribe",
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      return { text: String(result?.text ?? "").trim() };
    }
    case "interrupt":
      running.get(req.target)?.interrupt();
      return true;
    case "generate": {
      const generator = await load("writer");
      const stopper = new InterruptableStoppingCriteria();
      running.set(req.id, stopper);
      let written = "";
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          written += text;
          // Small models can fall into a loop under greedy decoding; stop rather than pad the draft.
          if (looping(written)) { stopper.interrupt(); return; }
          scope.postMessage({ kind: "token", id: req.id, text });
        },
      });
      try {
        await generator(req.messages, {
          max_new_tokens: req.maxTokens,
          do_sample: false,
          repetition_penalty: 1.15,
          no_repeat_ngram_size: 4,
          stopping_criteria: stopper,
          streamer,
        });
      } finally {
        running.delete(req.id);
      }
      return written;
    }
  }
}

scope.onmessage = (event: MessageEvent<Request>) => {
  const req = event.data;
  handle(req).then(
    (result) => scope.postMessage({ kind: "result", id: req.id, ok: true, result }),
    (err) => scope.postMessage({ kind: "result", id: req.id, ok: false, error: String(err?.message ?? err) }),
  );
};
