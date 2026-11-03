import { clientIp, json, rateLimit } from "@/lib/server/http";
import { OAuthError, registerClient } from "@/lib/server/oauth";
import { AppError } from "@/lib/server/util";

export const dynamic = "force-dynamic";

/** Dynamic client registration (RFC 7591), so an agent connects without anyone registering an app. */
export async function POST(req: Request) {
  try {
    rateLimit(`oauth-register:${clientIp(req)}`, 10, 20);
    const text = await req.text();
    if (text.length > 16_000) throw new OAuthError("invalid_client_metadata", "Client metadata is too large.");
    const body = (() => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    })();
    if (!body || typeof body !== "object") throw new OAuthError("invalid_client_metadata", "Send the client metadata as JSON.");
    return json(registerClient(body as Record<string, unknown>), { status: 201 });
  } catch (e) {
    if (e instanceof OAuthError) return e.json();
    if (e instanceof AppError) return json({ error: "temporarily_unavailable", error_description: e.message }, { status: e.status });
    throw e;
  }
}
