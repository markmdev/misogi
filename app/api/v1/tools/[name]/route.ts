import type { NextRequest } from "next/server";
import { requireApiCaller, type ApiCaller } from "@/lib/server/auth";
import { errorJson, json, originOf, rateLimit } from "@/lib/server/http";
import { runTool, type ToolSource } from "@/lib/server/tools";

export const dynamic = "force-dynamic";

function sourceFrom(req: Request, caller: ApiCaller): ToolSource {
  const agent = `${req.headers.get("x-misogi-agent") ?? ""} ${caller.client ?? ""}`.toLowerCase();
  if (agent.includes("muse")) return "muse";
  return "agent";
}

/** Runs one tool for the agent that holds the key. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/v1/tools/[name]">) {
  try {
    const { name } = await ctx.params;
    const caller = requireApiCaller(req);
    const user = caller.user;
    rateLimit(`api:${user.id}`, 120, 60);
    let body: unknown = {};
    const text = await req.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: { code: "invalid", message: "Body must be JSON." } }, { status: 400 });
      }
    }
    const result = await runTool(name, { user, source: sourceFrom(req, caller), origin: originOf(req) }, body);
    if (!result.ok) {
      const status = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, resting: 503 }[result.error.code] ?? 500;
      return json({ error: result.error }, { status });
    }
    return json(result.result);
  } catch (e) {
    return errorJson(e);
  }
}
