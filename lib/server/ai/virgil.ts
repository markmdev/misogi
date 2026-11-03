// Virgil: Misogi's built-in guide for people without their own agent.
// A tool-calling loop over the same tools every external agent uses.

import { z } from "zod";
import type { UserRow } from "../auth";
import { all, run } from "../db";
import { myChallenges } from "../domain/challenges";
import { PLAYBOOK, VIRGIL_PERSONA } from "../playbook";
import { runTool, TOOLS, type ToolCtx } from "../tools";
import { AppError, dateIn, id, nowIso } from "../util";
import { functionCalls, outputText, provider, respond, type ResponseItem } from "./client";

export type VirgilEvent =
  | { type: "tool"; name: string; label: string }
  | { type: "tool_done"; name: string; ok: boolean; error?: string }
  | { type: "message"; text: string }
  | { type: "changed"; what: string[] }
  | { type: "error"; message: string }
  | { type: "done" };

const MAX_STEPS = 8;
const HISTORY_TURNS = 24;

// Virgil doesn't need these (the web UI handles them).
const HIDDEN = new Set(["get_sign_in_link"]);

function toolDefs() {
  return TOOLS.filter((t) => !HIDDEN.has(t.name)).map((t) => {
    const parameters = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete parameters.$schema;
    return { type: "function", name: t.name, description: t.description, parameters, ...(provider() === "meta" ? { strict: false } : {}) };
  });
}

type Stored = { role: "user" | "assistant"; text: string };

export function threadHistory(userId: string, thread: string, limit = HISTORY_TURNS): Stored[] {
  return all<{ role: string; item_json: string }>(
    "SELECT role, item_json FROM agent_messages WHERE user_id = ? AND thread = ? ORDER BY created_at DESC LIMIT ?",
    userId,
    thread,
    limit,
  )
    .reverse()
    .map((r) => ({ role: r.role as Stored["role"], text: (JSON.parse(r.item_json) as { text: string }).text }));
}

function store(userId: string, thread: string, role: Stored["role"], text: string) {
  run(
    "INSERT INTO agent_messages (id, user_id, thread, role, item_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id("msg"),
    userId,
    thread,
    role,
    JSON.stringify({ text }),
    nowIso(),
  );
}

const WRITE_EFFECTS: Record<string, string> = {
  log_progress: "logs",
  remove_log: "logs",
  set_plan: "plan",
  add_quests: "quests",
  skip_quest: "quests",
  complete_milestone: "plan",
  update_space: "space",
  undo_space: "space",
  update_challenge: "challenge",
  create_challenge: "challenge",
  join_challenge: "challenge",
  set_preferences: "profile",
  complete_challenge: "challenge",
};

export async function runVirgil(
  user: UserRow,
  args: { thread: string; message: string; challenge?: string | null; origin: string },
  emit: (e: VirgilEvent) => void,
) {
  const message = args.message.trim().slice(0, 4000);
  if (!message) throw new AppError("invalid", "Say something first.");
  const history = threadHistory(user.id, args.thread);
  const mine = myChallenges(user.id);
  const context = [
    `Person: ${user.display_name} (@${user.handle}). Time zone ${user.timezone}; today is ${dateIn(user.timezone)}.`,
    `Motivation style: ${user.motivation_style || "not set yet"}.`,
    mine.length
      ? `Their challenges: ${mine.map((c) => `${c.title} [slug ${c.slug}, ${c.role}]`).join("; ")}.`
      : "They have no challenges yet.",
    args.challenge ? `They're looking at the challenge "${args.challenge}" right now; assume questions are about it unless they say otherwise.` : "",
    "Call get_challenge before giving advice about a challenge, so you work from the real record.",
  ]
    .filter(Boolean)
    .join("\n");

  const instructions = `${VIRGIL_PERSONA}\n\n${PLAYBOOK}\n\n## Right now\n${context}`;
  const input: ResponseItem[] = [
    ...history.map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: message },
  ];
  const ctx: ToolCtx = { user, source: "virgil", origin: args.origin };
  const tools = toolDefs();
  const changed = new Set<string>();
  const seen = new Map<string, number>();
  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await respond("agent", { instructions, input, tools, max_output_tokens: 6000 }, { visitor: user.id });
    const calls = functionCalls(r);
    const text = outputText(r);
    if (calls.length === 0) {
      finalText = text;
      break;
    }
    // Replay the model's own items (calls and any commentary) unchanged, then our outputs.
    for (const item of r.output) {
      if (item.type === "function_call" || item.type === "message") input.push(item);
    }
    for (const call of calls) {
      const def = TOOLS.find((t) => t.name === call.name);
      emit({ type: "tool", name: call.name, label: def?.label ?? call.name });
      const sig = `${call.name}:${call.arguments}`;
      seen.set(sig, (seen.get(sig) ?? 0) + 1);
      let output: string;
      if ((seen.get(sig) ?? 0) > 2) {
        output = JSON.stringify({ error: { code: "loop", message: "You already made this exact call. Answer the person instead." } });
        emit({ type: "tool_done", name: call.name, ok: false, error: "repeated" });
      } else if (HIDDEN.has(call.name)) {
        output = JSON.stringify({ error: { code: "forbidden", message: "That tool isn't available here." } });
        emit({ type: "tool_done", name: call.name, ok: false, error: "not available" });
      } else {
        let parsed: unknown = {};
        try {
          parsed = JSON.parse(call.arguments || "{}");
        } catch {
          parsed = null;
        }
        const res = parsed === null
          ? { ok: false as const, error: { code: "invalid", message: "Arguments were not valid JSON." } }
          : await runTool(call.name, ctx, parsed);
        output = JSON.stringify(res.ok ? res.result : { error: res.error });
        emit({ type: "tool_done", name: call.name, ok: res.ok, error: res.ok ? undefined : res.error.message });
        if (res.ok && WRITE_EFFECTS[call.name]) changed.add(WRITE_EFFECTS[call.name]);
      }
      input.push({ type: "function_call_output", call_id: call.call_id, output: output.slice(0, 30_000) });
    }
    if (step === MAX_STEPS - 1) finalText = text || "I did what I could there. Want me to keep going?";
  }

  if (!finalText) finalText = "Done.";
  store(user.id, args.thread, "user", message);
  store(user.id, args.thread, "assistant", finalText);
  if (changed.size) emit({ type: "changed", what: [...changed] });
  emit({ type: "message", text: finalText });
  emit({ type: "done" });
}
