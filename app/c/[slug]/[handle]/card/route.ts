import type { NextRequest } from "next/server";
import { weeklyCard } from "@/lib/server/cards";
import { findChallenge, getMembership } from "@/lib/server/domain/challenges";
import { memberFacts } from "@/lib/server/domain/progress";
import { getUserByHandle, publicUser } from "@/lib/server/domain/users";
import { metricOf } from "@/lib/server/domain/challenges";

export const dynamic = "force-dynamic";

/** The weekly recap card as a PNG, made to post on X, Threads or Instagram. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/c/[slug]/[handle]/card">) {
  const { slug, handle } = await ctx.params;
  const c = findChallenge(slug);
  const u = getUserByHandle(handle);
  const m = c && u ? getMembership(c.id, u.id) : null;
  if (!c || !u || !m || c.status === "draft") return new Response("Not found", { status: 404 });
  return weeklyCard(c, publicUser(u), memberFacts(c, m), metricOf(c));
}
