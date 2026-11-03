import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { all, one, run, tx } from "./db";
import { AppError, id, nowIso, randomToken, sha256 } from "./util";

export const SESSION_COOKIE = "misogi_session";
const SESSION_DAYS = 365;

export type UserRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar: string;
  motivation_style: string;
  timezone: string;
  agent_name: string | null;
  agent_kind: string | null;
  agent_seen_at: string | null;
  /** How many times an agent has connected with a Connect message; it signs the current one (lib/server/oauth.ts). */
  connect_epoch: number;
  is_demo: number;
  created_at: string;
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (32+ chars)");
  return "dev-only-session-secret-change-me-0123456789";
}

export function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeSessionValue(userId: string, days = SESSION_DAYS): string {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function readSessionValue(value: string | undefined | null): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, mac] = parts;
  const expected = sign(`${userId}.${expStr}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expStr) < Date.now() / 1000) return null;
  return userId;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 86400,
};

/** The signed-in user from the session cookie, or null. Safe to call during render. */
export async function currentUser(): Promise<UserRow | null> {
  const jar = await cookies();
  const userId = readSessionValue(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  return one<UserRow>("SELECT * FROM users WHERE id = ?", userId) ?? null;
}

/** Sets the session cookie. Only callable from Server Actions and Route Handlers. */
export async function startSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, makeSessionValue(userId), sessionCookieOptions);
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

// ---------- API keys (for agents) ----------

/** A new agent key; `clientId` when an OAuth client (such as Muse) got it by signing in. */
export function createApiKey(userId: string, clientId: string | null = null): { key: string; prefix: string } {
  const key = `msk_${randomToken(24)}`;
  const prefix = key.slice(0, 10);
  run(
    "INSERT INTO api_keys (id, user_id, key_hash, prefix, created_at, client_id) VALUES (?, ?, ?, ?, ?, ?)",
    id("key"),
    userId,
    sha256(key),
    prefix,
    nowIso(),
    clientId,
  );
  return { key, prefix };
}

/** Replaces all of a user's keys with a fresh one: every agent is cut off, Muse included, and any Connect message stops working. */
export function rotateApiKey(userId: string): { key: string; prefix: string } {
  return tx(() => {
    run("UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", nowIso(), userId);
    run("UPDATE users SET connect_epoch = connect_epoch + 1 WHERE id = ?", userId);
    return createApiKey(userId);
  });
}

export type ApiCaller = { user: UserRow; /** The OAuth client's name when the key came from signing in. */ client: string | null };

export function callerForApiKey(key: string): ApiCaller | null {
  if (!key.startsWith("msk_")) return null;
  const row = one<{ id: string; user_id: string; client: string | null }>(
    `SELECT k.id, k.user_id, c.name AS client FROM api_keys k LEFT JOIN oauth_clients c ON c.id = k.client_id
     WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
    sha256(key),
  );
  if (!row) return null;
  run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", nowIso(), row.id);
  const user = one<UserRow>("SELECT * FROM users WHERE id = ?", row.user_id);
  return user ? { user, client: row.client } : null;
}

export function bearerFrom(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (m) return m[1].trim();
  const x = req.headers.get("x-misogi-key");
  return x ? x.trim() : null;
}

export function requireApiCaller(req: Request): ApiCaller {
  const key = bearerFrom(req);
  if (!key) throw new AppError("unauthorized", "Missing Misogi credential.", "Connect first: the person's Connect message links your setup steps.");
  const caller = callerForApiKey(key);
  if (!caller) throw new AppError("unauthorized", "This Misogi credential isn't valid anymore.", "Connect again: ask the person to copy a fresh message from Misogi's Connect page.");
  return caller;
}

export function keyStatus(userId: string): { has_key: boolean; last_used_at: string | null } {
  const rows = all<{ last_used_at: string | null }>(
    "SELECT last_used_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL AND client_id IS NULL ORDER BY created_at DESC",
    userId,
  );
  const used = rows.map((r) => r.last_used_at).filter(Boolean).sort().reverse();
  return { has_key: rows.length > 0, last_used_at: (used[0] as string) ?? null };
}

// ---------- One-time sign-in links ----------

export function createSignInToken(userId: string, minutes = 15): string {
  const token = randomToken(24);
  run(
    "INSERT INTO sign_in_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    sha256(token),
    userId,
    new Date(Date.now() + minutes * 60_000).toISOString(),
  );
  return token;
}

export function redeemSignInToken(token: string): string | null {
  return tx(() => {
    const row = one<{ user_id: string; expires_at: string; used_at: string | null }>(
      "SELECT user_id, expires_at, used_at FROM sign_in_tokens WHERE token_hash = ?",
      sha256(token),
    );
    if (!row || row.used_at || row.expires_at < nowIso()) return null;
    run("UPDATE sign_in_tokens SET used_at = ? WHERE token_hash = ?", nowIso(), sha256(token));
    return row.user_id;
  });
}

/** Public origin of the app, for links handed to agents. */
export async function publicOrigin(): Promise<string> {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
