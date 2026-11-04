// Photos and short videos on logs. Anyone adding one, the site or an agent, gets an upload link, sends the
// file's bytes to it, and passes the media id it gets back to log_progress. Photos are re-encoded (turned upright,
// every bit of EXIF, GPS included, dropped); videos are kept as sent, minus where they were filmed. Climb pages
// are public, so both are too.

import crypto from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import type { LogMedia } from "@/lib/shared/types";
import { sign, type UserRow } from "./auth";
import { all, one, run } from "./db";
import { getChallenge, requireMember, type ChallengeRow } from "./domain/challenges";
import { modelFor, outputText, respond } from "./ai/client";
import { rateLimit } from "./http";
import { deleteObject, getObject, putObject } from "./storage";
import { AppError, id, nowIso } from "./util";

const MB = 1024 * 1024;
const PHOTO_MAX = 25 * MB;
const VIDEO_MAX = 100 * MB;
export const MEDIA_PER_LOG = 4;
const LINK_MINUTES = 30;
const UNUSED_HOURS = 24;

type MediaRow = {
  id: string;
  kind: string;
  challenge_id: string;
  user_id: string;
  log_id: string | null;
  path: string;
  mime: string;
  width: number | null;
  height: number | null;
  caption: string | null;
};

// ---------- Upload links ----------

/** A link that takes uploads into this person's climb for half an hour. Signed, not stored. */
export function uploadLink(origin: string, user: UserRow, slug: string) {
  const c = getChallenge(slug);
  requireMember(c, user.id);
  const exp = Math.floor(Date.now() / 1000) + LINK_MINUTES * 60;
  const payload = `${user.id}.${c.id}.${exp}`;
  const token = `${Buffer.from(payload).toString("base64url")}.${sign(`upload.${payload}`).slice(0, 32)}`;
  return {
    upload_url: `${origin}/api/v1/uploads/${token}`,
    expires_at: new Date(exp * 1000).toISOString(),
    accepts: "Photos (JPEG, PNG, WebP, AVIF) up to 25 MB, videos (MP4, MOV, WebM) up to 100 MB",
  };
}

function linkOwner(token: string): { user: UserRow; challenge: ChallengeRow } | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const payload = Buffer.from(body, "base64url").toString();
  const expected = Buffer.from(sign(`upload.${payload}`).slice(0, 32));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const [userId, challengeId, exp] = payload.split(".");
  if (Number(exp) * 1000 < Date.now()) return null;
  const user = one<UserRow>("SELECT * FROM users WHERE id = ?", userId);
  const challenge = one<ChallengeRow>("SELECT * FROM challenges WHERE id = ?", challengeId);
  return user && challenge ? { user, challenge } : null;
}

// ---------- Receiving a file ----------

type Sniffed = { kind: "photo" } | { kind: "video"; mime: string; ext: string } | { kind: "heic" } | null;

const MOVIE_BRANDS = ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "3gp4", "3gp5", "3gp6", "qt  "];

/** The top-level boxes of an MP4 or MOV file: type, start and end. Stops at the first box that can't be one. */
function* boxes(b: Buffer) {
  for (let at = 0; at + 8 <= b.length; ) {
    let size = b.readUInt32BE(at);
    if (size === 1 && at + 16 <= b.length) size = Number(b.readBigUInt64BE(at + 8));
    if (size === 0) size = b.length - at;
    if (size < 8 || at + size > b.length) return;
    yield { type: b.toString("latin1", at + 4, at + 8), start: at, end: at + size };
    at += size;
  }
}

/** What the bytes are, whatever the sender called them. A video must really be one: its header, its index and its frames. */
function sniff(b: Buffer): Sniffed {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "photo" };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "photo" };
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return { kind: "photo" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 && b.subarray(0, 64).includes("webm"))
    return { kind: "video", mime: "video/webm", ext: "webm" };
  if (b.toString("latin1", 4, 8) === "ftyp") {
    const brand = b.toString("latin1", 8, 12);
    if (["avif", "avis", "mif1", "msf1"].includes(brand)) return { kind: "photo" };
    if (["heic", "heix", "hevc", "heim", "heis"].includes(brand)) return { kind: "heic" };
    const types = new Set([...boxes(b)].map((x) => x.type));
    if (!MOVIE_BRANDS.includes(brand) || !types.has("moov") || !types.has("mdat")) return null;
    return brand === "qt  " ? { kind: "video", mime: "video/quicktime", ext: "mov" } : { kind: "video", mime: "video/mp4", ext: "mp4" };
  }
  return null;
}

