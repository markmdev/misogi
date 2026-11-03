import type { Metadata } from "next";
import Link from "next/link";
import { ConnectPanel } from "@/components/client/connect";
import { Footer, TopBar } from "@/components/nav";
import { Mascot } from "@/components/ui";
import { currentUser, publicOrigin } from "@/lib/server/auth";
import { myChallenges } from "@/lib/server/domain/challenges";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect your AI" };

export default async function Connect() {
  const user = await currentUser();
  const origin = await publicOrigin();
  const first = user ? myChallenges(user.id)[0] : null;
  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-xl px-4 pt-10">
        <div className="flex flex-col items-center text-center">
          <Mascot pose="wave" size={110} />
          <h1 className="mt-2 text-[30px] leading-9 text-ink">Bring your own AI</h1>
          <p className="mt-2 text-[16px] leading-6 text-ink-2">
            Your AI already knows your week. Connect it once and it plans with you, checks in, logs what you did and keeps your page up to date.
          </p>
        </div>
        <div className="mt-8">
          {user ? (
            <ConnectPanel
              origin={origin}
              slug={first?.slug ?? null}
              title={first?.title}
              initialStatus={{ agent_kind: user.agent_kind, agent_name: user.agent_name, agent_seen_at: user.agent_seen_at }}
            />
          ) : (
            <div className="card flex flex-col items-center p-6 text-center">
              <p className="text-[15px] leading-6 text-ink-2">Start a challenge first. Then you&apos;ll get a key for your AI.</p>
              <Link href="/start" className="btn mt-4">
                Start yours
              </Link>
              <p className="mt-4 text-[13px] text-ink-3">
                Building an agent? Read the <Link href="/agent.md" className="underline">agent guide</Link>.
              </p>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
