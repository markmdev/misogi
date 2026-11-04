import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampPath, sceneFor, sceneName } from "@/components/challenge";
import { LiveScene } from "@/components/client/alive";
import { CheerButton, LogButton, QuestList, ShareButton, ShareWeekButton } from "@/components/client/actions";
import { ConnectPanel } from "@/components/client/connect";
import { Fresh, LivePulse } from "@/components/client/live";
import { LogMediaRow, PhotoWall } from "@/components/client/media";
import { SpaceFrame } from "@/components/client/space-frame";
import { Virgil } from "@/components/client/virgil";
import { Footer, TopBar } from "@/components/nav";
import { Avatar, EmptyState, Icon, IconTile, Mascot, Pill, ProgressBar, SectionTitle, Stat } from "@/components/ui";
import { currentUser, publicOrigin } from "@/lib/server/auth";
import { findChallenge, virgilUrl } from "@/lib/server/domain/challenges";
import { getUserByHandle } from "@/lib/server/domain/users";
import { connectCode } from "@/lib/server/oauth";
import { memberView, pulse } from "@/lib/server/views";
import { agentLabel, firstName, shortDate, timeAgo, withUnit } from "@/lib/shared/format";
import { palette } from "@/lib/shared/theme";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/c/[slug]/[handle]">): Promise<Metadata> {
  const { slug, handle } = await props.params;
  const c = findChallenge(slug);
  const u = getUserByHandle(handle);
  if (!c || !u) return { title: "Not found" };
  return { title: `${u.display_name} · ${c.title}`, description: `${u.display_name} is climbing “${c.title}” on Misogi.` };
}

