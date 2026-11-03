import { db } from "@/lib/server/db";
import { provider } from "@/lib/server/ai/client";

export const dynamic = "force-dynamic";

export function GET() {
  const row = db().prepare("SELECT COUNT(*) AS n FROM challenges").get() as { n: number };
  return Response.json({ ok: true, challenges: row.n, ai: provider() }, { headers: { "Cache-Control": "no-store" } });
}
