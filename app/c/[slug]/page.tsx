import type { Metadata } from "next";
import Link from "next/link";
import { ViewTransition } from "react";
import { notFound } from "next/navigation";
import { ActivityRow, Leaderboard, sceneFor, sceneName } from "@/components/challenge";
import { LiveCover, LiveScene } from "@/components/client/alive";
import { JoinButton, ShareButton } from "@/components/client/actions";
import { LivePulse } from "@/components/client/live";
import { SpaceFrame } from "@/components/client/space-frame";
import { Virgil } from "@/components/client/virgil";
import { Footer, TopBar } from "@/components/nav";
import { Avatar, EmptyState, Icon, IconTile, Mascot, Pill, ProgressBar, Ring, SectionTitle } from "@/components/ui";
import { currentUser } from "@/lib/server/auth";
import { coverUrl, findChallenge, virgilUrl } from "@/lib/server/domain/challenges";
import { challengeView, pulse } from "@/lib/server/views";
import { firstName, foldRepeats, metricLine, shortDate, timeAgo, withUnit } from "@/lib/shared/format";
import { coverLoop } from "@/lib/shared/art";
import { palette } from "@/lib/shared/theme";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const c = findChallenge(slug);
  if (!c || c.status === "draft") return { title: "Misogi" };
  return { title: c.title, description: c.tagline || `A year-long challenge on Misogi: ${c.title}.` };
}

const HOW: Record<string, string> = {
  sum: "Each log adds its number to your total.",
  count: "Each log counts as one done.",
  days: "Every day you log counts once.",
  distinct: "Each different one you log counts once.",
  latest: "Your newest number is your level.",
};

