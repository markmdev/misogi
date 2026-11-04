// On 4 November a draft on the live start flow sat for about 100 s and then failed, while five others took 7 to 10 s:
// Meta's model sometimes takes a call and never answers it. A stalled draft is asked once more instead of waited on.
//   bun test tests/draft-stall.test.ts

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { respond } from "../lib/server/ai/client";

const realFetch = globalThis.fetch;
const realKey = process.env.META_API_KEY;
beforeAll(() => {
  process.env.META_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  process.env.META_API_KEY = realKey;
});

type Answer = (init: RequestInit) => Promise<Response>;
const stalls: Answer = (init) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
const answers: Answer = async () => Response.json({ id: "resp_1", status: "completed", output: [] });

function meta(...seq: Answer[]) {
  let calls = 0;
  globalThis.fetch = ((_url: string, init: RequestInit) => seq[Math.min(calls++, seq.length - 1)](init)) as unknown as typeof fetch;
  return () => calls;
}

describe("a draft Meta's model never answers", () => {
  test("is asked once more, and the second answer is used", async () => {
    const calls = meta(stalls, answers);
    const r = await respond("draft", { input: "Read 25 books" }, { timeoutMs: 200 });
    expect(r.status).toBe("completed");
    expect(calls()).toBe(2);
  });

  test("stalled twice, stops with a message that says to try again", async () => {
    const calls = meta(stalls, stalls, answers);
    await expect(respond("draft", { input: "Read 25 books" }, { timeoutMs: 200 })).rejects.toThrow(/try again/i);
    expect(calls()).toBe(2);
  });
});
