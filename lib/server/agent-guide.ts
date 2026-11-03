// The guide an agent (Muse, Claude, ChatGPT, ...) reads to work with Misogi.
// Generated from the tool registry, so it never drifts from the API.

import { z } from "zod";
import { PLAYBOOK } from "./playbook";
import { TOOLS } from "./tools";

type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
};

function typeOf(s: JsonSchema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.anyOf) return s.anyOf.map(typeOf).join(" | ");
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (s.type === "array" && s.items) return `${s.items.type === "object" ? "object" : typeOf(s.items)}[]`;
  return s.type ?? "any";
}

function fields(s: JsonSchema, indent = ""): string[] {
  const out: string[] = [];
  const req = new Set(s.required ?? []);
  for (const [name, p] of Object.entries(s.properties ?? {})) {
    const desc = p.description ? ` — ${p.description}` : "";
    out.push(`${indent}- \`${name}\` (${typeOf(p)}${req.has(name) ? "" : ", optional"})${desc}`);
    const inner = p.type === "array" ? p.items : p.type === "object" ? p : p.anyOf?.find((x) => x.type === "object");
    if (inner && inner.properties) out.push(...fields(inner, indent + "  "));
  }
  return out;
}

/** Who the personal guide is for: the account a Connect message's code names. */
export type GuideFor = { name: string; handle: string; code: string; used: boolean; challenges: { slug: string; title: string }[] };

function connectSection(origin: string, person?: GuideFor): string {
  const key = `\n\n**With a key instead:** if the person gave you a key that starts with \`msk_\` (from the "Claude & other AIs" tab), send it as \`Authorization: Bearer msk_...\` and keep it in your own secret store, never in chat or memory.`;
  let connect: string;
  if (!person) {
    connect = `Ask the person to copy the message from their Connect page (${origin}/connect) and send it to you. Its link is this guide written for them, with a one-tap sign-in to their account, so no key passes through the chat.`;
  } else if (person.used) {
    connect = `This link has already connected an AI to ${person.name}'s account. If that was you, you're set. If not, ask ${person.name} to copy a fresh message from Misogi's Connect page.`;
  } else {
    const host = new URL(origin).host;
    const museCall = {
      provider: "misogi",
      api_hosts: [host],
      auth_scheme: "oauth2_code",
      issuer_domain: host,
      authorization_url: `${origin}/oauth/authorize/${person.code}`,
      token_url: `${origin}/oauth/token`,
      token_endpoint_auth_method: "none",
      registration_url: `${origin}/oauth/register`,
      resource: `${origin}/api/mcp`,
      scopes: "misogi",
    };
    connect = `**Muse:** register a custom connector with \`credentials.request_api_access\`, exactly:
\`\`\`json
${JSON.stringify(museCall, null, 2)}
\`\`\`
${person.name} taps Connect on your card once. Tell them only that, in one short line, without technical words. This link names ${person.name}'s account, and it replaces any Misogi connection you already have: if \`custom.misogi\` is already connected, call again with \`"reconnect": true\`.`;
  }
  return `## Connect once
${connect}${person ? "" : key}

## Then
1. Check it works: \`list_my_challenges\`.
2. Tell Misogi your name: \`set_preferences\` with \`{"agent_name": "<your name>"}\`. It appears on their page as their guide.
3. Open their challenge with \`get_challenge\` (use \`"include_playbook": true\` the first time) and follow its \`setup\` list.
4. Create your own recurring check-in with your scheduler, at the cadence in the plan. Misogi never messages the person; you do.

`;
}

export function agentGuide(origin: string, person?: GuideFor): string {
  const tools = TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input) as JsonSchema;
    const args = fields(schema);
    return `### ${t.name}\n${t.description}\n${args.length ? args.join("\n") : "- (no arguments)"}`;
  }).join("\n\n");

  const intro = person
    ? `# Misogi: you're ${person.name}'s guide

${person.name} (@${person.handle}) asked you to coach them on Misogi, a site where people finish one hard challenge this year.
${person.challenges.length ? `Their climbs: ${person.challenges.map((c) => `"${c.title}" (\`${c.slug}\`)`).join(", ")}. Start with the first unless they say otherwise.` : "They haven't started a climb yet: offer to create one with them."}
Misogi keeps the record (plan, camps, quests, log, leaderboard) and builds their pages from your descriptions.
Everything you write shows up on their public page at ${origin}/u/${person.handle}.`
    : `# Misogi: guide for AI agents

Misogi helps a person finish one hard challenge this year: learn a language, read 25 books, build something.
You are their guide. Misogi keeps the record (plan, camps, quests, log, leaderboard) and builds their pages from your descriptions.
Everything you write shows up on their public page at ${origin}.`;

  return `${intro}

${connectSection(origin, person)}## How to call a tool
Over MCP at \`${origin}/api/mcp\`, or over HTTP with the same credential:
\`\`\`sh
curl -s -X POST ${origin}/api/v1/tools/<tool_name> \\
  -H "Authorization: Bearer <your Misogi credential>" \\
  -H "Content-Type: application/json" -H "X-Misogi-Agent: muse" \\
  -d '{"challenge": "learn-mandarin", "value": 30, "note": "Tone drills, felt easier"}'
\`\`\`
- Replace \`muse\` with your own agent name if you aren't Muse.
- Successful calls return JSON. Errors return \`{"error": {"code", "message", "hint"}}\`; read the hint and fix the call.
- Dates are \`YYYY-MM-DD\` in the person's time zone.
- Full JSON Schemas: \`GET ${origin}/api/v1/tools\`.

## Keep their page alive
When the conversation changes something, write it down right away: progress → \`log_progress\`, a new approach → \`set_plan\`,
this week's steps → \`add_quests\`, a change in how they want their page to look → \`update_space\`.
That's what keeps their page and their friends in sync with your conversations.

## Tools
${tools}

${PLAYBOOK}`;
}
