import type { NextRequest } from "next/server";
import { clientIp, errorJson, json, rateLimit } from "@/lib/server/http";
import { currentUser } from "@/lib/server/auth";
import { one } from "@/lib/server/db";
import { getVersion, reportRenderError } from "@/lib/server/spaces";

export const dynamic = "force-dynamic";

/** The challenge page reports a space that broke in the browser; Misogi falls back to the last good version. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/spaces/[id]/error">) {
  try {
    rateLimit(`spaceerr:${clientIp(req)}`, 6, 6);
    const { id } = await ctx.params;
    const body = ((await req.json().catch(() => null)) ?? {}) as { message?: unknown; shows?: unknown };
    const message = String(body.message ?? "Unknown error").slice(0, 300);
    // Only the space's owner (or the challenge creator, for the shared page) can trigger a rollback;
    // anyone else's report is just logged, so strangers can't knock a page offline.
    const user = await currentUser();
    const v = getVersion(id);
    const owner = v ? v.owner_key || one<{ creator_id: string }>("SELECT creator_id FROM challenges WHERE id = ?", v.challenge_id)?.creator_id : null;
    if (user && v && owner === user.id) reportRenderError(id, message, body.shows === true);
    else console.warn(`[space] render error reported for ${id}: ${message}`);
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
