// One client for every model call. Both providers speak the Responses API
// (`POST /v1/responses`), so switching from xAI to Meta is a config change.
//
//   AI_PROVIDER=xai   (default until Meta credits land) — key from XAI_API_KEY or the team key API
//   AI_PROVIDER=meta  — Meta Model API through the team gateway (GATEWAY_KEY, x-visitor header)

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { AppError } from "../util";

export type Job = "agent" | "draft" | "codegen" | "fast" | "image";
export type Provider = "xai" | "meta";

const MODELS: Record<Provider, Record<Job, string>> = {
  xai: {
    agent: "grok-4.7",
    draft: "grok-4.20-0309-non-reasoning",
    codegen: "grok-build-0.1",
    fast: "grok-4.20-0309-non-reasoning",
    image: "grok-imagine-image-2.0",
  },
  meta: {
    agent: "muse-spark-1.3",
    draft: "muse-spark-1.3",
    codegen: "muse-wonder-1.0",
    fast: "muse-spark-1.3",
    image: "muse-image-1.0",
  },
};

// Muse models always reason first, and their reasoning counts against max_output_tokens: left at
// the model's own level, a short call can spend its whole budget thinking and return nothing.
const META_EFFORT: Record<Exclude<Job, "image">, string> = {
  agent: "low",
  draft: "minimal",
  codegen: "medium",
  fast: "minimal",
};

function withEffort(job: Job, body: Record<string, unknown>): Record<string, unknown> {
  if (provider() !== "meta" || job === "image") return body;
  return { ...body, reasoning: { effort: META_EFFORT[job] } };
}

export function provider(): Provider {
  return process.env.AI_PROVIDER === "meta" ? "meta" : "xai";
}

export function modelFor(job: Job): string {
  const env = process.env[`AI_MODEL_${job.toUpperCase()}`];
  return env || MODELS[provider()][job];
}

function baseUrl(): string {
  if (provider() === "meta") {
    // A personal Meta key talks to Meta directly; otherwise go through the team gateway.
    const fallback = process.env.META_API_KEY ? "https://api.meta.ai/v1" : "https://meta-gateway.<account>.workers.dev/v1";
    return (process.env.META_BASE_URL || fallback).replace(/\/$/, "");
  }
  return "https://api.x.ai/v1";
}

// ---------- Keys ----------

const keyState = globalThis as unknown as {
  __xaiKey?: { value: string; fetchedAt: number };
  __xaiRotateAt?: number;
};

function keyApiConfig(): { url: string; password: string } | null {
  if (process.env.GROK_KEY_API_URL && process.env.GROK_KEY_API_PASSWORD)
    return { url: process.env.GROK_KEY_API_URL.trim(), password: process.env.GROK_KEY_API_PASSWORD.trim() };
  // Local development on the owner's machine: read the key API config in place.
  try {
    const dir = path.join(os.homedir(), ".config/grok-key-api");
    return {
      url: fs.readFileSync(path.join(dir, "url"), "utf8").trim(),
      password: fs.readFileSync(path.join(dir, "password"), "utf8").trim(),
    };
  } catch {
    return null;
  }
}

