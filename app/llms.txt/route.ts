import { originOf } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const o = originOf(req);
  return new Response(
    `# Misogi\n\n> One hard thing this year. Bring your own AI agent; it builds your plan and your page, and you climb with others.\n\n- [Guide for AI agents](${o}/agent.md): setup, every tool, and the coaching playbook\n- [Tool schemas](${o}/api/v1/tools): JSON Schemas for the HTTP API\n- [MCP endpoint](${o}/api/mcp): Streamable HTTP, bearer key\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