// A place as ISO 6709 writes it, the way phones store where a video was filmed: "+40.4461-079.9822+250.000/".
const ISO6709 = /[+-]\d{2}(\.\d+)?[+-]\d{3}(\.\d+)?([+-]\d+(\.\d+)?)?(CRS[\w:]+)?\//g;

/**
 * Blanks where a video was filmed from its metadata (its moov box), in place, so the file stays valid without
 * re-encoding: the ISO 6709 text phones write, and the 3GPP "loci" box with the same place as numbers, which is
 * zeroed and becomes a "free" box players skip.
 */
function stripVideoLocation(b: Buffer) {
  for (const box of boxes(b)) {
    if (box.type !== "moov") continue;
    const text = b.toString("latin1", box.start, box.end);
    for (const m of text.matchAll(ISO6709)) b.fill(0x20, box.start + m.index, box.start + m.index + m[0].length);
    for (let i = text.indexOf("loci"); i >= 4; i = text.indexOf("loci", i + 4)) {
      const at = box.start + i - 4;
      const size = b.readUInt32BE(at);
      if (size < 8 || at + size > box.end) continue;
      b.write("free", at + 4, "latin1");
      b.fill(0, at + 8, at + size);
    }
  }
}

/** The body, up to VIDEO_MAX, copied once. */
async function readBody(req: Request): Promise<Buffer> {
  if (!req.body) throw new AppError("invalid", "Send the file's bytes as the request body.");
  const tooBig = () => new AppError("too_large", "That file is over 100 MB. Send a shorter video.");
  const declared = Number(req.headers.get("content-length"));
  const out = Buffer.allocUnsafe(declared > 0 && declared <= VIDEO_MAX ? declared : VIDEO_MAX);
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > out.length) {
      await reader.cancel();
      throw tooBig();
    }
    out.set(value, size);
    size += value.byteLength;
  }
  return out.subarray(0, size);
}

// Each upload holds its file in memory while it's checked and stored: a few at a time keeps the server well inside its 4 GB.
const AT_ONCE = 3;
const slots = globalThis as unknown as { __uploads?: { busy: number; waiting: (() => void)[] } };

async function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const q = (slots.__uploads ??= { busy: 0, waiting: [] });
  if (q.busy >= AT_ONCE) await new Promise<void>((go) => q.waiting.push(go));
  else q.busy++;
  try {
    return await work();
  } finally {
    const next = q.waiting.shift();
    if (next) next();
    else q.busy--;
  }
}

