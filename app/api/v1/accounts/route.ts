import { createApiKey, createSignInToken } from "@/lib/server/auth";
import { createUser } from "@/lib/server/domain/users";
import { clientIp, errorJson, json, originOf, rateLimit } from "@/lib/server/http";
import { AppError } from "@/lib/server/util";

export const dynamic = "force-dynamic";

/**
 * Creates a Misogi account and returns its key, so an agent can sign its person up
 * without them visiting the site. The sign-in link lets the person open their page later.
 */
export async function POST(req: Request) {
  try {
    rateLimit(`signup:${clientIp(req)}`, 2, 10);
    const body = ((await req.json().catch(() => null)) ?? {}) as { display_name?: unknown; timezone?: unknown; motivation_style?: unknown };
    if (typeof body.display_name !== "string" || !body.display_name.trim()) throw new AppError("invalid", "display_name is required.");
    const user = createUser({
      display_name: body.display_name,
      timezone: typeof body.timezone === "string" ? body.timezone : undefined,
      motivation_style: typeof body.motivation_style === "string" ? body.motivation_style : undefined,
    });
    const { key } = createApiKey(user.id);
    const origin = originOf(req);
    return json(
      {
        key,
        handle: user.handle,
        sign_in_url: `${origin}/signin/${createSignInToken(user.id, 60 * 24)}`,
        next: "Save the key privately, then call create_challenge. Give the person the sign_in_url so they can open their page (valid 24 hours).",
      },
      { status: 201 },
    );
  } catch (e) {
    return errorJson(e);
  }
}
