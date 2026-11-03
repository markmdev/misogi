import Link from "next/link";
import { ActivityRow, ChallengeCard } from "@/components/challenge";
import { LiveScene } from "@/components/client/alive";
import { StartBox } from "@/components/client/start-box";
import { Footer, TopBar } from "@/components/nav";
import { cx, Icon, Mascot } from "@/components/ui";
import { currentUser } from "@/lib/server/auth";
import { listChallenges } from "@/lib/server/domain/challenges";
import { siteFeed } from "@/lib/server/domain/feed";
import { showcaseView } from "@/lib/server/views";
import { firstName, foldRepeats } from "@/lib/shared/format";
import { SCENES } from "@/lib/shared/art";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    pose: "think",
    title: "Say it in one line",
    body: "Misogi drafts your year: the camps to reach, this week's quests, and how you'll measure it.",
  },
  {
    pose: "climb",
    title: "Bring your own AI",
    body: "Connect Muse or any agent. It checks in, logs what you did, and rebuilds your page as you talk.",
  },
  {
    pose: "cheer",
    title: "Climb together",
    body: "Anyone can join your challenge. Same summit, their own path, one leaderboard.",
  },
];

/** Meta's models behind Misogi, named once in plain words; each moment on the site credits the one that made it. */
const MODELS = [
  { name: "Muse Spark", does: "drafts your year from one line.", icon: "sparkles" },
  { name: "Muse Wonder", does: "builds your page from one message.", icon: "paintbrush" },
  { name: "Muse Image", does: "draws each challenge's cover and its Virgil.", icon: "art" },
];

