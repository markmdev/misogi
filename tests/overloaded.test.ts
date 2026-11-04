// Meta's backend sometimes answers "temporarily overloaded. Please retry." before running a call. Live, 3 of
// about 25 Muse Wonder calls on 4 November got that, and a new challenge's page then never got built.
//   bun test tests/overloaded.test.ts

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

const overloaded = () =>
  Response.json({ error: { code: "service_overloaded", message: "The backend is temporarily overloaded. Please retry.", param: null, type: "server_error" } }, { status: 503 });
const answered = () => Response.json({ id: "resp_1", status: "completed", output: [] });

function meta(...answers: (() => Response)[]) {
  let calls = 0;
  globalThis.fetch = (async () => answers[Math.min(calls++, answers.length - 1)]()) as unknown as typeof fetch;
  return () => calls;
}

describe("Meta's overloaded backend", () => {
  test("a call it turns away is asked again once, and the second answer is used", async () => {
    const calls = meta(overloaded, answered);
    const r = await respond("fast", { input: "hi", max_output_tokens: 16 });
    expect(r.status).toBe("completed");
    expect(calls()).toBe(2);
  });

  test("turned away twice, the call rests instead of asking a third time", async () => {
    const calls = meta(overloaded, overloaded, answered);
    await expect(respond("fast", { input: "hi", max_output_tokens: 16 })).rejects.toThrow();
    expect(calls()).toBe(2);
  });

  test("any other server error isn't asked again, since Meta may have run it", async () => {
    const calls = meta(() => Response.json({ error: { code: null, message: "x", type: "server_error" } }, { status: 500 }), answered);
    await expect(respond("fast", { input: "hi", max_output_tokens: 16 })).rejects.toThrow();
    expect(calls()).toBe(1);
  });
});