export default async function ChallengePage(props: PageProps<"/c/[slug]">) {
  const { slug } = await props.params;
  const viewer = await currentUser();
  const v = challengeView(slug, viewer);
  if (!v) notFound();
  const { c, summary, board, feed, space, metric, creator, isMember, myFacts, membership } = v;
  const pal = palette(c.theme);
  const isTemplate = c.status === "template";
  const top = board.slice(0, 10);
  const stamp = pulse(c);

  const cover = coverUrl(c);
  const loop = coverLoop(cover);
  const details = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {isTemplate ? (
          <Pill tone="gold">
            {c.template_label} · {c.template_year}
          </Pill>
        ) : (
          <Pill style={{ background: pal.tint, color: pal.deep }}>{metricLine(metric)}</Pill>
        )}
        {!isTemplate && summary.active_this_week > 0 && (
          <Pill tone="moss">
            <span className="h-2 w-2 rounded-full bg-moss" />
            {summary.active_this_week} active this week
          </Pill>
        )}
      </div>
      <h1 className="col-span-2 mt-4 text-[28px] leading-[34px] text-ink sm:mt-2 sm:text-[36px] sm:leading-[42px]">{c.title}</h1>
      {c.tagline && <p className="col-span-2 mt-1.5 max-w-2xl text-[16px] leading-6 text-ink-2">{c.tagline}</p>}
      {!isTemplate && (
        <div className="col-span-2 mt-3 flex flex-wrap items-center gap-3 text-[14px] font-bold text-ink-2">
          <div className="flex -space-x-1">
            {board.slice(0, 5).map((s) => (
              <Avatar key={s.handle} name={s.display_name} color={s.avatar} size={32} ring />
            ))}
          </div>
          <span>
            {summary.members} climbing{creator ? ` · started by ${firstName(creator.display_name)}` : ""}
          </span>
        </div>
      )}
    </>
  );
  const actions = (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {isTemplate ? (
        <Link href={`/start?idea=${encodeURIComponent(c.title)}`} className="btn grow sm:grow-0">
          <Icon name="flag" size={24} />
          Start this challenge
        </Link>
      ) : isMember ? (
        <Link href={`/c/${c.slug}/${viewer!.handle}`} className="btn btn-moss grow sm:grow-0">
          <Icon name="backpack" size={24} />
          My climb
        </Link>
      ) : (
        <JoinButton slug={c.slug} signedIn={!!viewer} title={c.title} className="grow sm:grow-0" />
      )}
      <ShareButton url={`/c/${c.slug}`} text={`${c.title} · climb it with me on Misogi`} className="grow sm:grow-0" />
    </div>
  );

  return (
    <div style={{ background: pal.tint, ["--accent" as string]: pal.accent }} className="min-h-dvh">
      <TopBar user={viewer} />
      {!isTemplate && <LivePulse slug={c.slug} stamp={stamp} />}

      {/* Hero scene */}
      <section className="relative">
        <div className="relative h-[230px] overflow-hidden sm:h-[300px]" style={{ background: pal.sky }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sceneFor(c.theme, false)} alt="" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover object-[65%_center]" />
          <LiveScene name={sceneName(c.theme)} className="absolute inset-0 h-full w-full object-cover object-[65%_center]" />
          <div className="absolute inset-x-0 bottom-0 h-28 sm:h-36" style={{ background: `linear-gradient(to bottom, transparent, ${pal.tint} 92%)` }} />
        </div>
        <div className="relative mx-auto -mt-20 max-w-6xl px-4 sm:-mt-24 sm:px-6">
          {c.virgil_path && (
            <div className="pointer-events-none absolute right-8 bottom-full z-10 -mb-2 flex items-end gap-1 sm:right-14">
              <span className="mb-4 rounded-full bg-white/85 px-2.5 py-1 text-[12px] font-bold text-ink-2 shadow-sm">Dressed by Muse Image</span>
              <Mascot src={virgilUrl(c)} size={112} eager className="drop-shadow-[0_6px_6px_rgb(46_42_38/0.18)]" alt={`Virgil, dressed for ${c.title}`} />
            </div>
          )}
          {cover ? (
            <div className="card flex flex-col gap-5 p-4 sm:p-5 md:flex-row md:gap-7">
              <ViewTransition name={`cover-${c.slug}`} share="morph" default="none">
                <div className="relative aspect-[3/2] w-full shrink-0 overflow-hidden rounded-[20px] md:w-[300px] md:self-center lg:w-[360px]" style={{ background: pal.sky }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  {loop && <LiveCover stem={loop} className="absolute inset-0 h-full w-full object-cover" />}
                  <div className="absolute bottom-3 left-3">
                    <IconTile name={c.emoji} size={52} bg="rgb(255 255 255 / 0.92)" className="shadow-sm" eager />
                  </div>
                </div>
              </ViewTransition>
              <div className="flex min-w-0 flex-1 flex-col gap-5 px-1 pb-1 md:px-0 md:py-2 md:pr-2">
                <div>{details}</div>
                <div className="md:mt-auto">{actions}</div>
              </div>
            </div>
          ) : (
            <div className="card flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 sm:flex sm:items-start">
                <IconTile name={c.emoji} size={76} bg={pal.tint} className="shadow-[0_4px_0_rgb(0_0_0/0.06)]" eager />
                <div className="contents sm:block sm:min-w-0">{details}</div>
              </div>
              {actions}
            </div>
          )}
        </div>
      </section>

      <main className="mx-auto mt-6 grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-8">
          {/* The viewer's own progress */}
          {isMember && myFacts && membership && (
            <Link href={`/c/${c.slug}/${viewer!.handle}`} className="card group flex items-center gap-4 p-4 transition hover:-translate-y-0.5 sm:p-5">
              <Ring value={myFacts.progress ?? Math.min(1, myFacts.day / myFacts.days_total)} size={78} color={pal.accent}>
                <span className="font-display text-[17px] font-semibold text-ink">
                  {myFacts.progress != null ? `${Math.round(myFacts.progress * 100)}%` : `D${myFacts.day}`}
                </span>
              </Ring>
              <div className="min-w-0 flex-1">
                <div className="label">Your climb</div>
                <div className="mt-0.5 font-display text-[20px] font-semibold text-ink">
                  {withUnit(myFacts.total, metric.unit)}
                  {myFacts.target != null && <span className="text-ink-3"> / {withUnit(myFacts.target, metric.unit)}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-bold text-ink-2">
                  <span className="flex items-center gap-1">
                    <Icon name="streak" size={18} />
                    {myFacts.streak} day streak
                  </span>
                  <span className="flex items-center gap-1">
                    <Icon name="xp" size={18} />
                    Level {myFacts.level}
                  </span>
                  {myFacts.rank && (
                    <span>
                      #{myFacts.rank} of {myFacts.members}
                    </span>
                  )}
                </div>
              </div>
              <span className="hidden text-[14px] font-extrabold text-ink-2 group-hover:text-ink sm:block">Open →</span>
            </Link>
          )}

          {/* Template: suggested camps */}
          {isTemplate && (
            <section>
              <SectionTitle title="How it could go" icon="map" />
              <div className="card prose-misogi p-5 text-[15px] leading-7 text-ink-2">
                {c.description_md ? <TemplateText text={c.description_md} /> : <p>Make it yours: Misogi drafts the camps from your own one-line version.</p>}
              </div>
            </section>
          )}

          {/* The shared space */}
          {!isTemplate && (
            <section>
              <SectionTitle
                title="The challenge page"
                icon="paintbrush"
                action={space.current ? <span className="text-[13px] font-bold whitespace-nowrap text-ink-3">{space.current.built_by ? `Built by ${space.current.built_by}` : "Made by AI"} · {timeAgo(space.current.created_at)}</span> : null}
              />
              <SpaceFrame
                space={space}
                title={`${c.title}: shared page`}
                reloadKey={stamp}
                empty={
                  <EmptyState
                    pose="think"
                    title="No page yet"
                    body={
                      v.isCreator
                        ? "Describe the page you want and your AI builds it. Try: “A trail map of everyone's progress, with this week's top climbers.”"
                        : "The person who started this challenge hasn't asked their AI to build it yet."
                    }
                  />
                }
              />
            </section>
          )}
        </div>

        {/* Side column */}
        <aside className="flex flex-col gap-6">
          {!isTemplate && top.length > 0 && (
            <section>
              <SectionTitle title="Leaderboard" icon="crown" />
              <Leaderboard rows={top} metric={metric} slug={c.slug} highlight={viewer?.handle} accent={pal.accent} />
            </section>
          )}
          {!isTemplate && (
            <section>
              <SectionTitle title="Latest" icon="chat" />
              {feed.length ? (
                <ul className="card divide-y divide-line px-4">
                  {foldRepeats(feed)
                    .slice(0, 10)
                    .map(({ a, times }) => (
                      <ActivityRow key={a.id} a={a} times={times} showChallenge={false} />
                    ))}
                </ul>
              ) : (
                <EmptyState pose="sleep" title="Quiet so far" body="Logs, camps and new climbers show up here." />
              )}
            </section>
          )}
          <section>
            <SectionTitle title="About" icon="compass" />
            <div className="card flex flex-col gap-4 p-5">
              <Row icon="target" label="Goal" value={metric.target != null ? withUnit(metric.target, metric.unit) : metric.name} />
              <Row icon="chart" label="How it counts" value={HOW[metric.aggregation]} />
              <Row icon="calendar" label="Length" value="One year from the day you start" />
              {!isTemplate && <Row icon="flag" label="Started" value={shortDate(c.created_at.slice(0, 10), true)} />}
              {c.description_md && !isTemplate && <p className="border-t border-line pt-4 text-[14px] leading-6 text-ink-2">{c.description_md}</p>}
            </div>
          </section>
          {!isTemplate && board.length > 0 && myFacts?.progress != null && (
            <section className="card p-5">
              <div className="label mb-2">Everyone together</div>
              <ProgressBar value={board.reduce((s, b) => s + (b.progress ?? 0), 0) / board.length} color={pal.accent} height={14} />
              <p className="mt-2 text-[13px] font-bold text-ink-2">Average progress across {board.length} climbers</p>
            </section>
          )}
        </aside>
      </main>
      <Footer />
      <Virgil signedIn={!!viewer} challenge={isMember ? c.slug : undefined} look={virgilUrl(c)} />
    </div>
  );
}

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <IconTile name={icon} size={38} />
      <div className="min-w-0">
        <div className="label">{label}</div>
        <div className="mt-0.5 text-[15px] leading-5 font-bold text-ink">{value}</div>
      </div>
    </div>
  );
}

function TemplateText({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim());
  const items = lines.filter((l) => /^\s*[-*]\s+/.test(l));
  const paras = lines.filter((l) => !/^\s*[-*]\s+/.test(l));
  return (
    <>
      {paras.map((p, i) => (
        <p key={i}>{p.replace(/^#+\s*/, "")}</p>
      ))}
      {items.length > 0 && (
        <ol className="mt-2 flex flex-col gap-2">
          {items.map((l, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cream-2 font-display text-[14px] font-semibold text-ink">{i + 1}</span>
              <span className="pt-0.5 text-ink">{l.replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, "")}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
