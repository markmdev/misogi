// MCP endpoint (Streamable HTTP, stateless) for agents that speak MCP: Claude, ChatGPT and others.
// Same tools and the same key as the HTTP API.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bearerFrom, userForApiKey, type UserRow } from "@/lib/server/auth";
import { originOf, rateLimit } from "@/lib/server/http";
import { PLAYBOOK } from "@/lib/server/playbook";
import { runTool, TOOLS } from "@/lib/server/tools";
import { AppError } from "@/lib/server/util";

export const dynamic = "force-dynamic";

function server(user: UserRow, origin: string) {
  const mcp = new McpServer(
    { name: "misogi", version: "1.0.0" },
    {
      instructions: `Misogi keeps the record for ${user.display_name}'s year-long challenges and builds their pages. Start with list_my_challenges, then get_challenge.\n\n${PLAYBOOK}`,
    },
  );
  for (const t of TOOLS) {
    mcp.registerTool(
      t.name,
      {
        title: t.label,
        description: t.description,
        inputSchema: t.input,
        annotations: { readOnlyHint: !t.writes, destructiveHint: false, openWorldHint: false },
      },
      async (args: unknown) => {
        const r = await runTool(t.name, { user, source: "mcp", origin }, args);
        if (!r.ok) return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: r.error }) }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(r.result) }] };
      },
    );
  }
  return mcp;
}

function unauthorized(message: string) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message }, id: null },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="misogi"' } },
  );
}

async function handle(req: Request) {
  const key = bearerFrom(req);
  if (!key) return unauthorized("Missing Misogi key. Send Authorization: Bearer msk_...");
  const user = userForApiKey(key);
  if (!user) return unauthorized("This Misogi key isn't valid.");
  try {
    rateLimit(`mcp:${user.id}`, 120, 60);
  } catch (e) {
    if (e instanceof AppError) return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: e.message }, id: null }, { status: 429 });
    throw e;
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const mcp = server(user, originOf(req));
  await mcp.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void mcp.close();
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET() {
  return new Response("Use POST (stateless Streamable HTTP).", { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
