import type { NextRequest } from "next/server";
import { clientIp, errorJson, json, rateLimit } from "@/lib/server/http";
import { reportRenderError } from "@/lib/server/spaces";

export const dynamic = "force-dynamic";

/** The challenge page reports a space that broke in the browser; Misogi falls back to the last good version. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/spaces/[id]/error">) {
  try {
    rateLimit(`spaceerr:${clientIp(req)}`, 6, 6);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { message?: string };
    reportRenderError(id, String(body.message ?? "Unknown error"));
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
