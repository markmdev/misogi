"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { startChallenge } from "@/app/actions";
import { withUnit } from "@/lib/shared/format";
import { palette } from "@/lib/shared/theme";
import type { Milestone, Theme } from "@/lib/shared/types";
import { CAMP_STEP_MS, CampPath, sceneFor, trailX } from "../challenge";
import { cx, Icon, IconTile, Mascot } from "../ui";
import { ConnectPanel } from "./connect";
import { LINE } from "./start-box";
import { Spinner } from "./space-frame";
import { MisogiWord } from "./misogi-word";

type Draft = {
  title: string;
  tagline: string;
  category: string;
  icon: string;
  theme: Theme;
  metric: { name: string; unit: string; target: number | null; aggregation: string; direction: "up" | "down" };
  camps: { title: string; detail: string; target: number | null; due_on: string; icon: string }[];
  plan_summary: string;
  cadence: string;
  first_quests: { title: string; detail: string; kind: string; xp: number }[];
};
type Pair = { situation: string; gentle: string; firm: string };
type Step = "idea" | "drafting" | "draft" | "style" | "name" | "creating" | "connect";

const IDEAS = ["Hold a conversation in Mandarin", "Read 25 books", "Build a smart home", "Run 365 miles", "Write 52 essays", "Learn 20 songs on guitar"];
const DRAFTING_LINES = ["Reading your idea…", "Choosing how to measure it…", "Placing the camps…", "Writing this week's quests…"];

