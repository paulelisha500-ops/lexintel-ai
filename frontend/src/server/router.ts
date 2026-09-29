/** A small request router with FastAPI-like semantics (path params, JSON/form bodies, SSE). */
import { currentUser, HttpError } from "./core";
import type { UserRow } from "./store";

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  form: FormData | null;
  headers: Headers;
  /** The signed-in user (throws 401 if there is none). */
  user(): UserRow;
}

export class Sse {
  constructor(public events: AsyncGenerator<[string, unknown]>) {}
}

export class Raw {
  constructor(public body: Blob, public contentType: string, public filename?: string) {}
}

export class Status {
  constructor(public status: number, public body: unknown = null) {}
}

export type Handler = (req: Req) => unknown | Promise<unknown>;

interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler }
const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, pattern, keys, handler });
}

export async function dispatchRequest(method: string, fullPath: string, headers: Headers, body: BodyInit | null | undefined): Promise<unknown> {
  const url = new URL(fullPath, "http://local");
  const path = url.pathname;
  let matchedPath = false;
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (!m) continue;
    matchedPath = true;
    if (r.method !== method) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    let json: any = null;
    let form: FormData | null = null;
    if (body instanceof FormData) form = body;
    else if (body instanceof URLSearchParams) json = Object.fromEntries(body.entries());
    else if (typeof body === "string" && body) {
      try { json = JSON.parse(body); } catch { throw new HttpError(422, "The request body is not valid JSON."); }
    }
    let cached: UserRow | null = null;
    const req: Req = {
      method, path, params, query: url.searchParams, body: json ?? {}, form, headers,
      user: () => (cached ??= currentUser(headers.get("Authorization"))),
    };
    return r.handler(req);
  }
  throw new HttpError(matchedPath ? 405 : 404, matchedPath ? "Method Not Allowed" : "Not Found");
}

// ---------------------------------------------------------------------------
// Validation helpers (the same rules as the pydantic models)
// ---------------------------------------------------------------------------

export function str(body: any, key: string, opts: { min?: number; max?: number; required?: boolean; pattern?: RegExp; label?: string } = {}): string | null {
  const v = body?.[key];
  const label = opts.label ?? key;
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new HttpError(422, `${label}: Field required`);
    return v === "" && !opts.required ? "" : null;
  }
  if (typeof v !== "string") throw new HttpError(422, `${label}: Input should be a valid string`);
  if (opts.min !== undefined && v.length < opts.min) throw new HttpError(422, `${label}: String should have at least ${opts.min} characters`);
  if (opts.max !== undefined && v.length > opts.max) throw new HttpError(422, `${label}: String should have at most ${opts.max} characters`);
  if (opts.pattern && !opts.pattern.test(v)) throw new HttpError(422, `${label}: String should match pattern '${opts.pattern.source}'`);
  return v;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string, required = true): T | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(422, `${label}: Field required`);
    return null;
  }
  if (!allowed.includes(value as T)) throw new HttpError(422, `${label}: Input should be ${allowed.map((a) => `'${a}'`).join(", ")}`);
  return value as T;
}

export function isoDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(422, `${label}: Input should be a valid date`);
  }
  return value;
}

export function plausibleDeadline(value: unknown): string | null {
  const d = isoDate(value, "statutory_deadline");
  if (d && (d < "2000-01-01" || d > "2100-12-31")) throw new HttpError(422, "statutory_deadline: The deadline must be a date between 2000 and 2100.");
  return d;
}

export function bool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return value === "true" || value === "1";
}

export const has = (body: any, key: string) => body && Object.prototype.hasOwnProperty.call(body, key);
