import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export function GET() {
  const row = db().prepare("SELECT COUNT(*) AS n FROM challenges").get() as { n: number };
  return Response.json({ ok: true, challenges: row.n }, { headers: { "Cache-Control": "no-store" } });
}
