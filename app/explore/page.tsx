import type { Metadata } from "next";
import Link from "next/link";
import { ChallengeCard } from "@/components/challenge";
import { Footer, Recede, TopBar } from "@/components/nav";
import { cx, EmptyState, Icon } from "@/components/ui";
import { currentUser } from "@/lib/server/auth";
import { listChallenges } from "@/lib/server/domain/challenges";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore challenges" };

const FILTERS = [
  { id: "", label: "All", icon: "compass" },
  { id: "language", label: "Languages", icon: "language" },
  { id: "reading", label: "Reading", icon: "books" },
  { id: "making", label: "Building", icon: "smarthome" },
  { id: "fitness", label: "Fitness", icon: "running" },
  { id: "writing", label: "Writing", icon: "writing" },
  { id: "music", label: "Music", icon: "music" },
  { id: "travel", label: "Travel", icon: "travel" },
  { id: "mindful", label: "Mindful", icon: "mindful" },
  { id: "money", label: "Money", icon: "money" },
  { id: "cooking", label: "Cooking", icon: "cooking" },
  { id: "social", label: "Together", icon: "handshake" },
];

export default async function Explore(props: PageProps<"/explore">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60) : "";
  const cat = typeof sp.cat === "string" ? sp.cat : "";
  const user = await currentUser();
  const query = q || cat || undefined;
  const live = listChallenges({ status: ["active"], query, limit: 60 });
  const templates = listChallenges({ status: ["template"], query, limit: 20 });

  return (
    <>
      <TopBar user={user} />
      <Recede>
        <main className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-[32px] leading-10 text-ink">Find your climb</h1>
              <p className="mt-1 text-[16px] text-ink-2">Join a challenge in progress, or start from one of Zuckerberg&apos;s.</p>
            </div>
            <form className="flex w-full gap-2 sm:w-[340px]" action="/explore">
              <input name="q" defaultValue={q} className="input !h-12" placeholder="Search challenges" aria-label="Search challenges" />
              <button className="btn btn-ink !h-12 shrink-0 !px-4" aria-label="Search">
                Go
              </button>
            </form>
          </div>
          <div className="scrollbar-none -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {FILTERS.map((f) => (
              <Link
                key={f.id}
                href={f.id ? `/explore?cat=${f.id}` : "/explore"}
                className={cx("chip shrink-0", (cat === f.id && !q) && "!bg-ink !text-white !shadow-none")}
              >
                <Icon name={f.icon} size={22} />
                {f.label}
              </Link>
            ))}
          </div>

          <section className="mt-8">
            <h2 className="mb-4 text-[22px] text-ink">Live now</h2>
            {live.length ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {live.map((c) => (
                  <ChallengeCard key={c.slug} c={c} dense />
                ))}
              </div>
            ) : (
              <EmptyState pose="think" title="Nothing matches yet" body="Be the first. Start it and others can join." action={<Link href={`/start${q ? `?idea=${encodeURIComponent(q)}` : ""}`} className="btn">Start it</Link>} />
            )}
          </section>

          {templates.length > 0 && (
            <section className="mt-12">
              <h2 className="text-[22px] text-ink">Zuckerberg&apos;s yearly challenges</h2>
              <p className="mt-1 mb-4 text-[15px] text-ink-2">One hard thing a year, 2009 to 2019. Make one yours.</p>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {templates.map((c) => (
                  <ChallengeCard key={c.slug} c={c} dense />
                ))}
              </div>
            </section>
          )}
        </main>
      </Recede>
      <Footer />
    </>
  );
}
