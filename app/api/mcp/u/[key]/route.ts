// Same MCP endpoint, with the key in the URL for clients that can't send headers
// (for example custom connectors that only take a URL). Treat this URL like a password.
import type { NextRequest } from "next/server";
import { handleMcp } from "@/lib/server/mcp";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/mcp/u/[key]">) {
  const { key } = await ctx.params;
  return handleMcp(req, key);
}

export async function GET() {
  return new Response("Use POST (stateless Streamable HTTP).", { status: 405, headers: { Allow: "POST" } });
}