export default async function Home() {
  const user = await currentUser();
  const live = listChallenges({ status: ["active"], limit: 6 });
  const templates = listChallenges({ status: ["template"], limit: 12 });
  const feed = siteFeed(8);
  const hero = SCENES["home-hero"];
  const proof = showcaseView();

  return (
    <>
      <TopBar user={user} />
      <main>
        {/* Hero: an illustrated scene with a rounded sheet rising over it. */}
        <section className="relative">
          <div className="relative h-[300px] overflow-hidden sm:h-[420px] lg:h-[480px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hero.src}
              srcSet={`${hero.sm} 800w, ${hero.src} 1600w`}
              sizes="100vw"
              alt="A calm mountain at sunrise with a trail of camps leading to the summit"
              className="absolute inset-0 h-full w-full object-cover object-[50%_35%]"
            />
            <LiveScene name="home-hero" className="absolute inset-0 h-full w-full object-cover object-[50%_35%]" />
            <div className="absolute inset-x-0 bottom-0 h-40 sm:h-56" style={{ background: "linear-gradient(to bottom, transparent, var(--color-cream) 92%)" }} />
          </div>
          <div className="relative mx-auto -mt-24 max-w-2xl px-4 max-[239px]:px-2 sm:-mt-32">
            <div className="relative rounded-[32px] bg-cream px-5 pt-14 pb-7 max-[239px]:px-3 shadow-[var(--shadow-float)] ring-1 ring-line sm:px-10 sm:pb-9">
              <h1 className="text-center text-[34px] leading-[40px] text-ink sm:text-[46px] sm:leading-[52px]">One hard thing this year.</h1>
              <p className="mx-auto mt-3 max-w-lg text-center font-display text-[19px] leading-[26px] font-semibold text-ink sm:text-[21px] sm:leading-7">
                Misogi turns your{" "}
                <span className="whitespace-nowrap">
                  <Icon name="orb" size={36} className="-my-2 -mr-1 -ml-1.5 inline-block align-middle" />
                  Muse
                </span>{" "}
                into the world&apos;s best coach, tutor, mentor.
              </p>
              <p className="mx-auto mt-2 max-w-md text-center text-[15px] leading-6 text-ink-2 sm:text-[16px]">
                Say your goal in a line. Muse plans the year, checks in, and keeps your page up to date.
              </p>
              <StartBox />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="card relative overflow-hidden p-5 pt-4">
                <div className="flex items-start justify-between">
                  <span className="font-display text-[15px] font-semibold text-ink-3">0{i + 1}</span>
                  <Mascot pose={s.pose} size={84} alt="" />
                </div>
                <h3 className="mt-1 text-[20px] leading-7 text-ink">{s.title}</h3>
                <p className="mt-1.5 text-[15px] leading-6 text-ink-2">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Live challenges + feed */}
        {live.length > 0 && (
          <section className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[26px] leading-8 text-ink">On the mountain now</h2>
                <p className="mt-1 text-[15px] text-ink-2">Open to join. The early climbers are demo profiles.</p>
              </div>
              <Link href="/explore" className="btn btn-ghost btn-sm">
                See all
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="grid gap-4 sm:grid-cols-2">
                {live.map((c) => (
                  <ChallengeCard key={c.slug} c={c} />
                ))}
              </div>
              {feed.length > 0 && (
                <aside className="card h-fit p-4 pb-2">
                  <h3 className="flex items-center gap-2 text-[17px] text-ink">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-moss opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-moss" />
                    </span>
                    Just now
                  </h3>
                  <ul className="divide-y divide-line">
                    {foldRepeats(feed).map(({ a, times }) => (
                      <ActivityRow key={a.id} a={a} times={times} />
                    ))}
                  </ul>
                </aside>
              )}
            </div>
          </section>
        )}

        {/* Your Muse does the work */}
        <section className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
          <div className={cx("card grid grid-cols-[minmax(0,1fr)] items-center gap-8 overflow-hidden p-6 max-[239px]:p-4 sm:p-10", proof && "lg:grid-cols-2")}>
            <div>
              <h2 className="text-[26px] leading-8 text-ink">Your Muse already knows you. Now it&apos;s your guide.</h2>
              <p className="mt-3 text-[16px] leading-7 text-ink-2">
                Connect Meta&apos;s Muse with one message. It reads your plan, checks in when you go quiet, logs what you tell it, and
                redesigns your page when you ask. No Muse? Virgil, Misogi&apos;s own guide, does the same right here.
              </p>
              <ul className="mt-5 flex flex-col gap-2.5">
                {MODELS.map((m) => (
                  <li key={m.name} className="flex items-center gap-3 text-[15px] leading-6 text-ink-2">
                    <Icon name={m.icon} size={30} />
                    <span>
                      <b className="text-ink">{m.name}</b> {m.does}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/start" className="btn">
                  Start yours
                </Link>
                <Link href="/agent.md" className="btn btn-ghost">
                  Agent guide
                </Link>
              </div>
            </div>
            {proof && (
              <figure className="mx-auto w-full max-w-[420px]">
                <div className="h-[520px] overflow-hidden rounded-[30px] bg-white shadow-[var(--shadow-float)] ring-1 ring-line sm:h-[560px]">
                  <iframe
                    src={proof.page.url}
                    title={`${firstName(proof.name)}'s page`}
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="block h-full w-full border-0"
                  />
                </div>
                <figcaption className="mt-4 px-2 text-center text-[14px] leading-5 text-ink-2">
                  <p>
                    <Link href={proof.href} className="font-extrabold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
                      {firstName(proof.name)}&apos;s page
                    </Link>
                    , built by {proof.page.built_by ?? "AI"} from one message:
                  </p>
                  <p className="mt-1 line-clamp-2 italic">&ldquo;{proof.page.request}&rdquo;</p>
                </figcaption>
              </figure>
            )}
          </div>
        </section>

        {/* Templates: a shelf that runs to the window's edge */}
        {templates.length > 0 && (
          <section className="mt-16">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <h2 className="text-[26px] leading-8 text-ink">Ten years of Zuckerberg&apos;s challenges</h2>
              <p className="mt-1 max-w-2xl text-[15px] leading-6 text-ink-2">
                From 2009 to 2019, Mark Zuckerberg picked one hard thing each year. Start from one of his, or make your own.
              </p>
            </div>
            <div className="scrollbar-none mt-5 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-4 sm:scroll-px-[max(1.5rem,calc((100%-72rem)/2+1.5rem))] sm:px-[max(1.5rem,calc((100%-72rem)/2+1.5rem))]">
              {templates.map((c) => (
                <ChallengeCard key={c.slug} c={c} className="w-[260px] shrink-0 snap-start" />
              ))}
            </div>
          </section>
        )}

        <section className="mx-auto mt-14 max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center rounded-[32px] bg-coral-soft px-6 py-10 text-center">
            <Mascot pose="cheer" size={110} alt="" />
            <h2 className="mt-2 text-[28px] leading-9 text-ink">What&apos;s your misogi?</h2>
            <p className="mt-2 max-w-md text-[16px] text-ink-2">The year goes by either way. Pick the one thing you&apos;ll be glad you did.</p>
            <Link href="/start" className="btn mt-6">
              Plan my year
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