async function xaiKey(force = false): Promise<string> {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
  const cached = keyState.__xaiKey;
  // The pool hands out a new key every ~2 hours; refetch every 20 minutes or on demand.
  if (!force && cached && Date.now() - cached.fetchedAt < 20 * 60_000) return cached.value;
  const cfg = keyApiConfig();
  if (!cfg) throw new AppError("resting", "No AI key is configured.");
  const res = await fetch(`${cfg.url.replace(/\/$/, "")}/key`, {
    headers: { Authorization: `Bearer ${cfg.password}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new AppError("resting", "The AI key service is unavailable right now.");
  const value = (await res.text()).trim();
  keyState.__xaiKey = { value, fetchedAt: Date.now() };
  return value;
}

/** Asks the key pool to switch accounts after a real limit error. At most once an hour per server. */
async function rotateXaiKey() {
  const cfg = keyApiConfig();
  if (!cfg || process.env.XAI_API_KEY) return;
  if (keyState.__xaiRotateAt && Date.now() - keyState.__xaiRotateAt < 60 * 60_000) return;
  keyState.__xaiRotateAt = Date.now();
  const before = keyState.__xaiKey?.value;
  try {
    await fetch(`${cfg.url.replace(/\/$/, "")}/rotate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.password}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return;
  }
  // Poll in the background until the pool serves a different key.
  void (async () => {
    for (let i = 0; i < 9; i++) {
      await new Promise((r) => setTimeout(r, 20_000));
      try {
        const k = await xaiKey(true);
        if (k !== before) return;
      } catch {
        /* keep polling */
      }
    }
  })();
}

async function authHeaders(opts: { visitor?: string; judge?: boolean }): Promise<Record<string, string>> {
  if (provider() === "meta") {
    const key =
      process.env.META_API_KEY ||
      (opts.judge ? process.env.GATEWAY_JUDGES_KEY || process.env.GATEWAY_KEY : process.env.GATEWAY_KEY);
    if (!key) throw new AppError("resting", "The Meta key isn't configured.");
    const h: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (opts.visitor) h["x-visitor"] = crypto.createHash("sha256").update(opts.visitor).digest("hex");
    return h;
  }
  return { Authorization: `Bearer ${await xaiKey()}` };
}

// ---------- Responses API ----------

export type ResponseItem = Record<string, unknown> & { type?: string };

export type ResponsesResult = {
  id: string;
  status: string;
  output: ResponseItem[];
  usage?: Record<string, unknown>;
};

export type CallOptions = {
  visitor?: string;
  judge?: boolean;
  timeoutMs?: number;
};

const TIMEOUTS: Record<Job, number> = { agent: 90_000, draft: 90_000, codegen: 300_000, fast: 45_000, image: 120_000 };

async function post(pathname: string, body: unknown, job: Job, opts: CallOptions, attempt = 0): Promise<Response> {
  const res = await fetch(`${baseUrl()}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders(opts)) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUTS[job]),
  }).catch((e: unknown) => {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new AppError("resting", timeout ? "The model took too long to answer." : "Couldn't reach the model.");
  });
  if (res.status === 401 && provider() === "xai" && attempt === 0) {
    await xaiKey(true);
    return post(pathname, body, job, opts, 1);
  }
  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    // Rotate the shared key pool only on a real usage/credit limit, never on a per-minute rate limit.
    if (provider() === "xai" && /credit|quota|spend|usage limit|billing|exhaust|insufficient/i.test(text)) void rotateXaiKey();
    if (text.includes("gateway_resting")) throw new AppError("resting", "Misogi's AI is resting for now. Try again later.");
    throw new AppError("resting", "The AI is busy right now. Try again in a minute.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[ai] ${pathname} ${res.status}: ${text.slice(0, 500)}`);
    if (res.status >= 500) throw new AppError("resting", "The model had a problem. Try again.");
    throw new AppError("internal", `Model request failed (${res.status}).`);
  }
  return res;
}

export async function respond(job: Job, body: Record<string, unknown>, opts: CallOptions = {}): Promise<ResponsesResult> {
  const t = Date.now();
  const res = await post("/responses", { model: modelFor(job), store: false, ...withEffort(job, body) }, job, opts);
  const json = (await res.json()) as ResponsesResult;
  if (process.env.AI_DEBUG) console.log(`[ai] ${job} ${modelFor(job)} ${Date.now() - t}ms`, JSON.stringify(json.usage ?? {}));
  return json;
}

/**
 * Streams a response and returns the full text. Used for long generations: Meta answers
 * long non-streaming calls with a 504, and streaming keeps proxies from idling out.
 */
