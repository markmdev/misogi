// Photos and videos on logs, end to end against a running server with S3 configured.
//   BASE_URL=http://localhost:3000 bun test tests/media.test.ts
// What these hold: a photo's location never reaches the public page, a video plays in Safari (byte ranges),
// only the person's own uploads go on their log, and an upload link can't be forged or used for other files.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const BASE = process.env.BASE_URL || "http://localhost:3000";
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(BASE) && !process.env.ALLOW_REMOTE_TESTS)
  throw new Error(`Refusing to run against ${BASE}: the tests create accounts there. Set ALLOW_REMOTE_TESTS=1 if you mean it.`);

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(import.meta.dir, "fixtures", name)));

async function climber(name: string) {
  const r = await fetch(`${BASE}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ display_name: name, timezone: "America/New_York" }),
  });
  const account = (await r.json()) as { key: string; handle: string };
  await tool(account.key, "join_challenge", { challenge: "read-25-books" });
  return account;
}

async function tool(key: string, name: string, args: unknown = {}) {
  const r = await fetch(`${BASE}/api/v1/tools/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-misogi-agent": "test" },
    body: JSON.stringify(args),
  });
  return { status: r.status, body: (await r.json()) as Json };
}

async function upload(key: string, body: Uint8Array<ArrayBuffer>, type: string) {
  const link = await tool(key, "get_upload_link", { challenge: "read-25-books" });
  expect(link.status).toBe(200);
  const r = await fetch(link.body.upload_url, { method: "PUT", headers: { "content-type": type }, body });
  return { status: r.status, body: (await r.json()) as Json, link: link.body.upload_url as string };
}

/** Uploads and puts it on a new log: only what's on a log is served. */
async function logged(key: string, body: Uint8Array<ArrayBuffer>, type: string) {
  const up = await upload(key, body, type);
  expect(up.status).toBe(201);
  const log = await tool(key, "log_progress", { challenge: "read-25-books", note: "Test entry", media: [up.body.media_id] });
  expect(log.status).toBe(200);
  return up.body;
}

describe("photos and videos on a log", () => {
  test("a photo keeps its orientation and loses its location and camera data", async () => {
    const me = await climber("Photo Tester");
    const photo = await logged(me.key, fixture("photo-with-gps.jpg"), "image/jpeg");
    expect(photo.kind).toBe("photo");
    // The fixture is 1200×900 stored with "rotate 90°" in its EXIF, as phones save portrait shots.
    expect([photo.width, photo.height]).toEqual([900, 1200]);

    const served = await fetch(new URL(photo.url, BASE));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    const bytes = Buffer.from(await served.arrayBuffer());
    expect(bytes.includes("fixture-description-marker")).toBe(false);
    expect(bytes.includes("EXIF")).toBe(false);
    expect(bytes.includes("Exif")).toBe(false);
  });

  test("a video answers byte ranges, so Safari can play it", async () => {
    const me = await climber("Video Tester");
    const clip = fixture("clip.mp4");
    const video = await logged(me.key, clip, "video/mp4");
    expect(video.kind).toBe("video");
    const part = await fetch(new URL(video.url, BASE), { headers: { range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-99/${clip.length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
  });

  test("a phone video loses the place it was filmed", async () => {
    const me = await climber("Video Place Tester");
    const clip = fixture("clip-with-gps.mov");
    expect(Buffer.from(clip).includes("+40.4461")).toBe(true);
    const video = await logged(me.key, clip, "video/quicktime");
    const served = Buffer.from(await (await fetch(new URL(video.url, BASE))).arrayBuffer());
    expect(served.length).toBe(clip.length);
    expect(served.includes("+40.4461")).toBe(false);
    expect(served.includes("079.9822")).toBe(false);
    // The same place as numbers (latitude and longitude as fixed-point), in the 3GPP location box phones also write.
    const asNumbers = Buffer.from("ffb0048f00287233", "hex");
    expect(Buffer.from(clip).includes(asNumbers)).toBe(true);
    expect(served.includes(asNumbers)).toBe(false);
  });

  test("only what's on a log is served, only the person's own uploads go on their log, and a removed log's photos stop showing", async () => {
    const me = await climber("Owner Tester");
    const other = await climber("Other Tester");
    const up = await upload(me.key, fixture("photo-with-gps.jpg"), "image/jpeg");
    expect((await fetch(new URL(up.body.url, BASE))).status).toBe(404);

    const stolen = await tool(other.key, "log_progress", { challenge: "read-25-books", note: "Not mine", media: [up.body.media_id] });
    expect(stolen.body.error).toBeTruthy();

    const logged = await tool(me.key, "log_progress", { challenge: "read-25-books", media: [up.body.media_id] });
    expect(logged.status).toBe(200);
    const ctx = await tool(me.key, "get_challenge", { challenge: "read-25-books" });
    const log = ctx.body.recent_logs.find((l: Json) => l.id === logged.body.log_id);
    expect(log.media[0].url).toBe(up.body.url);

    const again = await tool(me.key, "log_progress", { challenge: "read-25-books", note: "Same photo twice", media: [up.body.media_id] });
    expect(again.body.error).toBeTruthy();

    await tool(me.key, "remove_log", { challenge: "read-25-books", log_id: logged.body.log_id });
    expect((await fetch(new URL(up.body.url, BASE))).status).toBe(404);
  });

  test("an upload link can't be altered, and takes only photos and videos", async () => {
    const me = await climber("Link Tester");
    const link = (await tool(me.key, "get_upload_link", { challenge: "read-25-books" })).body.upload_url as string;
    const [payload, mac] = link.split("/").pop()!.split(".");
    const base = link.slice(0, link.lastIndexOf("/") + 1);
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    for (const forged of [`${payload}.${flip(mac, mac.length - 1)}`, `${flip(payload, 3)}.${mac}`]) {
      const r = await fetch(base + forged, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: fixture("photo-with-gps.jpg") });
      expect(r.status).toBe(404);
    }

    const text = await fetch(link, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: new TextEncoder().encode("not a photo, whatever the header says") });
    expect(text.status).toBe(415);

    // A video's header on anything else: not a video, so not hosted.
    const fake = new Uint8Array(4096).map(() => Math.floor(Math.random() * 256));
    fake.set(fixture("clip.mp4").subarray(0, 32));
    const notVideo = await fetch(link, { method: "PUT", headers: { "content-type": "video/mp4" }, body: fake });
    expect(notVideo.status).toBe(415);

    // 17 KB that opens as 144 million pixels: the server must refuse it rather than unpack it.
    const bomb = await fetch(link, { method: "PUT", headers: { "content-type": "image/png" }, body: fixture("huge-blank.png") });
    expect(bomb.status).toBe(415);

    const huge = new Uint8Array(26 * 1024 * 1024);
    huge.set(fixture("photo-with-gps.jpg"));
    const big = await fetch(link, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: huge });
    expect(big.status).toBe(413);
  });
});
