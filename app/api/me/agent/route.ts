import { currentUser, keyStatus } from "@/lib/server/auth";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Whether the signed-in person's AI has connected yet. */
export async function GET() {
  const u = await currentUser();
  if (!u) return json({ signed_in: false });
  const k = keyStatus(u.id);
  return json({
    signed_in: true,
    agent_kind: u.agent_kind,
    agent_name: u.agent_name,
    agent_seen_at: u.agent_seen_at,
    key_last_used_at: k.last_used_at,
  });
}
