// On 4 November a new challenge's first page failed after 16 s with "The connection to the model dropped": Meta's
// stream broke part-way, nothing asked again, and the climber landed on an empty page. A broken stream is asked once more.
//   bun test tests/stream-drop.test.ts

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { streamText } from "../lib/server/ai/client";

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

const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const enc = new TextEncoder();

const drops = () =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(sse({ type: "response.output_text.delta", delta: "<!doctype html><html>" })));
        c.error(new TypeError("terminated"));
      },
    }),
  );
const answers = () =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(sse({ type: "response.output_text.delta", delta: "<!doctype html><html></html>" }, { type: "response.completed" })));
        c.close();
      },
    }),
  );

function meta(...seq: (() => Response)[]) {
  let calls = 0;
  globalThis.fetch = (async () => seq[Math.min(calls++, seq.length - 1)]()) as unknown as typeof fetch;
  return () => calls;
}

describe("a stream Meta drops part-way", () => {
  test("is asked once more, and only the second answer's text is used", async () => {
    const calls = meta(drops, answers);
    const r = await streamText("codegen", { input: "Build the page" });
    expect(r).toEqual({ text: "<!doctype html><html></html>", status: "completed" });
    expect(calls()).toBe(2);
  });

  test("dropped twice, stops with the dropped connection instead of asking a third time", async () => {
    const calls = meta(drops, drops, answers);
    await expect(streamText("codegen", { input: "Build the page" })).rejects.toThrow(/connection to the model dropped/);
    expect(calls()).toBe(2);
  });
});
