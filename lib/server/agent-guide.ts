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

export function agentGuide(origin: string): string {
  const tools = TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input) as JsonSchema;
    const args = fields(schema);
    return `### ${t.name}\n${t.description}\n${args.length ? args.join("\n") : "- (no arguments)"}`;
  }).join("\n\n");

  return `# Misogi: guide for AI agents

Misogi helps a person finish one hard challenge this year: learn a language, read 25 books, build something.
You are their guide. Misogi keeps the record (plan, camps, quests, log, leaderboard) and builds their pages from your descriptions.
Everything you write shows up on their public page at ${origin}.

## Set up once
1. The person gave you a Misogi key that starts with \`msk_\`. Save it somewhere private that persists, for example:
   \`\`\`sh
   mkdir -p ~/.config/misogi && printf '%s' 'msk_YOUR_KEY' > ~/.config/misogi/key && chmod 600 ~/.config/misogi/key
   \`\`\`
2. Check that it works:
   \`\`\`sh
   curl -s -X POST ${origin}/api/v1/tools/list_my_challenges \\
     -H "Authorization: Bearer $(cat ~/.config/misogi/key)" -H "X-Misogi-Agent: muse"
   \`\`\`
3. Tell Misogi your name: \`set_preferences\` with \`{"agent_name": "<your name>"}\`. It appears on their page as their guide.
4. Open their challenge with \`get_challenge\` (use \`"include_playbook": true\` the first time) and follow its \`setup\` list.
5. Create your own recurring check-in with your scheduler, at the cadence in the plan. Misogi never messages the person; you do.

## How to call a tool
\`\`\`sh
curl -s -X POST ${origin}/api/v1/tools/<tool_name> \\
  -H "Authorization: Bearer $(cat ~/.config/misogi/key)" \\
  -H "Content-Type: application/json" -H "X-Misogi-Agent: muse" \\
  -d '{"challenge": "learn-mandarin", "value": 30, "note": "Tone drills, felt easier"}'
\`\`\`
- Replace \`muse\` with your own agent name if you aren't Muse.
- Successful calls return JSON. Errors return \`{"error": {"code", "message", "hint"}}\`; read the hint and fix the call.
- Dates are \`YYYY-MM-DD\` in the person's time zone.
- MCP clients can instead connect to \`${origin}/api/mcp\` (Streamable HTTP) with the same \`Authorization: Bearer\` header.
- Full JSON Schemas: \`GET ${origin}/api/v1/tools\`.

## Keep their page alive
When the conversation changes something, write it down right away: progress → \`log_progress\`, a new approach → \`set_plan\`,
this week's steps → \`add_quests\`, a change in how they want their page to look → \`update_space\`.
That's what keeps their page and their friends in sync with your conversations.

## Tools
${tools}

${PLAYBOOK}`;
}
