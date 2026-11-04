// Virgil dressed for each challenge: Muse Spark picks the outfit, Muse Image draws him from the plain
// Virgil, SAM 3.1 cuts him out, and he's framed like the plain one so he can stand in for it at the same size.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { generateImage, outputText, respond, segment, type CallOptions } from "./ai/client";
import { all, dataDir, one, run } from "./db";
import { setVirgil, type ChallengeRow } from "./domain/challenges";
import { queueImageJob } from "./image-jobs";
import { toWebp } from "./images";
import { floodFromEdges, samMasks } from "./sam";
import { AppError, id, nowIso } from "./util";

/** Flat, and far from his beige, white and pink, so the background can't be mistaken for him. */
const BACKDROP = { r: 220, g: 229, b: 236 };
const PLAIN = path.join(process.cwd(), "public/art/mascot/idle.webp");

/** Queues this challenge's Virgil, in the given outfit or one Muse Spark picks. */
export function queueVirgil(challengeId: string, outfit?: string): void {
  queueImageJob(`virgil:${challengeId}`, () => makeVirgil(challengeId, outfit));
}

const OUTFIT_GUIDE = `You dress Virgil, a small needle-felted mountain mascot, for one person's challenge this year.
Answer with one short phrase: his signature look for this challenge, so anyone gets the challenge at a glance even when he's small.
- One big prop in his hands, held in front of him, about a third of his size, that says the challenge by itself.
- One felt garment in a bold colour that suits the challenge: a vest, an apron, a jacket, a cardigan, a cape or a jersey.
- At most one small extra: glasses or goggles, a headband or headphones in a bright colour just under his snow cap (never black: it reads as hair), shoes, or a watch.
His snow cap stays whole and uncovered: no hat or hood. Nothing carries words, letters or numbers. No flags or national costume.
It must look different from the looks other challenges already have: {taken}
Examples:
Read 25 books -> a tall stack of colourful books hugged in his arms, a mustard knitted cardigan, and small round reading glasses
Run 365 miles -> a bright orange running vest, a coral sweatband across his brow just under his snow cap, and a water bottle held up in one hand
Learn 20 songs on guitar -> a little acoustic guitar held across his body, a denim jacket, and a red bandana at his neck`;

