import { POST as token } from "../token/route";

export const dynamic = "force-dynamic";

// Muse writes its own copy of the guide's addresses and has bent the token one (/oauth/auth/token, then
// /oauth/oauth/token, on 4 November), failing the Connect each time: any address under /oauth ending in /token
// answers as the token step.
export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if ((await params).path.at(-1) === "token") return token(req);
  return new Response(null, { status: 404 });
}