/** Takes one file sent to an upload link and keeps it, unattached until a log names it. */
export async function receiveUpload(token: string, req: Request, origin: string) {
  const owner = linkOwner(token);
  if (!owner) throw new AppError("not_found", "This upload link isn't valid or has run out.", "Call get_upload_link for a new one.");
  const { user, challenge } = owner;
  rateLimit(`upload:${user.id}`, 20, 20);

  return oneAtATime(async () => {
    const data = await readBody(req);
    const what = sniff(data);
    if (what?.kind === "heic")
      throw new AppError("unsupported", "HEIC photos aren't supported yet.", "Convert it to JPEG first. iPhones do that themselves when you pick a photo on the site.");
    if (!what) throw new AppError("unsupported", "That isn't a photo or a video Misogi can show.", "Send a JPEG, PNG, WebP or AVIF photo, or an MP4, MOV or WebM video.");

    const mediaId = id("med");
    const folder = `logs/${mediaId}`;
    let row: { mime: string; width: number | null; height: number | null };
    if (what.kind === "photo") {
      if (data.length > PHOTO_MAX) throw new AppError("too_large", "That photo is over 25 MB.");
      const upright = sharp(data, { failOn: "error" }).rotate();
      let full: { data: Buffer; info: OutputInfo };
      let thumb: Buffer;
      try {
        full = await upright.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
        thumb = await upright.clone().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      } catch {
        throw new AppError("unsupported", "That photo couldn't be read.", "If it's HEIC, convert it to JPEG first. A damaged file can't be read either.");
      }
      await Promise.all([putObject(`${folder}/full.webp`, full.data, "image/webp"), putObject(`${folder}/thumb.webp`, thumb, "image/webp")]);
      row = { mime: "image/webp", width: full.info.width, height: full.info.height };
    } else {
      stripVideoLocation(data);
      await putObject(`${folder}/video.${what.ext}`, data, what.mime);
      row = { mime: what.mime, width: null, height: null };
    }
    run(
      `INSERT INTO media (id, kind, challenge_id, user_id, path, mime, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      mediaId,
      what.kind,
      challenge.id,
      user.id,
      folder,
      row.mime,
      row.width,
      row.height,
      nowIso(),
    );
    void dropUnused().catch((e) => console.error("[uploads] cleanup failed", e));
    const m = one<MediaRow>("SELECT * FROM media WHERE id = ?", mediaId)!;
    return { media_id: mediaId, ...withOrigin(toLogMedia(m), origin) };
  });
}

// ---------- Showing ----------

const EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

function toLogMedia(m: MediaRow): LogMedia {
  const base = `/media/${m.path}`;
  return m.kind === "photo"
    ? { id: m.id, kind: "photo", url: `${base}/full.webp`, thumb_url: `${base}/thumb.webp`, width: m.width, height: m.height, caption: m.caption }
    : { id: m.id, kind: "video", url: `${base}/video.${EXT[m.mime]}`, thumb_url: null, width: null, height: null, caption: null };
}

export function withOrigin(m: LogMedia, origin: string): LogMedia {
  return { ...m, url: origin + m.url, thumb_url: m.thumb_url && origin + m.thumb_url };
}

/** Each log's photos and videos, in the order they were added. */
export function mediaForLogs(logIds: string[]): Map<string, LogMedia[]> {
  const out = new Map<string, LogMedia[]>();
  if (!logIds.length) return out;
  const rows = all<MediaRow>(
    `SELECT * FROM media WHERE log_id IN (${logIds.map(() => "?").join(",")}) ORDER BY created_at`,
    ...logIds,
  );
  for (const r of rows) out.set(r.log_id!, [...(out.get(r.log_id!) ?? []), toLogMedia(r)]);
  return out;
}

/** Everything one climber added to one climb, newest first: the wall on their page. */
export function climbMedia(challengeId: string, userId: string, limit = 60) {
  return all<MediaRow & { logged_for: string; note: string }>(
    `SELECT m.*, l.logged_for, l.note FROM media m JOIN logs l ON l.id = m.log_id
     WHERE m.challenge_id = ? AND m.user_id = ? AND l.deleted_at IS NULL
     ORDER BY l.logged_for DESC, l.created_at DESC, m.created_at LIMIT ?`,
    challengeId,
    userId,
    limit,
  ).map((r) => ({ ...toLogMedia(r), date: r.logged_for, note: r.note }));
}

/** The stored file behind /media/logs/<id>/<file>, with a browser's Range passed through. */
export async function serveLogMedia(mediaId: string, file: string, range: string | null): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404 });
  // Only what's on a log is public: an upload no log took is nobody's to fetch.
  const m = one<MediaRow>("SELECT * FROM media WHERE id = ? AND kind IN ('photo', 'video') AND log_id IS NOT NULL", mediaId);
  if (!m) return notFound();
  const files = m.kind === "photo" ? ["full.webp", "thumb.webp"] : [`video.${EXT[m.mime]}`];
  if (!files.includes(file)) return notFound();
  const res = await getObject(`${m.path}/${file}`, range);
  if (res.status === 404 || res.status === 403) return notFound();
  if (res.status === 416) return new Response(null, { status: 416, headers: { "Content-Range": res.headers.get("content-range") ?? "bytes */0" } });
  if (!res.ok) return new Response("Unavailable", { status: 502 });
  const headers = new Headers({ "Content-Type": m.mime, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400" });
  for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

// ---------- Attaching ----------

/** Puts the person's own unattached uploads on their new log. Runs inside logProgress's transaction. */
export function attachMedia(userId: string, challengeId: string, logId: string, mediaIds: string[]) {
  const ids = [...new Set(mediaIds)];
  if (ids.length > MEDIA_PER_LOG) throw new AppError("invalid", `A log takes at most ${MEDIA_PER_LOG} photos or videos.`);
  for (const mid of ids) {
    const m = one<MediaRow>("SELECT * FROM media WHERE id = ? AND kind IN ('photo', 'video')", mid);
    if (!m || m.user_id !== userId || m.challenge_id !== challengeId)
      throw new AppError("not_found", `No upload "${mid}" for this person in this challenge.`, "Use the media_id an upload link answered with.");
    if (m.log_id) throw new AppError("conflict", `Upload "${mid}" is already on a log.`);
    run("UPDATE media SET log_id = ? WHERE id = ?", logId, mid);
  }
}

/** A log with photos and no words gets its words from the first photo, read by Muse Spark. */
export function queueCaption(logId: string) {
  void caption(logId).catch((e) => console.error(`[caption:${logId}]`, e instanceof AppError ? e.message : e));
}

async function caption(logId: string) {
  const m = one<MediaRow>("SELECT * FROM media WHERE log_id = ? AND kind = 'photo' ORDER BY created_at LIMIT 1", logId);
  if (!m) return;
  const c = one<ChallengeRow>("SELECT * FROM challenges WHERE id = ?", m.challenge_id)!;
  const res = await getObject(`${m.path}/full.webp`, null);
  if (!res.ok) return;
  const image = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const r = await respond(
    "fast",
    {
      instructions:
        `You write the words for one entry in someone's progress log on Misogi, from the photo they added. ` +
        `Their challenge is "${c.title}", counting ${c.metric_name}: that tells you which details in the photo matter to them. ` +
        `Say what the photo shows, plainly, the way they'd jot it themselves: "Spaghetti bolognese from scratch, parmesan on top". ` +
        `Only what's there, never what's missing. No "a photo of", no hashtags, no emoji, no praise, under 90 characters. Answer with the line only.`,
      input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/webp;base64,${image.toString("base64")}` }] }],
      max_output_tokens: 400,
    },
    { visitor: m.user_id },
  );
  const line = outputText(r).replace(/^["“']+|["”']+$/g, "").trim().slice(0, 140);
  if (line) run("UPDATE media SET caption = ?, model = ? WHERE id = ?", line, modelFor("fast"), m.id);
}

// ---------- Removing ----------

/** A removed log's photos and videos leave storage too. */
export function dropLogMedia(logId: string) {
  const rows = all<MediaRow>("SELECT * FROM media WHERE log_id = ?", logId);
  if (!rows.length) return;
  run("DELETE FROM media WHERE log_id = ?", logId);
  void Promise.all(rows.map(deleteFiles)).catch(() => {});
}

/** Uploads no log took within a day. */
async function dropUnused() {
  const cutoff = new Date(Date.now() - UNUSED_HOURS * 3600_000).toISOString();
  const rows = all<MediaRow>("SELECT * FROM media WHERE log_id IS NULL AND kind IN ('photo', 'video') AND created_at < ? LIMIT 20", cutoff);
  for (const r of rows) {
    // A log may have taken it since the list was read.
    if (run("DELETE FROM media WHERE id = ? AND log_id IS NULL", r.id).changes) await deleteFiles(r);
  }
}

function deleteFiles(m: MediaRow) {
  const files = m.kind === "photo" ? ["full.webp", "thumb.webp"] : [`video.${EXT[m.mime]}`];
  return Promise.all(files.map((f) => deleteObject(`${m.path}/${f}`)));
}
