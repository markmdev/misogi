import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MyCity } from "@/components/client/city-picker";
import { Footer, TopBar } from "@/components/nav";
import { Avatar, Icon, IconTile, Pill, ProgressBar } from "@/components/ui";
import { currentUser } from "@/lib/server/auth";
import { getChallenge, getMembership, myChallenges } from "@/lib/server/domain/challenges";
import { memberFacts } from "@/lib/server/domain/progress";
import { getUserByHandle } from "@/lib/server/domain/users";
import { cityByKey, cityLabel } from "@/lib/server/cities";
import { agentLabel, firstName, withUnit } from "@/lib/shared/format";
import { palette } from "@/lib/shared/theme";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/u/[handle]">): Promise<Metadata> {
  const { handle } = await props.params;
  const u = getUserByHandle(handle);
  return { title: u ? u.display_name : "Not found" };
}

export default async function Profile(props: PageProps<"/u/[handle]">) {
  const { handle } = await props.params;
  const u = getUserByHandle(handle);
  if (!u) notFound();
  const viewer = await currentUser();
  const climbs = myChallenges(u.id)
    .filter((c) => c.status !== "draft")
    .map((c) => {
      const ch = getChallenge(c.slug);
      return { c, facts: memberFacts(ch, getMembership(ch.id, u.id)!) };
    });
  const mine = viewer?.id === u.id;
  const city = mine ? cityByKey(u.city) : null;
  const guide = agentLabel(u.agent_kind, u.agent_name, viewer?.id === u.id ? "your" : `${firstName(u.display_name)}'s`);
  return (
    <>
      <TopBar user={viewer} />
      <main className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <Avatar name={u.display_name} color={u.avatar} size={88} />
          <h1 className="mt-3 text-[28px] leading-9 text-ink">{u.display_name}</h1>
          <p className="text-[15px] text-ink-3">@{u.handle}</p>
          {guide && (
            <Pill tone="white" className="mt-3">
              <Icon name="orb" size={18} /> Guided by {guide}
            </Pill>
          )}
        </div>
        {mine && <MyCity initial={city ? { key: city.key, label: cityLabel(city, true) } : null} />}
        <div className="mt-8 flex flex-col gap-3">
          {climbs.map(({ c, facts }) => {
            const pal = palette(c.theme);
            return (
              <Link key={c.slug} href={`/c/${c.slug}/${u.handle}`} className="card flex items-center gap-4 p-4 transition hover:-translate-y-0.5">
                <IconTile name={c.emoji} size={52} bg={pal.tint} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[17px] font-semibold text-ink">{c.title}</div>
                  {facts.progress != null && <ProgressBar value={facts.progress} color={pal.accent} height={8} className="mt-2" />}
                </div>
                <div className="text-right text-[13px] font-extrabold text-ink-2">
                  <div>{withUnit(facts.total, c.metric.unit)}</div>
                  <div className="flex items-center justify-end gap-0.5 text-flame">
                    <Icon name="streak" size={16} />
                    {facts.streak}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}
