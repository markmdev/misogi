import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MuseMessage } from "@/components/client/connect";
import { Mascot } from "@/components/ui";
import { currentUser, publicOrigin } from "@/lib/server/auth";
import { myChallenges } from "@/lib/server/domain/challenges";
import { rateLimit } from "@/lib/server/http";
import { authorize, connectCode, connectCodeOwner } from "@/lib/server/oauth";

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
  if (!owner || owner.used) return <OldLink title={owner?.used ? "This link was already used" : "This link has run out"} />;
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

// Muse keeps the Misogi connector it made before and reopens its link, even when it's sent a new message, so the way
// out is to remove that connector first. A signed-in person gets their current message right here.
async function OldLink({ title }: { title: string }) {
  const [user, origin] = await Promise.all([currentUser(), publicOrigin()]);
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-5 py-10">
      <div className="flex flex-col items-center text-center">
        <Mascot pose="wave" size={96} />
        <h1 className="mt-2 text-[26px] leading-8 text-ink">{title}</h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-2">Your Muse used an old Misogi link.</p>
      </div>
      <ol className="mt-5 flex list-decimal flex-col gap-3 pl-5 text-[15px] leading-6 text-ink-2 marker:font-bold marker:text-ink">
        <li>
          In Muse, open <b>Settings</b>, then <b>Connectors</b>, find <b>Misogi</b> and tap <b>Disconnect</b>.
        </li>
        <li>
          {user ? (
            <>
              Paste this into a new Muse chat:
              <div className="mt-2">
                <MuseMessage origin={origin} title={myChallenges(user.id)[0]?.title} connectCode={connectCode(user)} />
              </div>
            </>
          ) : (
            <>
              Open your climb on Misogi, copy the message under <b>Your AI</b> and paste it into a new Muse chat.
            </>
          )}
        </li>
        <li>
          When Muse asks, tap <b>Always allow</b>, then <b>Connect</b> on its card, and <b>Connect</b> again in the window it opens.
        </li>
      </ol>
      <a href={user ? "https://muse.ai" : "/"} target={user ? "_blank" : undefined} rel="noreferrer" className="btn mt-6 self-center">
        {user ? "Open Muse" : "Open Misogi"}
      </a>
    </main>
  );
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