export async function streamText(
  job: Job,
  body: Record<string, unknown>,
  opts: CallOptions & { idleMs?: number; onDelta?: (chars: number) => void } = {},
): Promise<{ text: string; status: string }> {
  const res = await post("/responses", { model: modelFor(job), store: false, ...withEffort(job, body), stream: true }, job, opts);
  if (!res.body) throw new AppError("resting", "The model returned an empty stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let status = "in_progress";
  const idleMs = opts.idleMs ?? 90_000;
  const readWithIdle = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AppError("resting", "The model stopped responding.")), idleMs);
    });
    return Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
  };
  try {
    for (;;) {
      const { done, value } = await readWithIdle().catch((e: unknown) => {
        if (e instanceof AppError) throw e;
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new AppError("resting", timeout ? "The model took too long to finish." : "The connection to the model dropped.");
      });
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let ev: { type?: string; delta?: string; response?: { status?: string; error?: { message?: string } }; message?: string };
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.type === "response.output_text.delta" && ev.delta) {
          text += ev.delta;
          opts.onDelta?.(text.length);
        } else if (ev.type === "response.completed") status = "completed";
        else if (ev.type === "response.incomplete") status = "incomplete";
        else if (ev.type === "response.failed" || ev.type === "error") {
          console.error("[ai] stream failed", ev.response?.error?.message ?? ev.message);
          throw new AppError("resting", "The model failed while writing. Try again.");
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return { text, status };
}

export function outputText(r: ResponsesResult): string {
  const parts: string[] = [];
  for (const item of r.output ?? []) {
    if (item.type !== "message") continue;
    const content = (item.content as { type: string; text?: string }[] | undefined) ?? [];
    for (const c of content) if ((c.type === "output_text" || c.type === "text") && c.text) parts.push(c.text);
  }
  return parts.join("").trim();
}

export function functionCalls(r: ResponsesResult): { call_id: string; name: string; arguments: string; item: ResponseItem }[] {
  return (r.output ?? [])
    .filter((i) => i.type === "function_call")
    .map((i) => ({ call_id: String(i.call_id), name: String(i.name), arguments: String(i.arguments ?? "{}"), item: i }));
}

/** JSON Schema for a zod schema, in the shape strict structured outputs expect. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/** Ask for JSON matching `schema`; validates the result. Retries once on a bad answer. */
export async function structured<T>(
  job: Job,
  args: { system: string; input: string | ResponseItem[]; schema: z.ZodType<T>; name: string; maxTokens?: number },
  opts: CallOptions = {},
): Promise<T> {
  const input = typeof args.input === "string" ? [{ role: "user", content: args.input }] : args.input;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await respond(
      job,
      {
        instructions: args.system,
        input: attempt === 0 ? input : [...input, { role: "user", content: `Your last answer was invalid (${lastError}). Answer again with valid JSON only.` }],
        max_output_tokens: args.maxTokens ?? 4000,
        text: { format: { type: "json_schema", name: args.name, schema: jsonSchema(args.schema), strict: true } },
      },
      opts,
    );
    const text = outputText(r);
    try {
      const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      const ok = args.schema.safeParse(parsed);
      if (ok.success) return ok.data;
      lastError = ok.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch {
      lastError = "not JSON";
    }
  }
  throw new AppError("resting", "The model gave an unusable answer. Try again.");
}

// ---------- Images ----------

export type Aspect = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

// Muse Image's image_generation tool takes only these three shapes; anything else is a 400.
const META_SIZES: Record<Aspect, string> = { "1:1": "1024x1024", "16:9": "1536x1024", "9:16": "1024x1536", "4:3": "1536x1024", "3:4": "1024x1536" };

function sniffMime(data: Buffer): string {
  if (data[0] === 0x89) return "image/png";
  if (data[0] === 0xff) return "image/jpeg";
  return "image/webp";
}

export async function generateImage(prompt: string, aspect: Aspect = "1:1", opts: CallOptions = {}): Promise<{ data: Buffer; mime: string; model: string }> {
  const model = modelFor("image");
  if (provider() === "meta") {
    // Muse Image answers on /v1/responses with an image_generation_call item (base64).
    const res = await post(
      "/responses",
      {
        model,
        input: prompt,
        tools: [
          {
            type: "image_generation",
            size: META_SIZES[aspect],
            output_format: "png",
            reasoning_strength: "low",
            enable_web_search: false,
            enable_shell: false,
          },
        ],
      },
      "image",
      opts,
    );
    const json = (await res.json()) as ResponsesResult;
    const item = json.output?.find((i) => i.type === "image_generation_call");
    const b64 = item?.result as string | undefined;
    if (!b64) throw new AppError("resting", "The image model returned nothing.");
    const data = Buffer.from(b64, "base64");
    return { data, mime: sniffMime(data), model };
  }
  const res = await post(
    "/images/generations",
    { model, prompt, n: 1, aspect_ratio: aspect, response_format: "b64_json" },
    "image",
    opts,
  );
  const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const first = json.data?.[0];
  let data: Buffer;
  if (first?.b64_json) data = Buffer.from(first.b64_json, "base64");
  else if (first?.url) data = Buffer.from(await (await fetch(first.url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
  else throw new AppError("resting", "The image model returned nothing.");
  return { data, mime: sniffMime(data), model };
}
