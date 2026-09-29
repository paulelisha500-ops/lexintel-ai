/** /auth/* -- sign-in, own account, staff accounts (admin). No self-registration. */
import {
  audit, checkPasswordPolicy, HttpError, hashPassword, issueToken, LOGIN_LOCKOUT_MINUTES, LOGIN_MAX_ATTEMPTS, nowISO,
  publicUser, rateCount, rateHit, rateReset, requireRole, ROLES, STAFF, TOKEN_MINUTES, uuid, verifyPassword, notFoundUnlessUuid,
} from "../core";
import { has, oneOf, route, Status, str } from "../router";
import { db, save } from "../store";

const SYSTEM_ROLES = Object.values(ROLES);

route("POST", "/auth/login", async (req) => {
  const username = String(req.body.username ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");
  const lockKey = `login:${username}`;
  if (rateCount(lockKey, LOGIN_LOCKOUT_MINUTES * 60) >= LOGIN_MAX_ATTEMPTS) {
    throw new HttpError(429, `Too many failed sign-in attempts. Try again in ${LOGIN_LOCKOUT_MINUTES} minutes.`);
  }
  const user = db().users.find((u) => u.username === username);
  const ok = user ? await verifyPassword(password, user) : (await hashPassword(password), false);
  if (!user || !ok) {
    rateHit(lockKey, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MINUTES * 60);
    audit(null, "auth.login_failed", "user", null, { username: username.slice(0, 64) });
    throw new HttpError(401, "Incorrect username or password.", { "WWW-Authenticate": "Bearer" });
  }
  if (!user.is_active) throw new HttpError(403, "This account has been disabled.");
  rateReset(lockKey);
  user.last_login_at = nowISO();
  save();
  audit(user, "auth.login", "user", user.id);
  return { access_token: issueToken(user), token_type: "bearer", role: user.role, full_name: user.full_name,
           user_id: user.id, username: user.username, expires_in_minutes: TOKEN_MINUTES };
});

route("GET", "/auth/me", (req) => publicUser(req.user()));

route("POST", "/auth/me/password", async (req) => {
  const user = req.user();
  if (!(await verifyPassword(String(req.body.current_password ?? ""), user))) throw new HttpError(400, "Your current password is incorrect.");
  const next = String(req.body.new_password ?? "");
  checkPasswordPolicy(next);
  const { hash, salt } = await hashPassword(next);
  Object.assign(user, { password_hash: hash, password_salt: salt, password_changed_at: nowISO() });
  save();
  audit(user, "auth.password_changed", "user", user.id);
  return new Status(204);
});

route("GET", "/auth/judges", (req) => {
  requireRole(req.user(), STAFF);
  return db().users.filter((u) => u.role === "judge" && u.is_active).sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((u) => ({ id: u.id, full_name: u.full_name }));
});

route("GET", "/auth/users", (req) => {
  requireRole(req.user(), ["admin"]);
  return [...db().users].sort((a, b) => a.full_name.localeCompare(b.full_name)).map(publicUser);
});

route("POST", "/auth/users", async (req) => {
  const admin = requireRole(req.user(), ["admin"]);
  const username = str(req.body, "username", { required: true, min: 3, max: 64, pattern: /^[A-Za-z0-9._-]+$/ })!.toLowerCase();
  const password = str(req.body, "password", { required: true, max: 128 })!;
  const fullName = str(req.body, "full_name", { required: true, min: 2, max: 255 })!;
  const role = oneOf(req.body.role, SYSTEM_ROLES, "role")!;
  if (db().users.some((u) => u.username === username)) throw new HttpError(409, "That username is already taken.");
  checkPasswordPolicy(password);
  const { hash, salt } = await hashPassword(password);
  const user = { id: uuid(), username, full_name: fullName, role, is_active: true, created_at: nowISO(), last_login_at: null,
                 password_hash: hash, password_salt: salt, password_changed_at: null };
  db().users.push(user);
  save();
  audit(admin, "user.created", "user", user.id, { username, role });
  return new Status(201, publicUser(user));
});

route("PATCH", "/auth/users/{user_id}", (req) => {
  const admin = requireRole(req.user(), ["admin"]);
  const id = notFoundUnlessUuid(req.params.user_id, "User");
  const target = db().users.find((u) => u.id === id);
  if (!target) throw new HttpError(404, "User not found.");
  const role = has(req.body, "role") && req.body.role !== null ? oneOf(req.body.role, SYSTEM_ROLES, "role") : null;
  const isActive = has(req.body, "is_active") && req.body.is_active !== null ? Boolean(req.body.is_active) : null;
  const fullName = has(req.body, "full_name") && req.body.full_name !== null ? str(req.body, "full_name", { min: 2, max: 255 }) : null;
  if (id === admin.id && (isActive === false || (role && role !== "admin"))) {
    throw new HttpError(400, "You can't disable your own account or remove your own admin role.");
  }
  const removingAdmin = target.role === "admin" && (isActive === false || (role !== null && role !== "admin"));
  if (removingAdmin && db().users.filter((u) => u.role === "admin" && u.is_active).length <= 1) {
    throw new HttpError(400, "At least one active administrator must remain.");
  }
  if (fullName) target.full_name = fullName;
  if (role) target.role = role;
  if (isActive !== null) target.is_active = isActive;
  save();
  audit(admin, "user.updated", "user", id, Object.fromEntries(Object.entries({ full_name: fullName, role, is_active: isActive }).filter(([, v]) => v !== null)));
  return publicUser(target);
});

route("POST", "/auth/users/{user_id}/reset-password", async (req) => {
  const admin = requireRole(req.user(), ["admin"]);
  const id = notFoundUnlessUuid(req.params.user_id, "User");
  const next = String(req.body.new_password ?? "");
  checkPasswordPolicy(next);
  const target = db().users.find((u) => u.id === id);
  if (!target) throw new HttpError(404, "User not found.");
  const { hash, salt } = await hashPassword(next);
  Object.assign(target, { password_hash: hash, password_salt: salt, password_changed_at: nowISO() });
  save();
  audit(admin, "user.password_reset", "user", id);
  return new Status(204);
});
