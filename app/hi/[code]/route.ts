// The link in a Connect message: the agent guide, written for the person whose code it carries.
import { agentGuide } from "@/lib/server/agent-guide";
import { myChallenges } from "@/lib/server/domain/challenges";
import { originOf } from "@/lib/server/http";
import { connectCodeOwner } from "@/lib/server/oauth";

export const dynamic = "force-dynamic";

const markdown = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(req: Request, ctx: RouteContext<"/hi/[code]">) {
  const { code } = await ctx.params;
  const origin = originOf(req);
  const owner = connectCodeOwner(code);
  if (!owner) return markdown(`# This Misogi link isn't valid\n\nAsk the person to copy the message again from their Connect page on ${origin}.\n`, 404);
  const { user, used } = owner;
  const challenges = myChallenges(user.id)
    .filter((c) => c.status !== "draft")
    .map((c) => ({ slug: c.slug, title: c.title }));
  return markdown(agentGuide(origin, { name: user.display_name, handle: user.handle, code, used, challenges }));
}
