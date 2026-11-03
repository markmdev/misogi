import { json } from "@/lib/server/http";
import { exchangeCode, OAuthError } from "@/lib/server/oauth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    return json(exchangeCode(new URLSearchParams(await req.text())));
  } catch (e) {
    if (e instanceof OAuthError) return e.json();
    throw e;
  }
}