function tz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function StartFlow({ initialIdea, signedInName, origin }: { initialIdea: string; signedInName: string | null; origin: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialIdea ? "drafting" : "idea");
  const [idea, setIdea] = useState(initialIdea);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftedBy, setDraftedBy] = useState<string | null>(null);
  const [draftSeconds, setDraftSeconds] = useState(0);
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [choices, setChoices] = useState<("gentle" | "firm")[]>([]);
  const [name, setName] = useState(signedInName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; connectCode: string; handle: string } | null>(null);
  const [line, setLine] = useState(0);
  const [, start] = useTransition();
  const started = useRef(false);

  async function runDraft(text: string) {
    setError(null);
    setStep("drafting");
    setLine(0);
    setPairs(null);
    try {
      const began = performance.now();
      const r = await fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idea: text, timezone: tz() }) });
      const d = (await r.json()) as { draft?: Draft; drafted_by?: string | null; error?: { message: string } };
      if (!r.ok || !d.draft) throw new Error(d.error?.message ?? "Couldn't draft that. Try again.");
      setDraft(d.draft);
      setDraftedBy(d.drafted_by ?? null);
      setDraftSeconds(Math.max(1, Math.round((performance.now() - began) / 1000)));
      setStep("draft");
      // Fetch the style examples in the background while they read the draft.
      void fetch("/api/style-pairs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: d.draft.title }) })
        .then((x) => x.json())
        .then((x: { pairs: Pair[] }) => setPairs(x.pairs));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't draft that. Try again.");
      setStep("idea");
    }
  }

  useEffect(() => {
    if (initialIdea && !started.current) {
      started.current = true;
      void runDraft(initialIdea);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  useEffect(() => {
    if (step !== "drafting") return;
    const t = setInterval(() => setLine((l) => Math.min(l + 1, DRAFTING_LINES.length - 1)), 2600);
    return () => clearInterval(t);
  }, [step]);

  function create() {
    if (!draft) return;
    setError(null);
    setStep("creating");
    start(async () => {
      const r = await startChallenge({ draft, name: name.trim(), timezone: tz(), choices, idea });
      if (!r.ok) {
        setError(r.error);
        setStep("name");
        return;
      }
      setCreated(r.data!);
      setStep("connect");
    });
  }

  const pal = palette(draft?.theme ?? "teal");
  const wide = step === "drafting" || step === "draft";

  return (
    <div className={cx("mx-auto w-full px-4 pt-6 pb-24", wide ? "max-w-xl lg:max-w-5xl" : "max-w-xl")}>
      <Progress step={step} />

      {step === "idea" && (
        <section className="animate-rise">
          <div className="flex flex-col items-center text-center">
            <Mascot pose="wave" size={110} />
            <h1 className="mt-2 text-[30px] leading-9 text-ink">
              What&apos;s your <MisogiWord side="above">misogi</MisogiWord>?
            </h1>
            <p className="mt-2 text-[16px] leading-6 text-ink-2">One hard thing you want to do this year. Say it in your own words.</p>
          </div>
          <form
            className="mt-6 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (idea.trim().length >= 3) void runDraft(idea.trim());
            }}
          >
            <textarea
              className="input h-28 resize-none py-4 text-[18px] leading-7"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. Have a 20-minute conversation in Mandarin by next fall"
              maxLength={200}
              autoFocus
            />
            {error && <p className="text-[14px] font-bold text-coral-deep">{error}</p>}
            <button className="btn" disabled={idea.trim().length < 3}>
              Plan my year
            </button>
          </form>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {IDEAS.map((i) => (
              <button key={i} className="chip pl-3.5" onClick={() => setIdea(i)}>
                {i}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "drafting" && (
        <section className={YEAR_GRID}>
          <div className="card overflow-hidden">
            <div className="flex items-center gap-4 p-5" style={{ background: "var(--color-cream-2)" }}>
              <span className="tile h-16 w-16 shrink-0 bg-white">
                <Icon name="sparkles" size={40} className="animate-bob" />
              </span>
              <div className="min-w-0">
                <div className="label flex items-center gap-1.5">
                  <Spinner className="h-3 w-3 border-2" />
                  Drafting your year
                </div>
                <p className="mt-0.5 font-display text-[22px] leading-7 font-semibold text-ink" style={LINE}>
                  {idea}
                </p>
                <p key={line} className="mt-1 animate-rise text-[14px] leading-5 font-bold text-ink-2" aria-live="polite">
                  {DRAFTING_LINES[line]}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-line">
              {["Measured by", "Summit"].map((l, i) => (
                <div key={l} className="bg-white p-4">
                  <div className="label">{l}</div>
                  <span className={cx("skel mt-2 h-3.5", i === 0 ? "w-3/4" : "w-1/3", line === 1 && "skel-live")} />
                </div>
              ))}
            </div>
          </div>

          <GhostClimb active={line >= 2} className={CLIMB_CELL} />

          <div>
            <h3 className="mb-3 text-[18px] text-ink-3">This week</h3>
            <div className="flex flex-col gap-2">
              {[0.62, 0.48, 0.7].map((w, i) => (
                <div key={i} className="flex items-center gap-3 rounded-[18px] bg-white p-3 ring-1 ring-line" style={{ boxShadow: "0 3px 0 var(--color-line)" }}>
                  <span className="tile h-10 w-10 bg-cream-2" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                    <span className={cx("skel", line === 3 && "skel-live")} style={{ width: `${w * 100}%` }} />
                    <span className={cx("skel h-2.5", line === 3 && "skel-live")} style={{ width: `${(w + 0.25) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {step === "draft" && draft && <DraftYear draft={draft} draftedBy={draftedBy} seconds={draftSeconds} setDraft={setDraft} onRetry={() => void runDraft(idea)} onAccept={() => setStep("style")} />}

      {step === "style" && (
        <section className="animate-rise">
          <div className="text-center">
            <h2 className="text-[26px] leading-8 text-ink">How should your guide talk to you?</h2>
            <p className="mt-2 text-[15px] text-ink-2">Pick one in each, the message you&apos;d rather get.</p>
          </div>
          {!pairs ? (
            <div className="mt-10 flex justify-center">
              <Spinner className="h-6 w-6 text-ink-3" />
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-6">
              {pairs.map((p, i) => (
                <div key={i}>
                  <div className="label mb-2">{p.situation}</div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {(["gentle", "firm"] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => setChoices((c) => Object.assign([...c], { [i]: k }))}
                        className={cx(
                          "flex flex-col rounded-[22px] bg-white px-4 pt-3 pb-4 text-left ring-2 shadow-[var(--shadow-card)] transition",
                          choices[i] === k ? "" : "ring-transparent hover:-translate-y-0.5",
                          choices[i] && choices[i] !== k && "opacity-55",
                        )}
                        style={choices[i] === k ? { ["--tw-ring-color" as string]: pal.accent } : undefined}
                      >
                        <span className="flex h-6 items-center gap-2 text-[12px] font-extrabold tracking-wide text-ink-3 uppercase">
                          <Icon name="summit" size={20} />
                          Your guide
                          {choices[i] === k ? <Icon name="check" size={22} className="ml-auto animate-pop" /> : <span className="ml-auto font-bold tracking-normal normal-case">now</span>}
                        </span>
                        <span className="mt-1.5 block text-[15px] leading-6 text-ink">{p[k]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button className="btn" disabled={choices.filter(Boolean).length < pairs.length} onClick={() => setStep(signedInName ? "creating" : "name")}>
                Continue
              </button>
            </div>
          )}
        </section>
      )}

      {step === "name" && (
        <section className="animate-rise">
          <div className="flex flex-col items-center text-center">
            <Mascot pose="flag" size={110} />
            <h2 className="mt-2 text-[26px] leading-8 text-ink">Last thing: your name</h2>
            <p className="mt-2 text-[15px] text-ink-2">It shows on your page and the leaderboard.</p>
          </div>
          <form
            className="mt-6 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create();
            }}
          >
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="First name is fine" maxLength={40} autoFocus />
            {error && <p className="text-[14px] font-bold text-coral-deep">{error}</p>}
            <button className="btn" disabled={!name.trim()}>
              Start my climb
            </button>
            <p className="text-center text-[13px] leading-5 text-ink-3">No email or password. Your AI can send you a sign-in link anytime.</p>
          </form>
        </section>
      )}

      {step === "creating" && <CreatingEffect onReady={create} signedIn={!!signedInName} />}

      {step === "connect" && created && (
        <section className="animate-rise">
          <div className="flex flex-col items-center text-center">
            <Mascot pose="cheer" size={120} className="animate-pop" />
            <h2 className="mt-2 text-[28px] leading-9 text-ink">You&apos;re on the mountain</h2>
            <p className="mt-2 max-w-md text-[15px] leading-6 text-ink-2">
              Now bring your Muse. It reads your plan, asks a few questions, and keeps your page up to date from now on.
            </p>
          </div>
          <button className="btn btn-moss mt-6 w-full" onClick={() => router.push(`/c/${created.slug}/${created.handle}`)}>
            See my page
          </button>
          <p className="mt-3 text-center text-[13px] text-ink-3">
            No AI handy? Tap <b>Ask Virgil</b> on your page and <MisogiWord>Misogi</MisogiWord>&apos;s own guide takes it from there.
          </p>
          <div className="mt-6">
            <ConnectPanel origin={origin} title={draft?.title} connectCode={created.connectCode} initialStatus={null} />
          </div>
        </section>
      )}

      {step !== "connect" && step !== "creating" && (
        <p className="mt-10 text-center text-[13px] text-ink-3">
          <Link href="/explore" className="underline decoration-line-2 underline-offset-2 hover:text-ink">
            Or join someone else&apos;s challenge
          </Link>
        </p>
      )}
    </div>
  );
}

const YEAR_GRID = "grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:grid-rows-[auto_auto_auto_1fr] lg:gap-x-8";
const CLIMB_CELL = "lg:col-start-2 lg:row-span-4 lg:row-start-1";

/** The drafted year arrives in order: the misogi, how it's measured, the camps from base to summit, then this week. */
function DraftYear({
  draft,
  draftedBy,
  seconds,
  setDraft,
  onRetry,
  onAccept,
}: {
  draft: Draft;
  draftedBy: string | null;
  seconds: number;
  setDraft: (d: Draft) => void;
  onRetry: () => void;
  onAccept: () => void;
}) {
  const pal = palette(draft.theme);
  const camps: Milestone[] = draft.camps.map((c, i) => ({ id: String(i), title: c.title, target: c.target, due_on: c.due_on, emoji: c.icon }));
  const at = { metric: 200, camps: 450, quests: 450 + camps.length * CAMP_STEP_MS + 150 };
  const after = (ms: number) => ({ animationDelay: `${ms}ms` });
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = titleRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [draft.title]);
  return (
    <section className={YEAR_GRID}>
      <div className="card animate-rise overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line bg-white px-5 py-2.5 text-[14px] font-extrabold text-ink-2">
          <Icon name="sparkles" size={22} />
          {draftedBy ?? "Your AI"} drafted this in {seconds} second{seconds === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-4 p-5" style={{ background: pal.tint }}>
          <IconTile name={draft.icon} size={64} bg="#fff" className="animate-pop" />
          <div className="min-w-0 flex-1">
            <div className="label" style={{ color: pal.deep }}>
              Your <MisogiWord>misogi</MisogiWord>
            </div>
            <textarea
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, " ").slice(0, 60) })}
              ref={titleRef}
              rows={1}
              className="mt-0.5 w-full resize-none overflow-hidden bg-transparent font-display text-[22px] leading-7 font-semibold text-ink outline-none"
              aria-label="Challenge title"
            />
            <p className="mt-0.5 text-[14px] leading-5 text-ink-2">{draft.tagline}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-line">
          <div className="bg-white p-4">
            <div className="label">Measured by</div>
            <div className="mt-1 animate-rise text-[15px] font-extrabold text-ink first-letter:uppercase" style={after(at.metric)}>
              {draft.metric.name}
            </div>
          </div>
          <div className="bg-white p-4">
            <div className="label">Summit</div>
            <div className="mt-1 animate-rise text-[15px] font-extrabold text-ink" style={after(at.metric + 90)}>
              {draft.metric.target != null ? withUnit(draft.metric.target, draft.metric.unit) : "Your call"}
            </div>
          </div>
        </div>
      </div>

      <ClimbCard theme={draft.theme} className={CLIMB_CELL}>
        <CampPath milestones={camps} accent={pal.accent} deep={pal.deep} tint={pal.tint} total={0} unit={draft.metric.unit} revealAt={at.camps} />
      </ClimbCard>

      <div>
        <h3 className="mb-3 animate-rise text-[18px] text-ink" style={after(at.quests)}>
          This week
        </h3>
        <div className="flex flex-col gap-2">
          {draft.first_quests.map((q, i) => (
            <div
              key={i}
              className="flex animate-rise items-center gap-3 rounded-[18px] bg-white p-3 ring-1 ring-line"
              style={{ boxShadow: "0 3px 0 var(--color-line)", ...after(at.quests + 80 + i * 110) }}
            >
              <IconTile name={q.kind === "boss" ? "trophy" : "quest"} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] leading-5 font-extrabold text-ink">{q.title}</div>
                {q.detail && <div className="text-[13px] leading-5 text-ink-2">{q.detail}</div>}
              </div>
              <span className="flex items-center gap-0.5 font-display text-[14px] font-semibold text-gold-deep">
                {q.xp}
                <Icon name="xp" size={16} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="animate-rise" style={after(at.quests + 80 + draft.first_quests.length * 110 + 60)}>
        <p className="text-[14px] leading-6 text-ink-2">
          This is a first draft. Your guide tunes it to your life after a short chat.
        </p>
        <div className="mt-4 flex gap-3">
          <button className="btn btn-ghost flex-1" onClick={onRetry}>
            Try again
          </button>
          <button className="btn flex-[2]" onClick={onAccept}>
            Looks good
          </button>
        </div>
      </div>
    </section>
  );
}

/** The mountain behind the camps: the challenge's own scene, fading into the card. */
function ClimbCard({ theme, className, children }: { theme: Theme | null; className?: string; children: ReactNode }) {
  return (
    <div className={cx("card relative overflow-hidden", className)}>
      <div className="absolute inset-x-0 top-0 h-[250px]" style={{ background: theme ? palette(theme).sky : "var(--color-cream-2)" }} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {theme && <img src={sceneFor(theme, false)} alt="" className="h-full w-full animate-fade object-cover object-top" />}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgb(255 255 255 / 0) 40%, #fff 92%)" }} />
      </div>
      <div className="relative px-3 pt-[124px] pb-4">{children}</div>
    </div>
  );
}

/** The trail before the camps are known: empty camps from base to summit, lighting up while they're placed. */
function GhostClimb({ active, className }: { active: boolean; className?: string }) {
  const n = 4;
  return (
    <ClimbCard theme={null} className={className}>
      <div className="relative mx-auto flex max-w-md flex-col items-center py-2" aria-hidden>
        {Array.from({ length: n }, (_, k) => {
          const i = n - 1 - k;
          const x = trailX(i, n);
          const above = trailX(i + 1, n);
          const base = i === 0;
          return (
            <div key={i} className="relative flex w-full flex-col items-center">
              {k > 0 && (
                <svg width="240" height="34" className="-my-1 overflow-visible">
                  <path
                    d={`M ${120 + above} 0 C ${120 + above} 17, ${120 + x} 17, ${120 + x} 34`}
                    fill="none"
                    stroke="var(--color-line-2)"
                    strokeWidth="5"
                    strokeDasharray="2 10"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              <div className="relative flex items-center" style={{ translate: `${x}px 0` }}>
                <div
                  className="relative grid place-items-center rounded-full bg-white/70 text-line-2"
                  style={{ width: base ? 84 : 68, height: base ? 84 : 68, animation: active ? `ghost 1.6s ease-in-out ${i * 0.22}s infinite` : undefined }}
                >
                  <svg viewBox="0 0 68 68" className="absolute inset-0 h-full w-full overflow-visible">
                    <circle cx="34" cy="34" r="32" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="1 8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                  {k === 0 && <Icon name="summit" size={40} eager className="opacity-25 grayscale" />}
                </div>
                {base && (
                  <Mascot
                    pose="think"
                    size={72}
                    eager
                    alt=""
                    className="absolute top-1/2 -translate-y-1/2 lg:[view-transition-name:guide]"
                    style={x > 0 ? { right: "100%", marginRight: 4 } : { left: "100%", marginLeft: 4 }}
                  />
                )}
              </div>
              <div className="mt-2.5 mb-1 flex flex-col items-center gap-1.5" style={{ translate: `${x}px 0` }}>
                <span className={cx("skel h-3.5 w-28", active && "skel-live")} />
                <span className={cx("skel h-2.5 w-20", active && "skel-live")} />
              </div>
            </div>
          );
        })}
      </div>
    </ClimbCard>
  );
}

function CreatingEffect({ onReady, signedIn }: { onReady: () => void; signedIn: boolean }) {
  const ran = useRef(false);
  useEffect(() => {
    // Signed-in people skip the name step, so creation starts here.
    if (signedIn && !ran.current) {
      ran.current = true;
      onReady();
    }
  }, [onReady, signedIn]);
  return (
    <section className="flex flex-col items-center pt-12 text-center">
      <Mascot pose="climb" size={140} />
      <h2 className="mt-4 text-[24px] leading-8 text-ink">Setting up your camp…</h2>
    </section>
  );
}

const ORDER: Step[] = ["idea", "draft", "style", "name", "connect"];

function Progress({ step }: { step: Step }) {
  const map: Partial<Record<Step, Step>> = { drafting: "idea", creating: "name" };
  const idx = ORDER.indexOf(map[step] ?? step);
  return (
    <div className="mx-auto mb-8 flex max-w-xl items-center gap-1.5" aria-hidden>
      {ORDER.map((s, i) => (
        <span key={s} className="h-2 flex-1 rounded-full transition-colors duration-500" style={{ background: i <= idx ? "var(--color-coral)" : "var(--color-line)" }} />
      ))}
    </div>
  );
}
