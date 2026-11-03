// Cover images for challenges: a small clay diorama per challenge, generated in the
// background with whichever image model the AI provider offers. Never blocks a request.

import fs from "node:fs/promises";
import path from "node:path";
import { generateImage } from "./ai/client";
import { dataDir, one, run } from "./db";
import { setCover, type ChallengeRow } from "./domain/challenges";
import { toWebp } from "./images";
import { AppError, id, nowIso } from "./util";

const CONCURRENCY = 2;

const state = globalThis as unknown as {
  __coverQueue?: { running: number; waiting: string[]; active: Set<string> };
};

function queue() {
  if (!state.__coverQueue) state.__coverQueue = { running: 0, waiting: [], active: new Set() };
  return state.__coverQueue;
}

/** Queues a cover for the challenge. Returns at once and never throws. */
export function queueCover(challengeId: string): void {
  try {
    const q = queue();
    if (q.active.has(challengeId) || q.waiting.includes(challengeId)) return;
    q.waiting.push(challengeId);
    pump();
  } catch (e) {
    console.error("[cover] couldn't queue", challengeId, e);
  }
}

/** Covers waiting or being drawn right now. */
export function coverQueueSize(): number {
  const q = queue();
  return q.waiting.length + q.running;
}

function pump() {
  const q = queue();
  while (q.running < CONCURRENCY && q.waiting.length) {
    const challengeId = q.waiting.shift()!;
    q.running++;
    q.active.add(challengeId);
    void makeCover(challengeId)
      .catch((e) => console.error("[cover] failed", challengeId, e instanceof AppError ? e.message : e))
      .finally(() => {
        q.running--;
        q.active.delete(challengeId);
        pump();
      });
  }
}

const PALETTE_WORDS: Record<string, string> = {
  teal: "teal and seafoam",
  mint: "mint green and cream",
  sand: "warm sand and honey",
  peach: "peach and coral",
  lilac: "lilac and lavender",
  sky: "sky blue and white",
  rose: "rose pink and blush",
  night: "periwinkle and soft indigo",
};

// Title keywords first (more specific), then the category.
const TITLE_IDEAS: [RegExp, string][] = [
  [/\bties?\b|necktie/i, "a neatly knotted necktie on a little wooden valet stand next to a tiny wall calendar"],
  [/mandarin|chinese/i, "a steaming bamboo steamer of dumplings, a pair of chopsticks and two blank speech bubbles above a tiny tea table"],
  [/hunt|meat/i, "a small log cabin with a campfire, a cast iron pan, pine trees and a rustic wooden table"],
  [/thank|gratitude|note every day/i, "a stack of blank envelopes with wax seals, a fountain pen and a small potted plant"],
  [/meet|new people|someone new/i, "a cozy little town square with a bench, two coffee cups and colorful tiny houses"],
  [/spanish/i, "two blank speech bubbles above a sunny little cafe table with two cups and a small plate of pastries"],
  [/screen time|phone/i, "a phone lying face-down on a sunny windowsill beside an open book, a cup of tea and a potted plant"],
  [/dinners?\b|family meal/i, "a long family dinner table with mismatched plates, a pot of stew, bread and glowing candles"],
  [/push-?ups?|strength|\bgym\b/i, "a rolled exercise mat with a pair of small dumbbells and a water bottle by a sunny window"],
  [/conversation|host|podcast|talk/i, "a small stage with two armchairs, a microphone on a stand and warm spotlights"],
  [/smart home|home ai|\bai\b|assistant|automation/i, "a cut-away dollhouse with glowing lamps, a tiny round speaker, a circuit board and a sensor in a plant pot"],
  [/\bcode|program|software/i, "a tiny laptop on a desk with glowing abstract blocks, a coffee mug and a little plant"],
  [/\bstates?\b|road ?trip|countr/i, "a little camper van on a winding road across a puzzle-piece map with mesas, pine trees and a cactus"],
  [/\bread|books?\b/i, "a tall wobbly stack of books with a reading lamp, a mug of tea and a ribbon bookmark"],
  [/\brun|marathon|miles|\bkm\b/i, "a winding trail looping over gentle hills with a pair of running shoes at the start and a small flag at the top"],
  [/essay|writ|journal|novel/i, "an open notebook with a fountain pen, a few crumpled paper balls and a desk lamp"],
  [/guitar|songs?\b|ukulele/i, "an acoustic guitar leaning on a wooden stool beside a music stand with floating musical note shapes"],
  [/piano/i, "a small upright piano with a stool and a vase of flowers"],
  [/swim/i, "a little swimming pool with lane ropes, a diving board and a rolled towel"],
  [/climb|hike|summit|mountain/i, "a small mountain with a winding trail, a backpack at the base and a flag on the summit"],
];