/** What Virgil wears for this challenge, in a phrase, from Muse Spark, unlike the looks other challenges' Virgils have. */
async function outfitFor(c: Pick<ChallengeRow, "id" | "title">, opts: CallOptions): Promise<string> {
  const taken = all<{ prompt: string }>(
    "SELECT m.prompt FROM challenges c JOIN media m ON m.path = c.virgil_path WHERE c.id != ?",
    c.id,
  )
    .map((m) => outfitIn(m.prompt))
    .filter(Boolean);
  const instructions = OUTFIT_GUIDE.replace("{taken}", taken.length ? taken.join("; ") : "none yet");
  const r = await respond("fast", { instructions, input: c.title, max_output_tokens: 1500 }, opts);
  const outfit = outputText(r).trim().replace(/^.*->\s*/, "").replace(/[."]+$/, "");
  if (!outfit) throw new AppError("resting", "No outfit came back.");
  return outfit;
}

function virgilPrompt(outfit: string): string {
  // Naming headwear in the prompt makes Muse Image add it, so the line about it is only there when he wears some.
  const head = /head ?band|headphones|sweatband|earmuffs/i.test(outfit)
    ? "with nothing on or over the cap (no hat or hood); the band sits just under its edge"
    : "with nothing on his head (no hat, hood, headband or headphones)";
  return (
    `This is Virgil, a needle-felted wool mascot. Draw the same Virgil with ${outfit}. ` +
    `Keep him exactly himself: the same squat, egg-shaped beige felt body at the same width, the same white felted snow cap on top, ` +
    `whole and uncovered with all its drips, ${head}, ` +
    `the same two small black bead eyes and pink blush, no mouth, the same stubby arms and two round feet, the same soft felt texture. ` +
    `The accessories are felt too, in the same handmade style. ` +
    `Standing, facing the viewer, whole body, centered, at the same size and framing as the reference, feet on the same line. ` +
    `Plain flat light blue-grey background exactly like the reference's, no shadow on it, no text, no letters, no numbers.`
  );
}

function outfitIn(prompt: string): string {
  return prompt.match(/Draw the same Virgil with (.+?)\. Keep him exactly himself/)?.[1] ?? "";
}

async function makeVirgil(challengeId: string, outfit?: string) {
  const c = one<ChallengeRow>("SELECT * FROM challenges WHERE id = ?", challengeId);
  if (!c) return;
  const visitor = { visitor: c.creator_id ?? `virgil:${challengeId}` };
  const prompt = virgilPrompt(outfit ?? (await outfitFor(c, visitor)));
  const reference = await sharp(PLAIN).flatten({ background: BACKDROP }).png().toBuffer();
  const drawn = await generateImage(prompt, "1:1", visitor, reference);
  const png = await sharp(drawn.data).png().toBuffer();
  const cut = await cutOut(png, await segment(png, "plush toy", visitor));
  const framed = await frameLikePlain(cut);

  const file = `${challengeId}-${id().slice(0, 8)}.webp`;
  const dir = path.join(dataDir(), "media", "virgils");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), await toWebp(framed, 512));
  if (!one("SELECT 1 FROM challenges WHERE id = ?", challengeId)) return;
  run(
    `INSERT INTO media (id, kind, challenge_id, user_id, path, mime, prompt, model, created_at)
     VALUES (?, 'virgil', ?, ?, ?, 'image/webp', ?, ?, ?)`,
    id("med"),
    challengeId,
    c.creator_id,
    `virgils/${file}`,
    prompt,
    drawn.model,
    nowIso(),
  );
  setVirgil(challengeId, `virgils/${file}`);
}

/**
 * His alpha: every SAM match, plus whatever the flat backdrop can't reach (SAM keeps only the toy, so a
 * card held out past his outline would be lost), with holes filled and a soft edge.
 */
async function cutOut(png: Buffer, sam: string): Promise<Buffer> {
  const { data: rgb, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const solid = new Uint8Array(W * H);
  for (const mask of await samMasks(sam, W, H)) for (let i = 0; i < W * H; i++) solid[i] |= mask[i];

  const backdrop = (i: number) =>
    Math.hypot(rgb[i * 3] - BACKDROP.r, rgb[i * 3 + 1] - BACKDROP.g, rgb[i * 3 + 2] - BACKDROP.b) < 26;
  // Whatever the edges can't reach through backdrop is him, holes included (books held against his body).
  const outside = floodFromEdges(W, H, (i) => !solid[i] && backdrop(i));

  const alpha = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = outside[i] ? 0 : 255;
  const { data: soft, info: si } = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } }).blur(1.2).raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = soft[i * si.channels];
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** On the plain Virgil's canvas: the same height, his feet on the same line, centered where he stands. */
async function frameLikePlain(cut: Buffer): Promise<Buffer> {
  const plain = await sharp(PLAIN).metadata();
  const { info: p } = await sharp(PLAIN).trim().toBuffer({ resolveWithObject: true });
  const size = plain.width!;
  const left = -(p.trimOffsetLeft ?? 0);
  const top = -(p.trimOffsetTop ?? 0);
  const { data: him, info: h } = await sharp(cut).trim().toBuffer({ resolveWithObject: true });
  const scale = Math.min(p.height / h.height, (size * 0.96) / h.width);
  const w = Math.round(h.width * scale);
  const ht = Math.round(h.height * scale);
  const resized = await sharp(him).resize(w, ht).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.max(0, Math.round(left + p.width / 2 - w / 2)), top: Math.max(0, top + p.height - ht) }])
    .png()
    .toBuffer();
}
