import type { NextRequest } from "next/server";
import { searchCities } from "@/lib/server/cities";
import { clientIp, errorJson, json, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Cities matching what someone has typed so far, for the city picker. */
export async function GET(req: NextRequest) {
  try {
    rateLimit(`cities:${clientIp(req)}`, 120, 30);
    const q = req.nextUrl.searchParams.get("q") ?? "";
    return json({ cities: q.trim().length >= 2 ? searchCities(q, 4) : [] });
  } catch (e) {
    return errorJson(e);
  }
}
