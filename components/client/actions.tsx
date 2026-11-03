"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cheerAction, joinAction, logFromWeb, skipQuestAction } from "@/app/actions";
import { shortDate } from "@/lib/shared/format";
import type { Metric, Quest } from "@/lib/shared/types";
import { cx, Icon, IconTile } from "../ui";
import { Fresh } from "./live";
import { Sheet } from "./sheet";
import { Spinner } from "./space-frame";

function tz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function JoinButton({ slug, signedIn, title, className }: { slug: string; signedIn: boolean; title: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function join(withName?: string) {
    setError(null);
    start(async () => {
      const r = await joinAction(slug, withName, tz());
      if (!r.ok) return setError(r.error);
      router.push(`/c/${slug}/${r.data!.handle}?welcome=1`);
    });
  }

  return (
    <>
      <button className={cx("btn", className)} disabled={pending} onClick={() => (signedIn ? join() : setOpen(true))}>
        {pending ? <Spinner /> : <Icon name="highfive" size={26} />}
        Join this climb
      </button>
      {error && !open && <p className="mt-2 text-[14px] font-bold text-coral-deep">{error}</p>}
      <Sheet open={open} onClose={() => setOpen(false)} title={`Join “${title}”`}>
        <p className="text-[15px] leading-6 text-ink-2">Same summit, your own pace. Your AI gets your plan; your name shows on the leaderboard.</p>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            join(name);
          }}
        >
          <label className="label" htmlFor="join-name">
            Your name
          </label>
          <input id="join-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="First name is fine" />
          {error && <p className="text-[14px] font-bold text-coral-deep">{error}</p>}
          <button className="btn mt-1" disabled={pending || !name.trim()}>
            {pending && <Spinner />}
            Join
          </button>
        </form>
      </Sheet>
    </>
  );
}

function needsValue(m: Metric) {
  return m.aggregation === "sum" || m.aggregation === "latest";
}

export function QuickLog({
  slug,
  metric,
  quests,
  open,
  onClose,
  questId,
  today,
}: {
  slug: string;
  metric: Metric;
  quests: Quest[];
  open: boolean;
  onClose: () => void;
  questId?: string | null;
  today: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const [quest, setQuest] = useState<string>(questId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  const open_ = quests.filter((q) => q.status === "open");
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  function close() {
    setDone(null);
    setError(null);
    setValue("");
    setLabel("");
    setNote("");
    onClose();
  }

  return (
    <Sheet open={open} onClose={close} title={done ? "Logged" : "Log progress"}>
      {done ? (
        <div className="flex flex-col items-center py-2 text-center">
          <Icon name="check" size={72} className="animate-pop" />
          <p className="mt-3 text-[16px] font-bold text-ink">Nice. It&apos;s on your page.</p>
          {done.length > 0 && (
            <p className="mt-2 rounded-full bg-moss-soft px-3 py-1 text-[14px] font-extrabold text-moss-deep">Camp reached: {done.join(", ")}</p>
          )}
          <button className="btn btn-moss mt-5 w-full" onClick={close}>
            Done
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const r = await logFromWeb(slug, {
                value: value.trim() === "" ? null : Number(value),
                label: label.trim() || undefined,
                note: note.trim() || undefined,
                quest_id: quest || undefined,
                date: day === "today" ? today : yesterday.toISOString().slice(0, 10),
              });
              if (!r.ok) return setError(r.error);
              setDone(r.data?.milestones ?? []);
              router.refresh();
            });
          }}
        >
          {(needsValue(metric) || metric.aggregation === "count") && (
            <div>
              <label className="label" htmlFor="log-value">
                {metric.name}
                {metric.unit ? ` (${metric.unit})` : ""}
              </label>
              <input
                id="log-value"
                className="input mt-1.5"
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required={needsValue(metric) && !note.trim() && !quest}
                placeholder={metric.aggregation === "count" ? "1" : "How much?"}
              />
              {needsValue(metric) && <p className="mt-1.5 text-[13px] font-bold text-ink-3">Practiced without a number? Leave it empty and add a note.</p>}
            </div>
          )}
          {metric.aggregation === "distinct" && (
            <div>
              <label className="label" htmlFor="log-label">
                Which one?
              </label>
              <input id="log-label" className="input mt-1.5" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} placeholder={`Name the ${metric.name.replace(/s$/, "")}`} />
            </div>
          )}
          <div>
            <span className="label">When</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["today", "yesterday"] as const).map((d) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => setDay(d)}
                  className={cx(
                    "h-11 rounded-xl text-[15px] font-extrabold ring-1 transition",
                    day === d ? "bg-ink text-white ring-ink" : "bg-white text-ink-2 ring-line hover:text-ink",
                  )}
                >
                  {d === "today" ? "Today" : `Yesterday · ${shortDate(yesterday.toISOString().slice(0, 10))}`}
                </button>
              ))}
            </div>
          </div>
          {open_.length > 0 && (
            <div>
              <label className="label" htmlFor="log-quest">
                Completes a quest?
              </label>
              <select id="log-quest" className="input mt-1.5 appearance-none" value={quest} onChange={(e) => setQuest(e.target.value)}>
                <option value="">No</option>
                {open_.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="log-note">
              Note
            </label>
            <textarea
              id="log-note"
              className="input mt-1.5 h-24 resize-none py-3 leading-6"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              placeholder="How did it go?"
            />
          </div>
          {error && <p className="text-[14px] font-bold text-coral-deep">{error}</p>}
          <button className="btn btn-moss" disabled={pending}>
            {pending && <Spinner />}
            Log it
          </button>
        </form>
      )}
    </Sheet>
  );
}

