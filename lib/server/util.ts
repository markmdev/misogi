import crypto from "node:crypto";

export type ErrorCode = "invalid" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "resting" | "internal";

const STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  resting: 503,
  internal: 500,
};

/** An error whose message is safe to show to a user or an agent. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

export const fail = (code: ErrorCode, message: string, hint?: string): never => {
  throw new AppError(code, message, hint);
};

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function id(prefix = ""): string {
  const bytes = crypto.randomBytes(12);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 36];
  return prefix ? `${prefix}_${out}` : out;
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(s: string, max = 48): string {
  const base = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return base || "challenge";
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date (YYYY-MM-DD) for `at` in the given IANA time zone. */
export function dateIn(tz: string, at: Date = new Date()): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a), both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

export function addYear(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
