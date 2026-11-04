// Felt stickers drawn for one page when its brief asks for them: Muse Spark lists what the brief needs, Muse Image
// draws each thing in Misogi's felt look on a plain backdrop, it's cut off the backdrop, and it gets the same die-cut felt
// border as a photo's sticker. A page keeps its stickers through later versions, and its climber's dressed Muse is always among them.

import fs from "node:fs/promises";
import path from "node:path";
import { palette } from "@/lib/shared/theme";
import sharp from "sharp";
import { generateImage, outputText, respond } from "./ai/client";
import { all, dataDir, run } from "./db";
import type { ChallengeRow } from "./domain/challenges";
import { floodFromEdges } from "./sam";
import { feltSticker } from "./stickers";
import { id, nowIso } from "./util";

export type PageSticker = { name: string; what: string; url: string };

const MAX = 6;

/** The stickers a page can use: its own, then the challenge's dressed Muse. */
export function pageStickers(c: Pick<ChallengeRow, "id" | "virgil_path">, ownerKey: string): PageSticker[] {
  const own = all<{ path: string; caption: string }>(
    "SELECT path, caption FROM media WHERE kind = 'page_sticker' AND challenge_id = ? AND coalesce(user_id, '') = ? ORDER BY created_at",
    c.id,
    ownerKey,
  ).map((m) => {
    const at = m.caption.indexOf(": ");
    return { name: m.caption.slice(0, at), what: m.caption.slice(at + 2), url: `/media/${m.path}` };
  });
  return c.virgil_path ? [...own, { name: "muse", what: "the climber's Muse, the felt mascot dressed for this challenge", url: `/media/${c.virgil_path}` }] : own;
}

/** Draws the stickers this page's brief asks for that it doesn't have yet. A sticker that doesn't come out is left out. */
export async function drawPageStickers(c: ChallengeRow, ownerKey: string, request: string, visitor: string): Promise<void> {
  const have = pageStickers(c, ownerKey);
  const wanted = await stickersWanted(c, request, have, visitor);
  const accent = palette(c.theme).accent;
  await Promise.all(
    wanted.map((s) =>
      drawOne(c, ownerKey, s, accent, visitor).catch((e) => console.error(`[page-sticker:${c.id}:${s.name}]`, e instanceof Error ? e.message : e)),
    ),
  );
}

/** What the brief wants drawn, beyond what the page has: none when it doesn't ask for stickers. */
async function stickersWanted(c: Pick<ChallengeRow, "title">, request: string, have: PageSticker[], visitor: string): Promise<{ name: string; what: string }[]> {
  const room = MAX - have.filter((s) => s.name !== "muse").length;
  if (room <= 0 || !/sticker/i.test(request)) return [];
  const r = await respond(
    "fast",
    {
      instructions:
        `A page for someone's challenge "${c.title}" is being built from this request. If it asks for stickers, list the stickers it needs ` +
        `that the page doesn't have yet, at most ${room}. Each is one object that can be drawn as a needle-felted wool sticker: no people, ` +
        `no words, letters or numbers on it. One per line: a name of one or two lowercase everyday words, ` +
        `a colon, and what it is in a few plain words that can't be drawn as anything else ("medal: a gold finisher's medal on a red ribbon", ` +
        `"race bib: a runner's blank race number bib, a white fabric rectangle with a safety pin at each corner"). ` +
        `The page already has: ${have.map((s) => s.name).join(", ") || "nothing"}. The climber's Muse is "muse": never list it again. ` +
        `If the request doesn't ask for stickers, or the page has them all, answer NONE.`,
      input: request.slice(0, 2000),
      max_output_tokens: 600,
    },
    { visitor },
  );
  const taken = new Set(have.map((s) => s.name));
  const out: { name: string; what: string }[] = [];
  for (const line of outputText(r).split("\n")) {
    const item = line.replace(/^[-*\d.\s]+/, "");
    const at = item.indexOf(":");
    const name = item.slice(0, at).trim();
    const what = item.slice(at + 1).trim();
    if (at < 0 || !/^[a-z][a-z ]{1,22}$/.test(name) || !what || taken.has(name)) continue;
    taken.add(name);
    out.push({ name, what: what.replace(/[."]+$/, "") });
  }
  return out.slice(0, room);
}

async function drawOne(c: Pick<ChallengeRow, "id">, ownerKey: string, s: { name: string; what: string }, accent: string, visitor: string) {
  const prompt =
    `A needle-felted wool sticker of ${s.what}: one object, whole, centered, filling most of the frame, with soft felt texture and bold, friendly colours, ` +
    `handmade like a felted toy, lit evenly. Smooth, flat, untextured light blue-grey background with no shadow on it, no text, no letters, no numbers.`;
  const drawn = await generateImage(prompt, "1:1", { visitor });
  const subject = await offBackdrop(drawn.data);
  if (!subject) return;
  const sticker = await feltSticker(drawn.data, subject, accent);
  const file = `${c.id}-${id().slice(0, 8)}.webp`;
  const dir = path.join(dataDir(), "media", "stickers");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), sticker.image);
  run(
    `INSERT INTO media (id, kind, challenge_id, user_id, path, mime, prompt, model, caption, created_at)
     VALUES (?, 'page_sticker', ?, ?, ?, 'image/webp', ?, ?, ?, ?)`,
    id("med"),
    c.id,
    ownerKey || null,
    `stickers/${file}`,
    prompt,
    drawn.model,
    `${s.name}: ${s.what}`,
    nowIso(),
  );
}

/** The drawn thing: whatever the plain backdrop can't reach from the picture's edges. Null when that's almost nothing or almost all. */
async function offBackdrop(png: Buffer): Promise<Uint8Array | null> {
  const { data: rgb, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const rim: number[] = [];
  for (let x = 0; x < W; x += 4) rim.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 4) rim.push(y * W, y * W + W - 1);
  const median = (c: number) => rim.map((i) => rgb[i * 3 + c]).sort((a, b) => a - b)[rim.length >> 1];
  const [br, bg, bb] = [median(0), median(1), median(2)];
  const off = (i: number) => Math.hypot(rgb[i * 3] - br, rgb[i * 3 + 1] - bg, rgb[i * 3 + 2] - bb);
  // A backdrop drawn with a little grain or a faint shadow spreads further from its colour than a flat one.
  const spread = rim.map(off).sort((a, b) => a - b)[Math.floor(rim.length * 0.95)];
  const tolerance = Math.min(48, Math.max(30, spread * 1.6));
  const outside = floodFromEdges(W, H, (i) => off(i) < tolerance);
  const subject = Uint8Array.from(outside, (v) => (v ? 0 : 1));
  const share = subject.reduce((n, v) => n + v, 0) / (W * H);
  return share < 0.04 || share > 0.9 ? null : subject;
}
