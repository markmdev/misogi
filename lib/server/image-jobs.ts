// Background image jobs (covers, each challenge's Virgil): a couple at a time, one per key.
// Never blocks a request.

import { AppError } from "./util";
import { finishBeforeExit } from "./unfinished";

const CONCURRENCY = 2;

type Job = { key: string; run: () => Promise<void> };

const state = globalThis as unknown as {
  __imageJobs?: { running: number; waiting: Job[]; active: Set<string> };
};

function jobs() {
  if (!state.__imageJobs) state.__imageJobs = { running: 0, waiting: [], active: new Set() };
  return state.__imageJobs;
}

/** Queues `run` under `key` ("cover:<challenge id>"), unless that key is already waiting or running. Never throws. */
export function queueImageJob(key: string, run: () => Promise<void>): void {
  const q = jobs();
  if (q.active.has(key) || q.waiting.some((j) => j.key === key)) return;
  q.waiting.push({ key, run });
  pump();
}

function pump() {
  const q = jobs();
  while (q.running < CONCURRENCY && q.waiting.length) {
    const job = q.waiting.shift()!;
    q.running++;
    q.active.add(job.key);
    void finishBeforeExit(
      Promise.resolve()
        .then(job.run)
        .catch((e) => console.error(`[${job.key}] failed`, e instanceof AppError ? e.message : e))
        .finally(() => {
          q.running--;
          q.active.delete(job.key);
          pump();
        }),
    );
  }
}
