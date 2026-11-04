// A one-of-a-kind badge for every camp someone reaches, drawn by the image model.

import fs from "node:fs";
import path from "node:path";
import type { Milestone } from "@/lib/shared/types";
import { generateImage } from "./ai/client";
import { dataDir, one, run } from "./db";
import { toWebp } from "./images";
import { id, nowIso, parseJson } from "./util";
import { finishBeforeExit } from "./unfinished";

type Job = { challengeId: string; userId: string; milestoneId: string };

const state = globalThis as unknown as { __badgeQueue?: { running: number; waiting: Job[] } };

function q() {
  if (!state.__badgeQueue) state.__badgeQueue = { running: 0, waiting: [] };
  return state.__badgeQueue;
}

/** Queues a badge; never throws and never blocks the caller. */
export function queueBadge(challengeId: string, userId: string, milestoneId: string) {
  q().waiting.push({ challengeId, userId, milestoneId });
  pump();
}

function pump() {
  const queue = q();
  while (queue.running < 2 && queue.waiting.length) {
    const job = queue.waiting.shift()!;
    queue.running++;
    void finishBeforeExit(
      make(job)
        .catch((e) => console.error("[badge] failed", e instanceof Error ? e.message : e))
        .finally(() => {
          queue.running--;
          pump();
        }),
    );
  }
}

async function make(job: Job) {
  const c = one<{ title: string; theme: string; category: string }>("SELECT title, theme, category FROM challenges WHERE id = ?", job.challengeId);
  const plan = one<{ id: string; milestones_json: string }>(
    "SELECT id, milestones_json FROM plans WHERE challenge_id = ? AND user_id = ? ORDER BY version DESC LIMIT 1",
    job.challengeId,
    job.userId,
  );
  if (!c || !plan) return;
  const m = parseJson<Milestone[]>(plan.milestones_json, []).find((x) => x.id === job.milestoneId);
  if (!m || m.badge) return;
  const prompt = `A round collectible achievement badge, like a soft enamel pin, for reaching "${m.title}" in a year-long challenge: "${c.title}". In the center, one simple, charming object that shows what this person practices (${c.category}) and this milestone${m.detail ? ` (${m.detail})` : ""}; not a mountain. A tiny mountain peak only as a small detail on the rim. Soft 3D clay render, rounded chunky shapes, pastel ${c.theme} palette with warm cream accents, gentle studio lighting, centered on a plain soft cream background, no text, no letters, no numbers`;
  const img = await generateImage(prompt, "1:1", { visitor: job.userId });
  const dir = path.join(dataDir(), "media", "badges");
  fs.mkdirSync(dir, { recursive: true });
  const file = `${job.milestoneId}-${id().slice(0, 6)}.webp`;
  fs.writeFileSync(path.join(dir, file), await toWebp(img.data, 256));
  const rel = `badges/${file}`;
  run(
    "INSERT INTO media (id, kind, challenge_id, user_id, path, mime, prompt, model, created_at) VALUES (?, 'badge', ?, ?, ?, ?, ?, ?, ?)",
    id("med"),
    job.challengeId,
    job.userId,
    rel,
    "image/webp",
    prompt,
    img.model,
    nowIso(),
  );
  // Attach to the milestone in the newest plan (re-read: the plan may have changed meanwhile).
  const latest = one<{ id: string; milestones_json: string }>(
    "SELECT id, milestones_json FROM plans WHERE challenge_id = ? AND user_id = ? ORDER BY version DESC LIMIT 1",
    job.challengeId,
    job.userId,
  );
  if (!latest) return;
  const ms = parseJson<Milestone[]>(latest.milestones_json, []);
  const target = ms.find((x) => x.id === job.milestoneId);
  if (!target) return;
  target.badge = rel;
  run("UPDATE plans SET milestones_json = ? WHERE id = ?", JSON.stringify(ms), latest.id);
  // Show the badge in the feed item for this camp too.
  const act = one<{ id: string; data_json: string }>(
    "SELECT id, data_json FROM activity WHERE challenge_id = ? AND user_id = ? AND kind = 'milestone' AND data_json LIKE ? ORDER BY created_at DESC LIMIT 1",
    job.challengeId,
    job.userId,
    `%${job.milestoneId}%`,
  );
  if (act) {
    const data = parseJson<Record<string, unknown>>(act.data_json, {});
    data.badge = rel;
    run("UPDATE activity SET data_json = ? WHERE id = ?", JSON.stringify(data), act.id);
  }
}

export function badgeUrl(rel: string | null | undefined): string | null {
  return rel ? `/media/${rel}` : null;
}
