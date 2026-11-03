import { draftChallenge } from "@/lib/server/ai/draft";
import { clientIp, errorJson, json, rateLimit } from "@/lib/server/http";
import { AppError, dateIn, isValidTimeZone } from "@/lib/server/util";

export const dynamic = "force-dynamic";

/** One line in, a drafted year out. Used by the start flow before an account exists. */
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    rateLimit(`draft:${ip}`, 6, 4);
    const body = (await req.json().catch(() => ({}))) as { idea?: string; timezone?: string };
    const idea = String(body.idea ?? "").trim();
    if (idea.length < 3) throw new AppError("invalid", "Tell us your misogi in a few words.");
    const tz = body.timezone && isValidTimeZone(body.timezone) ? body.timezone : "UTC";
    const draft = await draftChallenge(idea, dateIn(tz), ip);
    return json({ draft });
  } catch (e) {
    return errorJson(e);
  }
}
