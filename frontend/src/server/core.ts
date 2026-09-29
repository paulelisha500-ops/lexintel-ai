/** Shared pieces of the in-browser server: errors, auth, roles, audit, ids. */
import { db, save, type UserRow } from "./store";

export class HttpError extends Error {
  constructor(public status: number, public detail: unknown, public headers?: Record<string, string>) {
    super(typeof detail === "string" ? detail : "Request failed");
  }
}

export const uuid = () => crypto.randomUUID();
export const nowISO = () => new Date().toISOString();

export const ROLES = { JUDGE: "judge", PROSECUTOR: "prosecutor", CLERK: "clerk", CASE_OFFICER: "case_officer", ADMIN: "admin" } as const;
const { JUDGE, PROSECUTOR, CLERK, CASE_OFFICER, ADMIN } = ROLES;
export const STAFF = [JUDGE, PROSECUTOR, CLERK, CASE_OFFICER, ADMIN];
export const CASE_BUILDERS = [CASE_OFFICER, CLERK, ADMIN];
export const CASE_EDITORS = [CASE_OFFICER, CLERK, ADMIN, JUDGE];
export const EVIDENCE_SUBMITTERS = [CASE_OFFICER, CLERK, PROSECUTOR, ADMIN];
export const COURTROOM_STAFF = [CLERK, JUDGE];
export const SCHEDULERS = [CLERK, CASE_OFFICER, JUDGE, ADMIN];
export const LIBRARIANS = [CLERK, CASE_OFFICER, PROSECUTOR, JUDGE, ADMIN];

export const TOKEN_MINUTES = 480;
export const MIN_PASSWORD_LENGTH = 10;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 15;

// ---------------------------------------------------------------------------
// Passwords (PBKDF2-SHA256, 150k iterations, per-user salt)
// ---------------------------------------------------------------------------

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = salt ? Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 150_000 }, key, 256);
  return { hash: b64(new Uint8Array(bits)), salt: b64(saltBytes) };
}

export async function verifyPassword(password: string, user: UserRow): Promise<boolean> {
  const { hash } = await hashPassword(password, user.password_salt);
  if (hash.length !== user.password_hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ user.password_hash.charCodeAt(i);
  return diff === 0;
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`at least ${MIN_PASSWORD_LENGTH} characters`);
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) problems.push("both letters and numbers");
  return problems;
}

export function checkPasswordPolicy(password: string): void {
  const problems = passwordProblems(password);
  if (problems.length) throw new HttpError(422, `Password must contain ${problems.join(" and ")}.`);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function issueToken(user: UserRow): string {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, "");
  const now = Math.floor(Date.now() / 1000);
  const d = db();
  d.tokens = d.tokens.filter((t) => t.exp > now);
  d.tokens.push({ token, user_id: user.id, iat: now, exp: now + TOKEN_MINUTES * 60 });
  save();
  return token;
}

export function revokeToken(token: string): void {
  const d = db();
  d.tokens = d.tokens.filter((t) => t.token !== token);
  save();
}

export type PublicUser = Omit<UserRow, "password_hash" | "password_salt" | "password_changed_at">;

export function publicUser(u: UserRow): PublicUser {
  const { password_hash: _h, password_salt: _s, password_changed_at: _c, ...rest } = u;
  return rest;
}

export function currentUser(authorization: string | null): UserRow {
  const expired = new HttpError(401, "Your session has expired. Please sign in again.", { "WWW-Authenticate": "Bearer" });
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) throw new HttpError(401, "Not authenticated", { "WWW-Authenticate": "Bearer" });
  const row = db().tokens.find((t) => t.token === token);
  if (!row || row.exp < Date.now() / 1000) throw expired;
  const user = db().users.find((u) => u.id === row.user_id);
  if (!user || !user.is_active) throw expired;
  if (user.password_changed_at && row.iat < Math.floor(Date.parse(user.password_changed_at) / 1000) - 1) throw expired;
  return user;
}

export function requireRole(user: UserRow, roles: string[]): UserRow {
  if (!roles.includes(user.role)) {
    throw new HttpError(403, `This action requires one of these roles: ${roles.join(", ")}.`);
  }
  return user;
}

// ---------------------------------------------------------------------------
// Audit log (append-only)
// ---------------------------------------------------------------------------

export function audit(user: UserRow | null, action: string, entityType: string | null = null,
                      entityId: string | null = null, detail: Record<string, unknown> | null = null): void {
  const d = db();
  d.counters.audit += 1;
  d.audit.push({
    id: d.counters.audit, at: nowISO(), user_id: user?.id ?? null, username: user?.username ?? null, role: user?.role ?? null,
    action, entity_type: entityType, entity_id: entityId, detail, ip: "this device",
  });
  save();
}

// ---------------------------------------------------------------------------
// Rate limits (per browser, same limits as the server)
// ---------------------------------------------------------------------------

export function rateHit(key: string, limit: number, windowSeconds: number): boolean {
  const d = db();
  const now = Date.now();
  const hits = (d.rate[key] ?? []).filter((t) => now - t < windowSeconds * 1000);
  if (hits.length >= limit) { d.rate[key] = hits; return false; }
  hits.push(now);
  d.rate[key] = hits;
  save();
  return true;
}
export function rateCount(key: string, windowSeconds: number): number {
  const now = Date.now();
  return (db().rate[key] ?? []).filter((t) => now - t < windowSeconds * 1000).length;
}
export function rateReset(key: string): void {
  delete db().rate[key];
  save();
}

// ---------------------------------------------------------------------------
// Keyed hashes (tracking codes, Emirates ID) -- HMAC with a per-install key
// ---------------------------------------------------------------------------

let hmacKey: Promise<CryptoKey> | null = null;
function installKey(): Promise<CryptoKey> {
  if (!hmacKey) {
    let secret = localStorage.getItem("lexintel.install-key");
    if (!secret) {
      secret = b64(crypto.getRandomValues(new Uint8Array(32)));
      localStorage.setItem("lexintel.install-key", secret);
    }
    hmacKey = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  return hmacKey;
}

export async function keyedHash(value: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await installKey(), new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newTrackingCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function normalizeEmiratesId(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 15 || !digits.startsWith("784")) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export function notFoundUnlessUuid(v: string, what = "Record"): string {
  if (!isUuid(v)) throw new HttpError(404, `${what} not found.`);
  return v;
}
