import Link from "next/link";
import { ViewTransition } from "react";
import { coverLoop, SCENES, smallCopy } from "@/lib/shared/art";
import { activityText, firstName, metricLine, shortDate, timeAgo, withUnit } from "@/lib/shared/format";
import { palette } from "@/lib/shared/theme";
import type { ActivityItem, ChallengeSummary, Metric, Milestone, Standing } from "@/lib/shared/types";
import { LiveCover } from "./client/alive";
import { IntentLink } from "./client/intent-link";
import { Fresh } from "./client/live";
import { Avatar, cx, Icon, IconTile, Mascot, ProgressBar } from "./ui";

/** The scene a theme uses, by name, for its drifting-clouds loop. */
export function sceneName(theme: string): string {
  return theme in SCENES ? theme : "home-hero";
}

export function sceneFor(theme: string, small = true): string {
  const s = (SCENES as Record<string, { src: string; sm: string }>)[theme] ?? SCENES["home-hero"];
  return small ? s.sm : s.src;
}

/** A challenge's picture at 3:2: its cover (moving once it has a loop), its icon and its dressed Muse. */
export function ChallengeCover({ c, dense, eager }: { c: ChallengeSummary; dense?: boolean; eager?: boolean }) {
  const pal = palette(c.theme);
  const loop = coverLoop(c.cover_url);
  return (
    <div className="relative aspect-[3/2] overflow-hidden" style={{ background: pal.sky }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={c.cover_url ? smallCopy(c.cover_url) : sceneFor(c.theme)}
        alt=""
        loading={eager ? undefined : "lazy"}
        className={cx("absolute inset-0 h-full w-full object-cover", !c.cover_url && "object-[70%_center]")}
      />
      {loop && <LiveCover stem={loop} className="absolute inset-0 h-full w-full object-cover" />}
      <div className={cx("absolute bottom-3 left-3", dense && "max-sm:bottom-2 max-sm:left-2 max-sm:origin-bottom-left max-sm:scale-[0.7]")}>
        <IconTile name={c.emoji} size={52} bg="rgb(255 255 255 / 0.92)" className="shadow-sm" eager={eager} />
      </div>
      {c.virgil_url && (
        <Mascot
          src={c.virgil_url}
          size={96}
          eager={eager}
          alt=""
          className={cx("absolute right-2 -bottom-1 drop-shadow-[0_4px_4px_rgb(46_42_38/0.2)] transition duration-500 group-hover:-translate-y-1", dense && "max-sm:right-1 max-sm:origin-bottom-right max-sm:scale-[0.67]")}
        />
      )}
      {c.status === "template" && c.template_year && (
        <span className={cx("absolute top-3 right-3 rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-extrabold text-ink shadow-sm", dense && "max-sm:top-2 max-sm:right-2 max-sm:px-2 max-sm:py-0.5 max-sm:text-[11px]")}>
          {c.template_year}
        </span>
      )}
    </div>
  );
}

export function ChallengeCard({ c, className, dense, eager }: { c: ChallengeSummary; className?: string; dense?: boolean; eager?: boolean }) {
  const pal = palette(c.theme);
  const isTemplate = c.status === "template";
  return (
    <IntentLink
      href={`/c/${c.slug}`}
      transitionTypes={["open"]}
      className={cx("card group flex flex-col overflow-hidden transition duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-float)]", className)}
    >
      <ViewTransition name={`cover-${c.slug}`} share={{ open: "morph", default: "none" }} default="none">
        <ChallengeCover c={c} dense={dense} eager={eager} />
      </ViewTransition>
      <div className={cx("flex flex-1 flex-col p-4", dense && "max-sm:p-3")}>
        <h3 className={cx("text-[18px] leading-6 text-ink", dense && "max-sm:text-[15px] max-sm:leading-5")}>{c.title}</h3>
        {c.tagline && <p className={cx("mt-1 line-clamp-2 text-[14px] leading-5 text-ink-2", dense && "max-sm:hidden")}>{c.tagline}</p>}
        <div className={cx("mt-auto flex items-center justify-between gap-2 pt-4", dense && "max-sm:flex-col max-sm:items-start max-sm:gap-1.5 max-sm:pt-2.5")}>
          {isTemplate ? (
            <span className="shrink-0 text-[13px] font-bold whitespace-nowrap text-ink-3">Zuckerberg</span>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-extrabold whitespace-nowrap text-ink-2">
              <Icon name="highfive" size={20} />
              {c.members} climbing
            </span>
          )}
          <span className="min-w-0 max-w-full truncate rounded-full px-2.5 py-1 text-[12px] font-extrabold whitespace-nowrap" style={{ background: pal.tint, color: pal.deep }}>
            {metricLine(c.metric)}
          </span>
        </div>
      </div>
    </IntentLink>
  );
}

export function ActivityRow({ a, times = 1, showChallenge = true }: { a: ActivityItem; times?: number; showChallenge?: boolean }) {
  const pal = palette(a.challenge.theme);
  const note = typeof a.data.note === "string" && a.data.note ? a.data.note : null;
  return (
    <li>
      <Fresh className="-mx-2 flex gap-3 rounded-2xl px-2 py-3">
        {a.user ? (
          <Link href={`/c/${a.challenge.slug}/${a.user.handle}`} className="shrink-0">
            <Avatar name={a.user.display_name} color={a.user.avatar} size={40} />
          </Link>
        ) : (
          <IconTile name={a.challenge.emoji} size={40} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-5 text-ink">
            <span className="font-extrabold">{a.user ? firstName(a.user.display_name) : "Someone"}</span>{" "}
            {a.kind === "space" && a.data.target === "me" && a.user ? (
              <Link href={`/c/${a.challenge.slug}/${a.user.handle}#page`} className="underline decoration-line-2 underline-offset-4 hover:decoration-ink">
                {activityText(a)}
              </Link>
            ) : (
              activityText(a)
            )}
            {times > 1 && <span className="text-ink-2"> · {times} times</span>}
          </p>
          {note && <p className="mt-1 line-clamp-2 text-[14px] leading-5 text-ink-2">“{note}”</p>}
          <div className="mt-1.5 flex items-center gap-2 text-[12px] font-bold text-ink-3">
            <span className="shrink-0">{timeAgo(a.created_at)}</span>
            {showChallenge && (
              <Link href={`/c/${a.challenge.slug}`} title={a.challenge.title} className="min-w-0 truncate rounded-full px-2 py-0.5 font-extrabold" style={{ background: pal.tint, color: pal.deep }}>
                {a.challenge.title}
              </Link>
            )}
          </div>
        </div>
        {a.kind === "milestone" &&
          (typeof a.data.badge === "string" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/media/${a.data.badge}`} alt={`Badge for ${String(a.data.title ?? "a camp")}`} className="h-14 w-14 shrink-0 animate-pop rounded-full object-cover ring-2 ring-white shadow-sm" />
          ) : (
            <Icon name={String(a.data.emoji ?? "flag")} size={36} className="shrink-0 animate-pop" />
          ))}
        {a.kind === "level" && <Icon name="xp" size={32} className="shrink-0" />}
      </Fresh>
    </li>
  );
}

const MEDALS = ["#FFC23D", "#C9D1DB", "#E2A877"];

export function Leaderboard({ rows, metric, slug, highlight, accent }: { rows: Standing[]; metric: Metric; slug: string; highlight?: string; accent: string }) {
  if (rows.length === 0) return null;
  return (
    <ol className="card divide-y divide-line overflow-hidden">
      {rows.map((s) => (
        <li key={s.handle} className={cx(s.handle === highlight && "bg-cream")}>
          <Fresh key={s.total} className="flex items-center gap-3 px-4 py-3">
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-[14px] font-semibold"
              style={s.rank <= 3 ? { background: MEDALS[s.rank - 1], color: "#5a3e00" } : { color: "var(--color-ink-3)" }}
            >
              {s.rank}
            </span>
            <Link href={`/c/${slug}/${s.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={s.display_name} color={s.avatar} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-extrabold text-ink">{s.display_name}</span>
                  {s.role === "creator" && (
                    <span className="shrink-0" title="Started this challenge">
                      <Icon name="flag" size={18} alt="Started this challenge" />
                    </span>
                  )}
                </div>
                {s.progress != null ? (
                  <ProgressBar value={s.progress} color={accent} height={8} className="mt-1.5 max-w-[220px]" />
                ) : (
                  <div className="mt-0.5 text-[13px] font-bold text-ink-3">Level {s.level}</div>
                )}
              </div>
            </Link>
            <div className="min-w-[5.5rem] text-right">
              <div className="font-display text-[16px] font-semibold text-ink tabular-nums">{withUnit(s.total, metric.unit)}</div>
              {s.streak > 0 ? (
                <div className="flex items-center justify-end gap-0.5 text-[12px] font-extrabold text-flame">
                  <Icon name="streak" size={16} />
                  {s.streak}
                </div>
              ) : (
                <div className="text-[12px] font-bold text-ink-3">{s.last_log_on ? shortDate(s.last_log_on) : "Not yet"}</div>
              )}
            </div>
          </Fresh>
        </li>
      ))}
    </ol>
  );
}

const TRAIL_OFFSETS = [0, 56, 84, 56, 0, -56, -84, -56];
export const CAMP_STEP_MS = 220;

/** How far camp i of n sits from the middle, with the whole zig-zag centered. */
export function trailX(i: number, n: number): number {
  const used = TRAIL_OFFSETS.slice(0, Math.min(n, TRAIL_OFFSETS.length));
  return TRAIL_OFFSETS[i % TRAIL_OFFSETS.length] - (Math.max(...used) + Math.min(...used)) / 2;
}

/**
 * The climb: camps from base (bottom) to summit (top), like a trail up a mountain.
 * Done camps are filled, the next one is highlighted with Virgil standing beside it.
 * With `revealAt` (ms), camps appear one by one from the base up, starting then.
 */
export function CampPath({
  milestones,
  accent,
  deep,
  tint,
  total,
  unit,
  revealAt,
}: {
  milestones: Milestone[];
  accent: string;
  deep: string;
  tint: string;
  total: number;
  unit: string;
  revealAt?: number;
}) {
  if (milestones.length === 0) return null;
  const nextIdx = milestones.findIndex((m) => !m.done_at);
  const items = milestones.map((m, i) => ({ m, i, state: m.done_at ? "done" : i === nextIdx ? "next" : "later" })).reverse();
  const n = milestones.length;
  const reveal = revealAt != null;
  return (
    <div className="relative mx-auto flex max-w-md flex-col items-center py-2">
      {items.map(({ m, i, state }, k) => {
        const x = trailX(i, n);
        const above = trailX(i + 1, n);
        const isSummit = i === n - 1;
        const at = (revealAt ?? 0) + i * CAMP_STEP_MS;
        return (
          <div key={m.id} className="relative flex w-full flex-col items-center">
            {k > 0 && (
              <svg
                width="240"
                height="34"
                className={cx("-my-1 overflow-visible", reveal && "animate-trail")}
                style={reveal ? { animationDelay: `${at + CAMP_STEP_MS * 0.55}ms` } : undefined}
                aria-hidden
              >
                <path
                  d={`M ${120 + above} 0 C ${120 + above} 17, ${120 + x} 17, ${120 + x} 34`}
                  fill="none"
                  stroke={state === "done" ? accent : "var(--color-line-2)"}
                  strokeWidth="5"
                  strokeDasharray="2 10"
                  strokeLinecap="round"
                />
              </svg>
            )}
            <div className="relative flex items-center" style={{ translate: `${x}px 0` }}>
              <Fresh key={state} className="rounded-full">
                <div
                  className={cx(
                    "relative grid place-items-center rounded-full transition",
                    reveal && "animate-pop",
                    state === "next" ? "h-[84px] w-[84px]" : "h-[68px] w-[68px]",
                  )}
                  style={{
                    animationDelay: reveal ? `${at}ms` : undefined,
                    background: state === "later" ? "var(--color-cream-2)" : state === "done" ? accent : "#fff",
                    boxShadow: state === "later" ? "0 5px 0 var(--color-line-2)" : `0 5px 0 ${deep}`,
                    border: state === "next" ? `4px solid ${accent}` : "none",
                  }}
                >
                  {state === "done" && m.badge ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/media/${m.badge}`} alt={`Badge for ${m.title}`} className="h-[60px] w-[60px] rounded-full object-cover" />
                  ) : (
                    <Icon
                      name={isSummit ? "summit" : m.emoji || "camp"}
                      size={state === "next" ? 52 : 42}
                      className={cx(state === "later" && "opacity-55 grayscale-[0.6]")}
                    />
                  )}
                  {state === "done" && (
                    <span className="absolute -right-1 -bottom-1 grid h-7 w-7 place-items-center rounded-full border-[3px] border-white bg-moss text-white">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                  )}
                </div>
              </Fresh>
              {state === "next" && (
                <Mascot
                  pose="climb"
                  size={72}
                  className={cx("absolute top-1/2 -translate-y-1/2", reveal && "animate-rise")}
                  alt=""
                  style={{ ...(x > 0 ? { right: "100%", marginRight: 4 } : { left: "100%", marginLeft: 4 }), animationDelay: reveal ? `${at + 120}ms` : undefined }}
                />
              )}
            </div>
            <div
              className={cx("mt-2 mb-1 max-w-[260px] text-center", reveal && "animate-rise")}
              style={{ translate: `${x}px 0`, animationDelay: reveal ? `${at + 80}ms` : undefined }}
            >
              <div className={cx("font-display text-[16px] leading-5 font-semibold", state === "later" ? "text-ink-2" : "text-ink")}>{m.title}</div>
              <div className="mt-0.5 text-[12px] font-bold text-ink-3">
                {m.target != null ? withUnit(m.target, unit) : ""}
                {m.target != null && m.due_on ? " · " : ""}
                {m.due_on ? `by ${shortDate(m.due_on)}` : ""}
              </div>
              {state === "next" && m.target != null && (
                <div className="mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-extrabold" style={{ background: tint, color: deep }}>
                  {withUnit(Math.max(0, Math.round((m.target - total) * 10) / 10), unit)} to go
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
