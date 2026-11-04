import { z } from "zod";
import { functionCalls, generateImage, modelFor, outputText, respond, streamText, structured, type Job } from "@/lib/server/ai/client";
import { adminAuthorized, json } from "@/lib/server/http";
import { AppError } from "@/lib/server/util";

export const dynamic = "force-dynamic";


type Check = { name: string; job: Job; model: string; ok: boolean; ms: number; detail: string };

async function check(name: string, job: Job, fn: () => Promise<string>): Promise<Check> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { name, job, model: modelFor(job), ok: true, ms: Date.now() - t, detail };
  } catch (e) {
    const detail = e instanceof AppError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    return { name, job, model: modelFor(job), ok: false, ms: Date.now() - t, detail };
  }
}

/**
 * One small call per kind of model use. Run it before recording to see that everything works.
 * Body: { image?: boolean } (the image check is opt-in because it's the slowest and priciest).
 */
export async function POST(req: Request) {
  if (!adminAuthorized(req)) return json({ error: { code: "unauthorized", message: "Missing or wrong x-admin-key." } }, { status: 401 });
  let body: { image?: unknown } = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return json({ error: { code: "invalid", message: "Body must be JSON." } }, { status: 400 });
  }
  const opts = { visitor: "ai-check" };

  const checks = await Promise.all([
    check("text", "fast", async () => {
      const r = await respond("fast", { input: [{ role: "user", content: "Reply with the single word: ready" }], max_output_tokens: 200 }, opts);
      const out = outputText(r).trim();
      if (!out) throw new Error("Empty reply.");
      return out.slice(0, 60);
    }),
    check("structured output (drafts)", "draft", async () => {
      const r = await structured(
        "draft",
        {
          system: "You name challenges. Answer in JSON.",
          input: "One hard thing: run 365 miles this year.",
          schema: z.object({ title: z.string(), unit: z.string() }),
          name: "check",
          maxTokens: 1500,
        },
        opts,
      );
      return JSON.stringify(r);
    }),
    check("tool calling (Virgil)", "agent", async () => {
      const r = await respond(
        "agent",
        {
          instructions: "You log progress for the user by calling tools.",
          input: [{ role: "user", content: "I ran 3 miles today. Log it." }],
          tools: [
            {
              type: "function",
              name: "log_progress",
              description: "Record what the person did.",
              parameters: { type: "object", properties: { value: { type: "number" }, note: { type: "string" } }, required: ["value"] },
              strict: false,
            },
          ],
          max_output_tokens: 2000,
        },
        opts,
      );
      const calls = functionCalls(r);
      if (!calls.length) throw new Error(`No tool call. Reply: ${outputText(r).slice(0, 120)}`);
      return `${calls[0].name}(${calls[0].arguments})`;
    }),
    check("streaming (page builder)", "codegen", async () => {
      const r = await streamText(
        "codegen",
        { instructions: "Return only HTML.", input: [{ role: "user", content: "A minimal HTML page that says hello." }], max_output_tokens: 2000 },
        { ...opts, idleMs: 60_000 },
      );
      if (!/<html|<body|<p|<h1/i.test(r.text)) throw new Error(`No HTML in the reply (${r.status}).`);
      return `${r.text.length} chars, ${r.status}`;
    }),
    ...(body.image === true
      ? [
          check("image", "image", async () => {
            const img = await generateImage("A small clay mountain icon on a cream background, no text", "4:3", opts);
            return `${img.mime}, ${Math.round(img.data.length / 1024)} KB`;
          }),
        ]
      : []),
  ]);

  return json({ ok: checks.every((c) => c.ok), checks });
}