const CATEGORY_IDEAS: Record<string, string> = {
  language: "two blank speech bubbles above a tiny cafe table with two cups",
  fitness: "a winding trail over gentle hills with a pair of sneakers and a water bottle",
  reading: "a stack of books with a reading lamp and a mug of tea",
  code: "a tiny laptop on a desk with glowing abstract blocks and a coffee mug",
  making: "a workbench with small tools, a circuit board and a half-built gadget",
  music: "a guitar, a small drum and floating musical note shapes",
  art: "an easel with a blank canvas, paint jars and brushes",
  travel: "a little suitcase on a winding road across a puzzle-piece map",
  mindful: "a meditation cushion by a round window with a plant and a cup of tea",
  cooking: "a tiny kitchen counter with a pot of soup, vegetables and a wooden spoon",
  writing: "an open notebook with a fountain pen and a desk lamp",
  money: "a piggy bank with coins stacked like a staircase",
  social: "a small park bench with two coffee cups and a lamp post",
  other: "a small mountain with a winding path and a flag at the summit",
};

function visualIdea(c: Pick<ChallengeRow, "title" | "category">): string {
  for (const [re, idea] of TITLE_IDEAS) if (re.test(c.title)) return idea;
  return CATEGORY_IDEAS[c.category] ?? CATEGORY_IDEAS.other;
}

export function coverPrompt(c: Pick<ChallengeRow, "title" | "category" | "theme">): string {
  const palette = PALETTE_WORDS[c.theme] ?? PALETTE_WORDS.teal;
  return (
    `A cozy miniature clay diorama that represents: ${c.title}. ${visualIdea(c)}. ` +
    `soft 3D clay render, rounded chunky shapes, pastel ${palette} palette, gentle studio lighting, centered, ` +
    `plain soft pastel background, no text, no letters, no people's faces`
  );
}

async function makeCover(challengeId: string) {
  const c = one<ChallengeRow>("SELECT * FROM challenges WHERE id = ?", challengeId);
  if (!c) return;
  const prompt = coverPrompt(c);
  let image: Awaited<ReturnType<typeof generateImage>> | null = null;
  for (let attempt = 0; attempt < 2 && !image; attempt++) {
    try {
      image = await generateImage(prompt, "4:3", { visitor: c.creator_id ?? `cover:${challengeId}` });
    } catch (e) {
      // One retry for transient failures (timeouts, 5xx, a busy model).
      if (attempt === 1 || !(e instanceof AppError) || e.code !== "resting") throw e;
      await new Promise((r) => setTimeout(r, 8_000));
    }
  }
  if (!image) return;
  const file = `${challengeId}-${id().slice(0, 8)}.webp`;
  const dir = path.join(dataDir(), "media", "covers");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), await toWebp(image.data, 1200));
  // The challenge may have been deleted while the image was drawn.
  if (!one("SELECT 1 FROM challenges WHERE id = ?", challengeId)) return;
  run(
    `INSERT INTO media (id, kind, challenge_id, user_id, path, mime, prompt, model, created_at)
     VALUES (?, 'cover', ?, ?, ?, ?, ?, ?, ?)`,
    id("med"),
    challengeId,
    c.creator_id,
    `covers/${file}`,
    "image/webp",
    prompt,
    image.model,
    nowIso(),
  );
  setCover(challengeId, `covers/${file}`);
}
