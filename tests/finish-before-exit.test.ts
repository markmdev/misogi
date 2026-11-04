// A deploy restarts the server; it first waits for page builds, pictures and answers in progress.
//   bun test tests/finish-before-exit.test.ts

import { describe, expect, test } from "bun:test";
import { allFinished, finishBeforeExit } from "../lib/server/unfinished";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("waiting for work in progress", () => {
  test("nothing in progress: done at once", async () => {
    await allFinished();
  });

  test("waits for the next job a queue starts as one finishes", async () => {
    const done: string[] = [];
    const next = () => void finishBeforeExit(sleep(40).then(() => void done.push("second")));
    void finishBeforeExit(sleep(10).then(() => void done.push("first")).finally(next));
    await allFinished();
    expect(done).toEqual(["first", "second"]);
  });

  test("also when the queue's follow-up hangs off the tracked work", async () => {
    const done: string[] = [];
    void finishBeforeExit(sleep(10).then(() => void done.push("first"))).finally(
      () => void finishBeforeExit(sleep(40).then(() => void done.push("second"))),
    );
    await allFinished();
    expect(done).toEqual(["first", "second"]);
  });

  test("work that fails still counts as finished", async () => {
    const failed = finishBeforeExit(sleep(10).then(() => Promise.reject(new Error("model down"))));
    failed.catch(() => {});
    await allFinished();
  });
});
