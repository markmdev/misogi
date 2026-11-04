// A photo's subject as a felt sticker on the climb page: SAM 3.1 cuts out the thing the challenge counts (the dish
// someone cooked, the cake, the drawing), and it gets a cream felt border with a stitch in the challenge's colour.
// Muse Spark decides from the photo and the challenge whether there is such a thing; a selfie, a view or a screen
// never becomes a sticker, and a photo SAM can't cut cleanly just stays a photo.

import sharp from "sharp";
import { palette } from "@/lib/shared/theme";
import { outputText, respond, segment } from "./ai/client";
import { one, run } from "./db";
import type { ChallengeRow } from "./domain/challenges";
import type { MediaRow } from "./log-media";
import { floodFromEdges, samMasks } from "./sam";
import { deleteObject, getObject, putObject } from "./storage";
import { finishBeforeExit } from "./unfinished";

/** What a sticker cut out, and where its picture sits over the photo, in fractions of the photo's width and height. */
export type StickerMeta = { what: string; x: number; y: number; w: number; h: number };

const SIZE = 560;
const FELT = { r: 255, g: 248, b: 239 };

/** Turns the first photo on a new log into a sticker, when its subject is what the challenge counts. */
export function queueSticker(logId: string) {
  const m = one<MediaRow>("SELECT * FROM media WHERE log_id = ? AND kind = 'photo' ORDER BY created_at LIMIT 1", logId);
  if (m) void finishBeforeExit(makeSticker(m.id)).catch((e) => console.error(`[sticker:${m.id}]`, e instanceof Error ? e.message : e));
}

export async function makeSticker(mediaId: string): Promise<StickerMeta | null> {
  const m = one<MediaRow>("SELECT * FROM media WHERE id = ? AND kind = 'photo'", mediaId);
  if (!m) return null;
  const c = one<ChallengeRow>("SELECT * FROM challenges WHERE id = ?", m.challenge_id)!;
  const res = await getObject(`${m.path}/full.webp`, null);
  if (!res.ok) return null;
  const photo = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const subject = await subjectOf(photo, c, m.user_id);
  if (!subject) return null;
  const sams = await Promise.all(subject.find.map((word) => segment(photo, word, { visitor: m.user_id })));
  const sticker = await stickerFrom(photo, sams, palette(c.theme).accent);
  if (!sticker) return null;
  await putObject(`${m.path}/sticker.webp`, sticker.image, "image/webp");
  const meta = { what: subject.what, ...sticker.box };
  // The log may have been removed while SAM worked; its files are gone then, so this one goes too.
  if (!run("UPDATE media SET sticker = ? WHERE id = ?", JSON.stringify(meta), m.id).changes) {
    await deleteObject(`${m.path}/sticker.webp`);
    return null;
  }
  return meta;
}

/**
 * The one thing in the photo the challenge counts: what it is in plain words, and the everyday words SAM finds it by
 * (a pan and the food in it), or null when the photo isn't of one.
 */
