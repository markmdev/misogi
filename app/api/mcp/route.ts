// MCP endpoint for agents that speak MCP. See lib/server/mcp.ts.
import { handleMcp } from "@/lib/server/mcp";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleMcp(req);
}

export async function GET() {
  return new Response("Use POST (stateless Streamable HTTP).", { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
