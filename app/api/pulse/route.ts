import { findChallenge } from "@/lib/server/domain/challenges";
import { json } from "@/lib/server/http";
import { pulse } from "@/lib/server/views";
import { listActivity } from "@/lib/server/domain/feed";
import { activityText, agentLabel, firstName } from "@/lib/shared/format";

export const dynamic = "force-dynamic";

/** Live-update fingerprint for a challenge page. */
export function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("c") ?? "";
  const c = findChallenge(slug);
  if (!c) return json({ stamp: null }, { status: 404 });
  const a = listActivity({ challengeId: c.id, limit: 1 })[0];
  const latest = a
    ? {
        id: a.id,
        text: `${a.user ? firstName(a.user.display_name) : "Someone"} ${activityText(a)}`,
        via: a.user && a.user.agent_kind && a.user.agent_kind !== "web" ? agentLabel(a.user.agent_kind, a.user.agent_name) : null,
        at: a.created_at,
      }
    : null;
  return json({ stamp: pulse(c), latest });
}
