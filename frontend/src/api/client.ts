/**
 * Fetch wrapper. Attaches the bearer token, applies a timeout, retries
 * idempotent GETs once on network failure, and turns every error into an
 * ApiError with a human-readable message (backend `detail` string or object).
 */

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:8005/api/v1";

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let currentToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
// The language travels with every request so the server can answer in it;
// the few messages written on this side are translated below.
let currentLang: "en" | "ar" = "en";

export function setAuthToken(token: string | null) {
  currentToken = token;
}

export function setApiLanguage(lang: "en" | "ar") {
  currentLang = lang;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

const say = (en: string, ar: string) => (currentLang === "ar" ? ar : en);

function messageFrom(status: number, body: any): string {
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") return detail.message;
  if (Array.isArray(detail) && detail[0]?.msg) return detail.map((d: any) => d.msg).join("; ");
  if (status === 0) return say("Can't reach the LexIntel server. Check your connection and try again.",
                               "تعذّر الوصول إلى خادم LexIntel. تحقق من الاتصال وحاول مرة أخرى.");
  if (status === 413) return say("That file is too large.", "حجم الملف كبير جداً.");
  if (status === 429) return say("Too many requests. Please wait a moment and try again.",
                                 "عدد كبير من الطلبات. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.");
  if (status >= 500) return say("The server had a problem handling that request. Please try again.",
                                "واجه الخادم مشكلة في معالجة هذا الطلب. يرجى المحاولة مرة أخرى.");
  return say(`Request failed (${status}).`, `تعذّر تنفيذ الطلب (${status}).`);
}

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  retry?: boolean;
  anonymous?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 30000, retry = options.method === undefined || options.method === "GET", anonymous, ...init } = options;
  const headers: Record<string, string> = { Accept: "application/json", "Accept-Language": currentLang,
                                            ...(init.headers as Record<string, string>) };
  if (currentToken && !anonymous) headers.Authorization = `Bearer ${currentToken}`;
  if (init.body && !(init.body instanceof FormData) && !(init.body instanceof URLSearchParams)) {
    headers["Content-Type"] = "application/json";
  }

  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${API_BASE}${path}`, { ...init, headers, signal: init.signal ?? controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  };

  let res: Response;
  try {
    res = await attempt();
  } catch (err) {
    if (retry) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        res = await attempt();
      } catch {
        throw new ApiError(0, messageFrom(0, null));
      }
    } else if ((err as Error)?.name === "AbortError") {
      throw new ApiError(0, say("The request took too long. Please try again.",
                                "استغرق الطلب وقتاً طويلاً. يرجى المحاولة مرة أخرى."));
    } else {
      throw new ApiError(0, messageFrom(0, null));
    }
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (res.status === 401 && !anonymous) {
    onUnauthorized?.();
  }
  if (!res.ok) {
    throw new ApiError(res.status, messageFrom(res.status, body), body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "DELETE" }),
  postForm: <T>(path: string, form: FormData, opts?: RequestOptions) =>
    request<T>(path, { timeoutMs: 120000, ...opts, method: "POST", body: form }),
};

/** Multipart upload with progress (fetch has no upload progress events). */
export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
  timeoutMs = 30 * 60 * 1000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);
    xhr.timeout = timeoutMs;
    if (currentToken) xhr.setRequestHeader("Authorization", `Bearer ${currentToken}`);
    xhr.setRequestHeader("Accept-Language", currentLang);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = xhr.responseText;
      }
      if (xhr.status === 401) onUnauthorized?.();
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(xhr.status, messageFrom(xhr.status, body), body));
    };
    xhr.onerror = () => reject(new ApiError(0, messageFrom(0, null)));
    xhr.ontimeout = () => reject(new ApiError(0, say("The upload took too long. Please try again.",
                                                     "استغرق الرفع وقتاً طويلاً. يرجى المحاولة مرة أخرى.")));
    xhr.send(form);
  });
}

/**
 * POST and read a server-sent event stream (drafts written by the local model).
 * Calls `onEvent(name, data)` for each event and resolves when the stream ends.
 * Abort with `signal` — closing the stream also stops the model on the server.
 */
export async function streamEvents(
  path: string,
  body: unknown,
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Accept-Language": currentLang,
        "Content-Type": "application/json",
        ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    throw new ApiError(0, messageFrom(0, null));
  }
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok || !res.body) {
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, messageFrom(res.status, data), data);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (!data.length) continue;
        try {
          onEvent(event, JSON.parse(data.join("\n")));
        } catch {
          /* a malformed event is skipped, never fatal */
        }
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    throw new ApiError(0, "The connection closed before the answer finished.");
  }
}

/** Fetch a protected file as a blob URL (for previews/downloads that need the auth header). */
export async function fetchBlobUrl(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
  });
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, messageFrom(res.status, body), body);
  }
  return URL.createObjectURL(await res.blob());
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: string;
  full_name: string;
  user_id: string;
  username: string;
  expires_in_minutes: number;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const body = new URLSearchParams({ username, password });
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body,
    anonymous: true,
    retry: false,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}