export function LogButton(props: { slug: string; metric: Metric; quests: Quest[]; today: string; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={cx("btn btn-moss", props.className)} onClick={() => setOpen(true)}>
        <Icon name="pencil" size={24} />
        {props.label ?? "Log progress"}
      </button>
      <QuickLog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const KIND_ICON: Record<Quest["kind"], string> = { daily: "calendar", weekly: "quest", boss: "target", one_off: "sparkles" };

export function QuestList({ slug, quests, metric, owner, today, accent }: { slug: string; quests: Quest[]; metric: Metric; owner: boolean; today: string; accent: string }) {
  const router = useRouter();
  const [logFor, setLogFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const open = quests.filter((q) => q.status === "open");
  const done = quests.filter((q) => q.status === "done").slice(0, 5);

  function complete(q: Quest) {
    if (needsValue(metric) || metric.aggregation === "distinct") return setLogFor(q.id);
    setBusy(q.id);
    start(async () => {
      await logFromWeb(slug, { quest_id: q.id, date: today });
      setBusy(null);
      router.refresh();
    });
  }

  function skip(q: Quest) {
    setBusy(q.id);
    start(async () => {
      await skipQuestAction(slug, q.id);
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {open.map((q) => (
        <Fresh key={q.id} className="rounded-[18px]">
          <div className="group flex items-center gap-3 rounded-[18px] bg-white p-3 pr-3 ring-1 ring-line" style={{ boxShadow: "0 3px 0 var(--color-line)" }}>
            <IconTile name={q.kind === "boss" ? "trophy" : KIND_ICON[q.kind]} size={46} bg="var(--color-cream)" />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] leading-5 font-extrabold text-ink">{q.title}</div>
              {q.detail && <div className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-ink-2">{q.detail}</div>}
              <div className="mt-1 flex items-center gap-2 text-[12px] font-extrabold text-ink-3">
                {q.kind === "boss" && <span className="rounded-full bg-coral-soft px-2 py-0.5 text-coral-deep">Boss</span>}
                {q.due_on && <span>Due {shortDate(q.due_on)}</span>}
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-0.5 font-display text-[15px] font-semibold text-gold-deep">
              {q.xp}
              <Icon name="xp" size={18} />
            </span>
            {owner && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => skip(q)}
                  className="hidden h-11 rounded-xl px-2 text-[12px] font-extrabold text-ink-3 hover:text-ink sm:group-hover:block"
                  disabled={busy === q.id}
                >
                  Skip
                </button>
                <button
                  onClick={() => complete(q)}
                  disabled={busy === q.id}
                  aria-label={`Complete ${q.title}`}
                  className="grid h-11 w-11 place-items-center rounded-[14px] bg-white ring-1 ring-line-2 transition active:translate-y-[2px]"
                  style={{ boxShadow: "0 3px 0 var(--color-line-2)", color: accent }}
                >
                  {busy === q.id ? (
                    <Spinner />
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>
        </Fresh>
      ))}
      {done.map((q) => (
        <Fresh key={`${q.id}:done`} className="rounded-[18px]">
          <div className="flex items-center gap-3 rounded-[18px] bg-moss-soft/70 p-3 ring-1 ring-moss/15">
            <Icon name="check" size={34} className="mx-1.5" />
            <div className="min-w-0 flex-1 text-[15px] font-bold text-moss-deep line-through decoration-2 opacity-80">{q.title}</div>
            <span className="text-[12px] font-extrabold text-moss-deep">+{q.xp} XP</span>
          </div>
        </Fresh>
      ))}
      {owner && (
        <QuickLog slug={slug} metric={metric} quests={quests} open={logFor != null} questId={logFor} onClose={() => setLogFor(null)} today={today} />
      )}
    </div>
  );
}

export function CheerButton({ logId, count, disabled }: { logId: string; count: number; disabled?: boolean }) {
  const [n, setN] = useState(count);
  const [on, setOn] = useState(false);
  const [pending, start] = useTransition();
  return (
    <button
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const r = await cheerAction(logId);
          if (r.ok && r.data) {
            setOn((v) => !v);
            setN(r.data.cheers);
          }
        })
      }
      className={cx(
        "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-extrabold ring-1 transition",
        on ? "bg-coral-soft text-coral-deep ring-coral/30" : "bg-white text-ink-2 ring-line hover:text-ink",
        disabled && "cursor-default opacity-70",
      )}
      title={disabled ? "Sign in and join to cheer" : "Cheer"}
    >
      <Icon name="cheer" size={18} className={cx(on && "animate-pop")} />
      {n > 0 ? n : "Cheer"}
    </button>
  );
}

export function ShareButton({ url, text, className }: { url: string; text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={cx("btn btn-ghost", className)}
      onClick={async () => {
        const full = url.startsWith("http") ? url : `${window.location.origin}${url}`;
        if (navigator.share) {
          try {
            await navigator.share({ url: full, text });
            return;
          } catch {
            /* fall back to copying */
          }
        }
        await navigator.clipboard.writeText(full);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      <Icon name="link" size={20} />
      {copied ? "Link copied" : "Share"}
    </button>
  );
}

/** Shares the weekly recap image: the native share sheet with the PNG where supported, otherwise a download. */
export function ShareWeekButton({ cardUrl, pageUrl, text, className }: { cardUrl: string; pageUrl: string; text: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={cx("btn", className)} onClick={() => setOpen(true)}>
        <Icon name="camera" size={22} />
        Share my week
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Your week">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cardUrl} alt="Your weekly recap card" className="w-full rounded-[22px] ring-1 ring-line" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const blob = await (await fetch(cardUrl)).blob();
                const file = new File([blob], "my-misogi-week.png", { type: "image/png" });
                const full = pageUrl.startsWith("http") ? pageUrl : `${window.location.origin}${pageUrl}`;
                if (navigator.canShare?.({ files: [file] })) {
                  await navigator.share({ files: [file], text: `${text} ${full}` });
                } else {
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "my-misogi-week.png";
                  a.click();
                  URL.revokeObjectURL(a.href);
                }
              } catch {
                /* the person closed the share sheet */
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : null}
            Save or share
          </button>
          <a
            className="btn btn-ink btn-sm"
            target="_blank"
            rel="noreferrer"
            href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`}
          >
            Post on X
          </a>
        </div>
      </Sheet>
    </>
  );
}
