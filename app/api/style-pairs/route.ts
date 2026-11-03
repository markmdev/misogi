import { FALLBACK_PAIRS, stylePairs } from "@/lib/server/ai/draft";
import { clientIp, json, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Example check-ins in two styles, so a new climber can pick what motivates them. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  try {
    rateLimit(`pairs:${clientIp(req)}`, 6, 4);
    const pairs = await stylePairs(String(body.title ?? "a hard challenge"), clientIp(req));
    return json({ pairs, fallback: false });
  } catch {
    return json({ pairs: FALLBACK_PAIRS, fallback: true });
  }
}
