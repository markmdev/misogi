import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Mascot } from "@/components/ui";
import { rateLimit } from "@/lib/server/http";
import { authorize, connectCodeOwner } from "@/lib/server/oauth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect your Muse" };

type Props = { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The sign-in an agent's connect card opens. The code from the person's Connect message connects their account at once. */
export default async function Authorize({ params, searchParams }: Props) {
  const [{ code }, sp, h] = await Promise.all([params, searchParams, headers()]);
  try {
    rateLimit(`oauth-authorize:${(h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local"}`, 20, 20);
  } catch {
    return <Notice title="Too many tries" body="Wait a minute, then tap Connect in Muse again." />;
  }
  const owner = connectCodeOwner(code);
  if (!owner || owner.used) {
    return (
      <Notice
        title={owner?.used ? "This link was already used" : "This link has run out"}
        body="Open your climb on Misogi, copy the message under Your AI again and send it to Muse. It connects from there."
      />
    );
  }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  let to: string;
  try {
    to = authorize(q, owner.user);
  } catch (e) {
    return <Notice title="This link can't connect" body={(e as Error).message} />;
  }
  redirect(to);
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center px-5 text-center">
      <Mascot pose="wave" size={110} />
      <h1 className="mt-2 text-[26px] leading-8 text-ink">{title}</h1>
      <p className="mt-2 text-[15px] leading-6 text-ink-2">{body}</p>
      <Link href="/" className="btn mt-6">
        Open Misogi
      </Link>
    </main>
  );
}
