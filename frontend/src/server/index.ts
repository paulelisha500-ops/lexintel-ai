/**
 * LexIntel's API, running inside the browser. The frontend talks to it
 * exactly as it talks to the Python server -- same paths, same JSON, same
 * errors, same server-sent event streams -- through `localFetch`, which
 * returns real `Response` objects. Data lives in this browser's IndexedDB;
 * the AI models run on this device.
 */
import { flush, loadDatabase, save, setDatabase } from "./store";
import { buildInitialDatabase } from "./seed";
import { resumePendingJobs } from "./jobs";
import { dispatchRequest, Raw, Sse, Status } from "./router";
import { HttpError } from "./core";
import { languageOf, localize, translate } from "./messages";
import { warm } from "./ai/models";
import "./routes/auth";
import "./routes/scheduling";
import "./routes/cases";
import "./routes/evidence";
import "./routes/complaints";
import "./routes/courtroom";
import "./routes/research";
import "./routes/insights";

let booting: Promise<void> | null = null;

export function boot(): Promise<void> {
  if (!booting) {
    booting = (async () => {
      let d = await loadDatabase();
      if (!d) {
        d = await buildInitialDatabase();
        setDatabase(d);
        await flush();
      }
      resumePendingJobs();
      // The meaning model backs most features; fetch it early (cached after the first visit).
      warm("embeddings").catch((e) => console.warn("embeddings model not loaded yet", e));
    })().catch((e) => {
      booting = null;
      throw e;
    });
  }
  return booting;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  if (status === 204 || body === undefined) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function sseResponse(stream: Sse, signal?: AbortSignal | null, lang = "en"): Response {
  const encoder = new TextEncoder();
  const events = stream.events;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => {
        events.return(undefined).catch(() => undefined);
        try { controller.error(abortError()); } catch { /* already closed */ }
      }, { once: true });
    },
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) { controller.close(); return; }
        const [event, data] = value;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(localize(data, lang))}\n\n`));
      } catch (e) {
        console.error("stream failed", e);
        controller.error(e);
      }
    },
    cancel() {
      events.return(undefined).catch(() => undefined);
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** Drop-in replacement for `fetch` on API paths (`path` is relative to the API root, e.g. "/cases?limit=5"). */
export async function localFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const lang = languageOf(headers.get("Accept-Language"));
  const requestId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  try {
    if (init.signal?.aborted) throw abortError();
    await boot();
    const work = dispatchRequest((init.method ?? "GET").toUpperCase(), path, headers, init.body as BodyInit | null);
    const result = init.signal
      ? await Promise.race([work, new Promise<never>((_, reject) => init.signal!.addEventListener("abort", () => reject(abortError()), { once: true }))])
      : await work;
    save();
    if (result instanceof Sse) return sseResponse(result, init.signal, lang);
    if (result instanceof Raw) {
      return new Response(result.body, { status: 200, headers: {
        "Content-Type": result.contentType,
        ...(result.filename ? { "Content-Disposition": `inline; filename="${encodeURIComponent(result.filename)}"` } : {}),
      } });
    }
    if (result instanceof Status) return json(result.status, localize(result.body, lang) ?? undefined, { "X-Request-ID": requestId });
    return json(200, localize(result, lang) ?? null, { "X-Request-ID": requestId });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    if (e instanceof HttpError) {
      return json(e.status, { detail: translate(e.detail, lang), request_id: requestId }, { ...(e.headers ?? {}), "X-Request-ID": requestId });
    }
    if ((e as Error)?.name === "QuotaExceededError") {
      return json(507, { detail: translate("This browser has run out of storage space for LexIntel. Free some space and try again.", lang), request_id: requestId });
    }
    console.error("unhandled error", path, e);
    return json(500, { detail: translate("Something went wrong on our side. The error has been logged.", lang), request_id: requestId });
  }
}

// Development builds expose the in-browser API for automated checks from the console.
if (import.meta.env.DEV) (window as any).__lexintel = { localFetch, boot };
