import crypto from "node:crypto";
import { AppError } from "./util";

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });
}

export function errorJson(e: unknown) {
  if (e instanceof AppError) return json({ error: { code: e.code, message: e.message, hint: e.hint } }, { status: e.status });
  console.error("[http] unexpected error", e);
  return json({ error: { code: "internal", message: "Something went wrong on Misogi's side." } }, { status: 500 });
}

/** Public origin for links, from PUBLIC_URL or the request (behind Caddy). */
export function originOf(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

// ---------- Simple in-memory rate limiting (single server) ----------

const buckets = globalThis as unknown as { __rate?: Map<string, { tokens: number; at: number }> };

/** Token bucket: `perMinute` sustained, bursts up to `burst`. Throws AppError when exceeded. */
export function rateLimit(key: string, perMinute: number, burst = perMinute) {
  if (!buckets.__rate) buckets.__rate = new Map();
  const map = buckets.__rate;
  const now = Date.now();
  const b = map.get(key) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    map.set(key, b);
    throw new AppError("resting", "Too many requests. Wait a moment and try again.");
  }
  b.tokens -= 1;
  map.set(key, b);
  if (map.size > 20_000) for (const [k, v] of map) if (now - v.at > 10 * 60_000) map.delete(k);
}

/** Admin routes take the ADMIN_KEY in x-admin-key (open only in development when no key is set). */
export function adminAuthorized(req: Request): boolean {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return process.env.NODE_ENV !== "production";
  const given = req.headers.get("x-admin-key") ?? "";
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
