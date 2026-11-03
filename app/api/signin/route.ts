import { NextResponse } from "next/server";
import { makeSessionValue, redeemSignInToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";
import { clientIp, originOf, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Redeems a one-time sign-in token (POST only, so link previews can't use it up). */
export async function POST(req: Request) {
  const origin = originOf(req);
  try {
    rateLimit(`signin:${clientIp(req)}`, 10, 10);
  } catch {
    return NextResponse.redirect(`${origin}/signin-expired`, 303);
  }
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const userId = token ? redeemSignInToken(token) : null;
  if (!userId) return NextResponse.redirect(`${origin}/signin-expired`, 303);
  const res = NextResponse.redirect(`${origin}/me`, 303);
  res.cookies.set(SESSION_COOKIE, makeSessionValue(userId), sessionCookieOptions);
  return res;
}
