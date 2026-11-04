import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { errorJson, json, rateLimit } from "@/lib/server/http";
import { saveMarks } from "@/lib/server/spaces";
import { AppError } from "@/lib/server/util";

export const dynamic = "force-dynamic";

/** A page someone is looking at keeps what they ticked or picked; the challenge page passes it on from the page's frame. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/spaces/[id]/marks">) {
  try {
    const user = await currentUser();
    if (!user) throw new AppError("unauthorized", "Sign in to keep what you tick.");
    rateLimit(`marks:${user.id}`, 60, 20);
    const text = await req.text();
    if (text.length > 10_000) throw new AppError("invalid", "That's more than a page can keep for you.");
    const body = (() => {
      try {
        return JSON.parse(text) as { data?: unknown };
      } catch {
        return null;
      }
    })();
    if (!body || typeof body !== "object") throw new AppError("invalid", "Send { data }.");
    const { id } = await ctx.params;
    saveMarks(id, user, body.data);
    return json({ ok: true });
  } catch (e) {
    return errorJson(e);
  }
}
