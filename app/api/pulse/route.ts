import { findChallenge } from "@/lib/server/domain/challenges";
import { json } from "@/lib/server/http";
import { pulse } from "@/lib/server/views";

export const dynamic = "force-dynamic";

/** Live-update fingerprint for a challenge page. */
export function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("c") ?? "";
  const c = findChallenge(slug);
  if (!c) return json({ stamp: null }, { status: 404 });
  return json({ stamp: pulse(c) });
}
