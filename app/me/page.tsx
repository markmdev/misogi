import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { ConnectPanel } from "@/components/client/connect";
import { Virgil } from "@/components/client/virgil";
import { Footer, TopBar } from "@/components/nav";
import { Avatar, EmptyState, Icon, IconTile, ProgressBar } from "@/components/ui";
import { currentUser, keyStatus, publicOrigin } from "@/lib/server/auth";
import { getChallenge, getMembership, myChallenges } from "@/lib/server/domain/challenges";
import { memberFacts } from "@/lib/server/domain/progress";
import { firstName, withUnit } from "@/lib/shared/format";
import { palette } from "@/lib/shared/theme";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My climbs" };

export default async function Me() {
  const user = await currentUser();
  if (!user) redirect("/start");
  const mine = myChallenges(user.id).map((c) => {
    const ch = getChallenge(c.slug);
    const facts = memberFacts(ch, getMembership(ch.id, user.id)!);
    return { c, facts };
  });
  const origin = await publicOrigin();

  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={user.display_name} color={user.avatar} size={60} />
            <div>
              <h1 className="text-[28px] leading-9 text-ink">Hi, {firstName(user.display_name)}</h1>
              <p className="text-[15px] text-ink-2">@{user.handle}</p>
            </div>
          </div>
          <form action={signOutAction}>
            <button className="btn btn-ghost btn-sm">Sign out</button>
          </form>
        </div>

        <section className="mt-8">
          <h2 className="mb-4 text-[22px] text-ink">Your climbs</h2>
          {mine.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {mine.map(({ c, facts }) => {
                const pal = palette(c.theme);
                return (
                  <Link key={c.slug} href={`/c/${c.slug}/${user.handle}`} className="card group flex flex-col gap-4 p-5 transition hover:-translate-y-0.5">
                    <div className="flex items-center gap-3">
                      <IconTile name={c.emoji} size={52} bg={pal.tint} />
                      <div className="min-w-0">
                        <div className="truncate font-display text-[18px] font-semibold text-ink">{c.title}</div>
                        <div className="text-[13px] font-bold text-ink-3">
                          Day {facts.day} · {c.members} climbing
                        </div>
                      </div>
                    </div>
                    {facts.progress != null ? (
                      <ProgressBar value={facts.progress} color={pal.accent} height={12} />
                    ) : null}
                    <div className="flex items-center gap-4 text-[13px] font-extrabold text-ink-2">
                      <span className="flex items-center gap-1">
                        <Icon name="streak" size={18} />
                        {facts.streak}
                      </span>
                      <span className="flex items-center gap-1">
                        <Icon name="xp" size={18} />
                        Lv {facts.level}
                      </span>
                      <span>
                        {withUnit(facts.total, c.metric.unit)}
                        {facts.target != null ? ` / ${withUnit(facts.target, c.metric.unit)}` : ""}
                      </span>
                      {facts.open_quests > 0 && <span className="ml-auto text-ink-3">{facts.open_quests} quests</span>}
                    </div>
                  </Link>
                );
              })}
              <Link href="/start" className="card flex min-h-[150px] flex-col items-center justify-center gap-2 border-dashed p-5 text-center text-ink-2 hover:text-ink">
                <Icon name="flag" size={44} />
                <span className="font-display text-[17px] font-semibold">Start another</span>
              </Link>
            </div>
          ) : (
            <EmptyState pose="wave" title="No climbs yet" body="Pick one hard thing for this year." action={<Link href="/start" className="btn">Start yours</Link>} />
          )}
        </section>

        <section className="mt-10 max-w-xl">
          <h2 className="mb-4 text-[22px] text-ink">Your AI</h2>
          <div className="card p-4">
            <ConnectPanel
              origin={origin}
              slug={mine[0]?.c.slug ?? null}
              title={mine[0]?.c.title}
              initialStatus={{ agent_kind: user.agent_kind, agent_name: user.agent_name, agent_seen_at: user.agent_seen_at }}
              hasKey={keyStatus(user.id).has_key}
            />
          </div>
        </section>
      </main>
      <Footer />
      <Virgil signedIn />
    </>
  );
}