export default async function MemberPage(props: PageProps<"/c/[slug]/[handle]">) {
  const { slug, handle } = await props.params;
  const sp = await props.searchParams;
  const viewer = await currentUser();
  const v = memberView(slug, handle, viewer);
  if (!v) notFound();
  const { c, user, facts, plan, quests, logs, space, metric, isOwner, membership, plans, wall } = v;
  const pal = palette(c.theme);
  const stamp = pulse(c);
  const name = firstName(user.display_name);
  const guide = agentLabel(user.agent_kind, user.agent_name, isOwner ? "your" : `${firstName(user.display_name)}'s`);
  const guideDoes = guide ? (guide.includes(", ") ? `${guide},` : guide) : `${name}'s AI`;
  const welcome = isOwner && sp.welcome === "1";
  const origin = await publicOrigin();
  const completed = membership.status === "completed";
  // Right after a web join, a starter plan is being drafted (lib/server/starter.ts); the live pulse refreshes when it lands.
  const drafting = isOwner && !plan && v.justJoined;

  return (
    <div style={{ background: pal.tint, ["--accent" as string]: pal.accent }} className="min-h-dvh">
      <TopBar user={viewer} />
      <LivePulse slug={c.slug} stamp={stamp} />

      <section className="relative">
        <div className="relative h-[180px] overflow-hidden sm:h-[230px]" style={{ background: pal.sky }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sceneFor(c.theme, false)} alt="" className="absolute inset-0 h-full w-full object-cover object-[65%_center]" />
          <LiveScene name={sceneName(c.theme)} className="absolute inset-0 h-full w-full object-cover object-[65%_center]" />
          <div className="absolute inset-x-0 bottom-0 h-24 sm:h-32" style={{ background: `linear-gradient(to bottom, transparent, ${pal.tint} 92%)` }} />
        </div>
        <div className="relative mx-auto -mt-16 max-w-5xl px-4 sm:px-6">
          <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar name={user.display_name} color={user.avatar} size={68} ring />
              <div className="min-w-0">
                <Link href={`/c/${c.slug}`} className="inline-flex items-center gap-1.5 text-[14px] font-extrabold hover:underline" style={{ color: pal.deep }}>
                  <Icon name={c.emoji} size={20} />
                  {c.title}
                </Link>
                <h1 className="mt-0.5 text-[26px] leading-8 text-ink sm:text-[30px] sm:leading-9">{isOwner ? "Your climb" : `${name}'s climb`}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] font-bold text-ink-2">
                  <span>
                    Day {facts.day} of {facts.days_total}
                  </span>
                  {guide && (
                    <Pill tone="white" className="!min-h-6 !py-0.5 !text-[12px]">
                      <Icon name={user.agent_kind === "virgil" ? "camp" : "orb"} size={16} />
                      Guided by {guide}
                      {user.agent_seen_at && <span className="font-bold text-ink-3 max-sm:hidden">· {timeAgo(user.agent_seen_at)}</span>}
                    </Pill>
                  )}
                  {completed && <Pill tone="gold">Summit reached</Pill>}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isOwner && !completed && <LogButton slug={c.slug} metric={metric} quests={quests} today={facts.today} className="flex-1 sm:flex-none" />}
              {isOwner ? (
                <ShareWeekButton
                  cardUrl={`/c/${c.slug}/${user.handle}/card?d=${facts.today}-${facts.total}-${facts.streak}`}
                  pageUrl={`${origin}/c/${c.slug}/${user.handle}`}
                  text={`My week on “${c.title}”. What's your misogi?`}
                  className="btn-ghost"
                />
              ) : (
                <ShareButton url={`/c/${c.slug}/${user.handle}`} text={`${user.display_name} is climbing “${c.title}” on Misogi`} />
              )}
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto mt-6 flex max-w-5xl flex-col gap-8 px-4 sm:px-6">
        {welcome && (
          <section className="card overflow-hidden p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <Mascot pose="cheer" size={86} alt="" />
              <div>
                <h2 className="text-[22px] leading-7 text-ink">You&apos;re on the mountain.</h2>
                <p className="mt-1 text-[15px] leading-6 text-ink-2">
                  Connect your Muse so it can plan with you and keep this page up to date. Or tap <b>Ask Virgil</b> to start right here.
                </p>
              </div>
            </div>
            <div className="mt-5">
              <ConnectPanel
                origin={origin}
                title={c.title}
                connectCode={connectCode(viewer!)}
                initialStatus={{ agent_kind: user.agent_kind, agent_name: user.agent_name, agent_seen_at: user.agent_seen_at }}
                hasKey={v.keys?.has_key ?? false}
              />
            </div>
          </section>
        )}

        {/* Stats */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fresh key={`streak-${facts.streak}`} className="rounded-[22px]">
            <Stat icon="streak" value={facts.streak} label={facts.streak === 1 ? "day streak" : "day streak"} tint="#FFEBDD" />
          </Fresh>
          <Fresh key={`xp-${facts.xp}`} className="rounded-[22px]">
            <Stat icon="xp" value={facts.xp} label={`XP · level ${facts.level}`} tint="var(--color-gold-soft)" />
          </Fresh>
          <Fresh key={`total-${facts.total}`} className="rounded-[22px]">
            <Stat
              icon={c.emoji}
              value={withUnit(facts.total, metric.unit)}
              label={facts.target != null ? `of ${withUnit(facts.target, metric.unit)}` : metric.name}
              tint={pal.tint}
            />
          </Fresh>
          <Stat
            icon={facts.pace != null && facts.pace >= 1 ? "rocket" : "hourglass"}
            value={facts.pace != null ? `${facts.pace >= 1 ? "Ahead" : "Behind"}` : facts.days_remaining}
            label={facts.pace != null ? `pace ${Math.round(facts.pace * 100)}%` : "days left"}
            tint="var(--color-sky-soft)"
          />
        </section>

        {facts.progress != null && (
          <section className="card p-5">
            <div className="mb-2 flex items-center justify-between text-[13px] font-extrabold text-ink-2">
              <span>{Math.round(facts.progress * 100)}% to the summit</span>
              {facts.expected_by_now != null && facts.day >= 7 && <span className="text-ink-3">Plan says {withUnit(facts.expected_by_now, metric.unit)} by today</span>}
            </div>
            <div className="relative">
              <ProgressBar value={facts.progress} color={pal.accent} height={18} />
              {facts.expected_by_now != null && facts.target && facts.day >= 7 ? (
                <span
                  className="absolute -top-1 h-[26px] w-[3px] rounded-full bg-ink/70"
                  style={{ left: `${Math.min(100, (facts.expected_by_now / facts.target) * 100)}%` }}
                  title="Where the plan says you'd be today"
                />
              ) : null}
            </div>
          </section>
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Quests */}
          <section>
            <SectionTitle title="This week" icon="quest" action={<span className="text-[13px] font-bold text-ink-3">{quests.filter((q) => q.status === "open").length} open</span>} />
            {quests.length ? (
              <QuestList slug={c.slug} quests={quests} metric={metric} owner={isOwner && !completed} today={facts.today} accent={pal.accent} />
            ) : (
              <EmptyState
                pose="read"
                title={drafting ? "Picking your first quests…" : "No quests yet"}
                body={drafting ? "They show up here in a few seconds." : isOwner ? "Ask your AI or Virgil for this week's quests." : `${guideDoes} hasn't set quests yet.`}
              />
            )}
          </section>

          {/* Camps */}
          <section>
            <SectionTitle
              title="Camps"
              icon="camp"
              action={<span className="text-[13px] font-bold text-ink-3">{facts.milestones_done}/{facts.milestones_total} reached</span>}
            />
            {plan && plan.milestones.length ? (
              <div className="card px-3 py-5">
                <CampPath milestones={plan.milestones} accent={pal.accent} deep={pal.deep} tint={pal.tint} total={facts.total} unit={metric.unit} />
              </div>
            ) : (
              <EmptyState
                pose="think"
                title={drafting ? "Drafting your camps…" : "No plan yet"}
                body={drafting ? "A starter plan lands here in a few seconds. Your AI makes it yours after a short chat." : isOwner ? "Your AI writes the plan after a short chat." : `${name} hasn't made a plan yet.`}
              />
            )}
          </section>
        </div>

        {/* Personal page */}
        <section id="page" className="scroll-mt-20">
          <SectionTitle
            title={isOwner ? "Your page" : `${name}'s page`}
            icon="paintbrush"
            action={space.current ? <span className="text-[13px] font-bold whitespace-nowrap text-ink-3">{space.current.built_by ? `Built by ${space.current.built_by}` : "Made by AI"} · {timeAgo(space.current.created_at)}</span> : null}
          />
          <SpaceFrame
            space={space}
            title={`${user.display_name}'s page for ${c.title}`}
            reloadKey={stamp}
            empty={
              <EmptyState
                pose="flag"
                title={isOwner ? "Your page is empty" : "Nothing here yet"}
                body={
                  isOwner
                    ? "Tell your AI what this page should be. Try: “A cozy study notebook with this week's words and my streak.”"
                    : `${guideDoes} hasn't built a page yet.`
                }
              />
            }
          />
        </section>

        {wall.length > 0 && (
          <section>
            <SectionTitle title="Photos" icon="camera" action={<span className="text-[13px] font-bold text-ink-3">{wallCount(wall)}</span>} />
            <PhotoWall items={wall} />
          </section>
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Log */}
          <section>
            <SectionTitle title="Log" icon="writing" />
            {logs.length ? (
              <ul className="card divide-y divide-line px-4">
                {logs.slice(0, 30).map((l) => (
                  <li key={l.id}>
                    <Fresh className="-mx-2 flex gap-3 rounded-2xl px-2 py-3.5">
                      <div className="w-12 shrink-0 pt-0.5 text-center">
                        <div className="font-display text-[13px] font-semibold text-ink-3 uppercase">{shortDate(l.logged_for).split(" ")[0]}</div>
                        <div className="font-display text-[20px] leading-6 font-semibold text-ink">{shortDate(l.logged_for).split(" ")[1]}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {l.value != null ? (
                            <span className="font-display text-[16px] font-semibold text-ink">{withUnit(l.value, metric.unit)}</span>
                          ) : (
                            (metric.aggregation === "sum" || metric.aggregation === "latest") &&
                            !l.quest_title && <Pill className="!min-h-6 !py-0.5 !text-[12px]">Practice</Pill>
                          )}
                          {l.label && <span className="text-[15px] font-extrabold text-ink">{l.label}</span>}
                          {l.quest_title && <Pill tone="moss" className="!min-h-6 !py-0.5 !text-[12px]">✓ {l.quest_title}</Pill>}
                          <span className="text-[12px] font-extrabold text-gold-deep">+{l.xp} XP</span>
                        </div>
                        {l.note ? (
                          <p className="mt-1 text-[15px] leading-6 text-ink-2">{l.note}</p>
                        ) : (
                          readInPhoto(l) && (
                            <p className="mt-1 text-[15px] leading-6 text-ink-2">
                              {readInPhoto(l)} <span className="text-[12px] font-bold whitespace-nowrap text-ink-3">· seen by Muse Spark</span>
                            </p>
                          )
                        )}
                        {l.media.length > 0 && <LogMediaRow media={l.media} words={l.note || readInPhoto(l)} date={l.logged_for} />}
                        <div className="mt-2 flex items-center gap-2">
                          {isOwner ? (
                            (l.cheers ?? 0) > 0 && (
                              <span className="inline-flex h-8 items-center gap-1 rounded-full bg-coral-soft px-2.5 text-[13px] font-extrabold text-coral-deep">
                                <Icon name="cheer" size={18} />
                                {l.cheers}
                              </span>
                            )
                          ) : (
                            <CheerButton logId={l.id} count={l.cheers ?? 0} disabled={!viewer || !v.viewerIsMember} />
                          )}
                          <span className="text-[12px] font-bold text-ink-3">via {sourceLabel(l.source, user.agent_name)}</span>
                        </div>
                      </div>
                    </Fresh>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState pose="sleep" title="No logs yet" body={isOwner ? "Log your first session, or tell your AI about it." : `${name} hasn't logged anything yet.`} />
            )}
          </section>

          {/* Plan */}
          <aside className="flex flex-col gap-6">
            {plan && (
              <section className="lg:only:sticky lg:only:top-22">
                <SectionTitle title="The plan" icon="map" />
                <Fresh key={plan.version} className="rounded-[22px]">
                  <div className="card p-5">
                    <p className="text-[15px] leading-7 whitespace-pre-line text-ink">{plan.summary_md}</p>
                    {plan.cadence && (
                      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-cream px-3 py-2.5">
                        <IconTile name="calendar" size={36} bg="#fff" />
                        <div className="text-[14px] leading-5 font-bold text-ink-2">{plan.cadence}</div>
                      </div>
                    )}
                    {plans.length > 1 && (
                      <div className="mt-4 border-t border-line pt-4">
                        <div className="label mb-2">Versions</div>
                        <ol className="flex flex-col gap-2">
                          {plans.map((p) => (
                            <li key={p.version} className="flex items-start gap-2 text-[13px] leading-5">
                              <span className="rounded-md bg-cream-2 px-1.5 font-extrabold text-ink-2">v{p.version}</span>
                              <span className="text-ink-2">{p.reason || "Updated"}</span>
                              <span className="ml-auto shrink-0 font-bold text-ink-3">{timeAgo(p.created_at)}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                </Fresh>
              </section>
            )}
            {isOwner && !welcome && (
              <section>
                <SectionTitle title="Your AI" icon="orb" />
                <div className="card p-4">
                  <ConnectPanel
                    origin={origin}
                    title={c.title}
                    connectCode={connectCode(viewer!)}
                    initialStatus={{ agent_kind: user.agent_kind, agent_name: user.agent_name, agent_seen_at: user.agent_seen_at }}
                    hasKey={v.keys?.has_key ?? false}
                  />
                </div>
              </section>
            )}
          </aside>
        </div>
      </main>
      <Footer />
      {isOwner && <Virgil signedIn challenge={c.slug} look={virgilUrl(c)} />}
      {!isOwner && <Virgil signedIn={!!viewer} look={virgilUrl(c)} />}
    </div>
  );
}

/** "5 photos", or "4 photos · 1 video". */
function wallCount(wall: { kind: string }[]) {
  const n = (kind: string, word: string) => {
    const k = wall.filter((m) => m.kind === kind).length;
    return k ? `${k} ${word}${k === 1 ? "" : "s"}` : null;
  };
  return [n("photo", "photo"), n("video", "video")].filter(Boolean).join(" · ");
}

/** What Muse Spark saw in the log's photo, for a log with no words of its own. */
function readInPhoto(l: { media: { caption: string | null }[] }) {
  return l.media.find((m) => m.caption)?.caption ?? null;
}

function sourceLabel(source: string, agentName: string | null) {
  switch (source) {
    case "muse":
      return agentName ? `${agentName} (Muse)` : "Muse";
    case "mcp":
      return agentName ?? "MCP agent";
    case "agent":
      return agentName ?? "AI agent";
    case "virgil":
      return "Virgil";
    case "web":
      return "web";
    default:
      return source;
  }
}
