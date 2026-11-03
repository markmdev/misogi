import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { makeSessionValue, redeemSignInToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";
import { originOf } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/signin/[token]">) {
  const { token } = await ctx.params;
  const userId = redeemSignInToken(token);
  const origin = originOf(req);
  if (!userId) return NextResponse.redirect(`${origin}/signin-expired`);
  const res = NextResponse.redirect(`${origin}/me`);
  res.cookies.set(SESSION_COOKIE, makeSessionValue(userId), sessionCookieOptions);
  return res;
}
