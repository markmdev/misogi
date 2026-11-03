// MCP server (Streamable HTTP, stateless) for agents that speak MCP: Claude, ChatGPT and others.
// Same tools and the same key as the HTTP API.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bearerFrom, callerForApiKey, type UserRow } from "./auth";
import { originOf, rateLimit } from "./http";
import { PLAYBOOK } from "./playbook";
import { runTool, TOOLS, type ToolSource } from "./tools";
import { AppError } from "./util";



function server(user: UserRow, source: ToolSource, origin: string) {
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
        const r = await runTool(t.name, { user, source, origin }, args);
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

export async function handleMcp(req: Request, keyFromPath?: string) {
  const key = keyFromPath ?? bearerFrom(req);
  if (!key) return unauthorized("Missing Misogi key. Send Authorization: Bearer msk_...");
  const caller = callerForApiKey(key);
  if (!caller) return unauthorized("This Misogi key isn't valid.");
  const user = caller.user;
  try {
    rateLimit(`mcp:${user.id}`, 120, 60);
  } catch (e) {
    if (e instanceof AppError) return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: e.message }, id: null }, { status: 429 });
    throw e;
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const mcp = server(user, caller.client?.toLowerCase().includes("muse") ? "muse" : "mcp", originOf(req));
  await mcp.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void mcp.close();
  }
}