async function subjectOf(photo: Buffer, c: Pick<ChallengeRow, "title" | "metric_name">, userId: string): Promise<{ find: string[]; what: string } | null> {
  const small = await sharp(photo).resize({ width: 768, height: 768, fit: "inside" }).webp({ quality: 80 }).toBuffer();
  const r = await respond(
    "fast",
    {
      instructions:
        `Someone added this photo to their progress log on Misogi. Their challenge is "${c.title}", counting ${c.metric_name}. ` +
        `Decide whether the photo's main subject is one thing they made or got for this challenge, the kind of thing it counts: ` +
        `a dish they cooked, a cake they baked, a drawing or painting, a pot or a knitted piece they made, a plant they grew, a book they read. ` +
        `If it is, answer on one line with the everyday word an image segmenter would find the whole thing by, a colon, and what it is in a few plain words. ` +
        `For food in or on something, give that word and "food" joined by a plus, so the cut takes the dish whole: "pan + food: shakshuka", "plate + food: spaghetti bolognese", "bowl + food: ramen". ` +
        `Otherwise the word is the thing itself: "cake: lemon drizzle cake", "bread: sourdough loaf", "painting: watercolour of a lake", "book: The Odyssey". ` +
        `If the photo is of a person or a face, a view or a place, a screen, a page of text, a receipt, a map, or several unrelated things, answer NONE. ` +
        `Answer with that line or NONE only.`,
      input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/webp;base64,${small.toString("base64")}` }] }],
      max_output_tokens: 400,
    },
    { visitor: userId },
  );
  const [words, what] = outputText(r).replace(/["“”.]/g, "").split(":").map((p) => p.trim());
  const find = (words ?? "").toLowerCase().split("+").map((w) => w.trim()).filter((w) => /^[a-z ]{2,24}$/.test(w)).slice(0, 2);
  return find.length && what ? { find, what } : null;
}

/**
 * The subject as a sticker, from SAM's answers for each of its words: the first word's biggest match, with what the
 * other words found inside it (the food in the pan) and every hole it encloses, with a soft edge, on a rounded cream
 * felt border with a stitched line in the challenge's colour, cropped to it with room for the border. Null when the cut
 * is too small or fills almost the whole photo, which is when SAM found the wrong thing or the whole scene.
 */
async function stickerFrom(photo: Buffer, sams: string[], stitch: string): Promise<{ image: Buffer; box: Omit<StickerMeta, "what"> } | null> {
  const { data: rgb, info } = await sharp(photo).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const [first, ...rest] = await Promise.all(sams.map((sam) => samMasks(sam, W, H)));
  const area = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);
  const main = first.sort((a, b) => area(b) - area(a))[0];
  if (!main) return null;
  const subject = Uint8Array.from(main);
  const [mx0, my0, mx1, my1] = boundsOf(main, W, H);
  for (const extra of rest.flat()) {
    let inside = 0, all = 0;
    for (let i = 0; i < W * H; i++)
      if (extra[i]) {
        all++;
        const x = i % W, y = Math.floor(i / W);
        if (x >= mx0 && x <= mx1 && y >= my0 && y <= my1) inside++;
      }
    if (all && inside / all > 0.6) for (let i = 0; i < W * H; i++) subject[i] |= extra[i];
  }
  // Closed over the thin gaps SAM leaves (between a pan's rim and the food in it), then solid inside.
  const gap = Math.round(Math.max(W, H) * 0.025);
  const closed = await spread(await spread(subject, W, H, gap), W, H, -gap);
  const outside = floodFromEdges(W, H, (i) => !closed[i]);
  for (let i = 0; i < W * H; i++) subject[i] = outside[i] ? 0 : 1;
  const share = area(subject) / (W * H);
  if (share < 0.04 || share > 0.9) return null;

  const [x0, y0, x1, y1] = boundsOf(subject, W, H);
  const border = Math.max(8, Math.round(Math.max(x1 - x0, y1 - y0) * 0.05));
  const pad = border + 4;
  const left = x0 - pad, top = y0 - pad;
  const cw = x1 - x0 + 1 + 2 * pad, ch = y1 - y0 + 1 + 2 * pad;

  // The subject on its own canvas, with room around it for the border. Past the photo's edge the colour carries on from
  // the edge, so the soft edge of a subject the frame cuts off blends into its own colour, not black.
  const cut = new Uint8Array(cw * ch);
  const colour = Buffer.alloc(cw * ch * 3);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const sx = left + x, sy = top + y, o = y * cw + x;
      const inside = sx >= 0 && sy >= 0 && sx < W && sy < H;
      const i = Math.min(H - 1, Math.max(0, sy)) * W + Math.min(W - 1, Math.max(0, sx));
      if (inside) cut[o] = subject[i] * 255;
      colour[o * 3] = rgb[i * 3];
      colour[o * 3 + 1] = rgb[i * 3 + 1];
      colour[o * 3 + 2] = rgb[i * 3 + 2];
    }

  const blurred = async (sigma: number) => {
    const { data, info: b } = await sharp(Buffer.from(cut), { raw: { width: cw, height: ch, channels: 1 } }).blur(Math.max(0.3, sigma)).raw().toBuffer({ resolveWithObject: true });
    return Uint8Array.from({ length: cw * ch }, (_, i) => data[i * b.channels]);
  };
  // A blurred mask thresholded low reaches out about two blurs from the edge and rounds off every notch, as a die-cut sticker does.
  const grown = (by: number) => blurred(by / 2.05);
  const [soft, felt, stitchOut, stitchIn] = await Promise.all([blurred(1.1), grown(border), grown(border * 0.55), grown(border * 0.55 - 2.2)]);

  const [sr, sg, sb] = [1, 3, 5].map((i) => parseInt(stitch.slice(i, i + 2), 16));
  let cx = 0, cy = 0, n = 0;
  for (let i = 0; i < cw * ch; i++)
    if (cut[i]) {
      cx += i % cw;
      cy += Math.floor(i / cw);
      n++;
    }
  cx /= n;
  cy /= n;
  const dash = Math.max(5, border * 0.42);

  const out = Buffer.alloc(cw * ch * 4);
  for (let i = 0; i < cw * ch; i++) {
    const x = i % cw, y = Math.floor(i / cw);
    const edge = Math.min(1, Math.max(0, (felt[i] - 3) / 6));
    if (!edge) continue;
    // Felt: cream with a faint grain, a touch darker toward its rim.
    const grain = (((x * 73856093) ^ (y * 19349663)) & 7) - 3;
    let [r, g, b] = [FELT.r + grain, FELT.g + grain, FELT.b + grain - 2].map((v) => Math.min(255, v));
    if (stitchOut[i] > 4 && stitchIn[i] <= 4) {
      const along = Math.atan2(y - cy, x - cx) * Math.hypot(x - cx, y - cy);
      if (((along / dash) % 2 + 2) % 2 < 1.15) [r, g, b] = [sr, sg, sb];
    }
    const a = soft[i] / 255;
    out[i * 4] = Math.round(colour[i * 3] * a + r * (1 - a));
    out[i * 4 + 1] = Math.round(colour[i * 3 + 1] * a + g * (1 - a));
    out[i * 4 + 2] = Math.round(colour[i * 3 + 2] * a + b * (1 - a));
    out[i * 4 + 3] = Math.round(255 * Math.max(edge, a));
  }

  const image = await sharp(out, { raw: { width: cw, height: ch, channels: 4 } })
    .resize({ width: SIZE, height: SIZE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 90 })
    .toBuffer();
  return { image, box: { x: left / W, y: top / H, w: cw / W, h: ch / H } };
}

/** The mask grown by `by` pixels, or shrunk when it's negative: a blur thresholded low, which rounds off corners as it goes. */
async function spread(mask: Uint8Array, W: number, H: number, by: number): Promise<Uint8Array> {
  const flip = by < 0;
  const src = Buffer.from(mask.map((v) => ((v ? 1 : 0) ^ (flip ? 1 : 0)) * 255));
  const { data, info } = await sharp(src, { raw: { width: W, height: H, channels: 1 } }).blur(Math.max(0.3, Math.abs(by) / 2.05)).raw().toBuffer({ resolveWithObject: true });
  return Uint8Array.from({ length: W * H }, (_, i) => ((data[i * info.channels] > 5 ? 1 : 0) ^ (flip ? 1 : 0)));
}

function boundsOf(mask: Uint8Array, W: number, H: number): [number, number, number, number] {
  let [x0, y0, x1, y1] = [W, H, 0, 0];
  for (let i = 0; i < W * H; i++)
    if (mask[i]) {
      const x = i % W, y = Math.floor(i / W);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  return [x0, y0, x1, y1];
}
