"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { startChallenge } from "@/app/actions";
import { shortDate, withUnit } from "@/lib/shared/format";
import { palette } from "@/lib/shared/theme";
import type { Theme } from "@/lib/shared/types";
import { cx, Icon, IconTile, Mascot } from "../ui";
import { ConnectPanel } from "./connect";
import { Spinner } from "./space-frame";

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
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [choices, setChoices] = useState<("gentle" | "firm")[]>([]);
  const [name, setName] = useState(signedInName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; key: string; handle: string } | null>(null);
  const [line, setLine] = useState(0);
  const [, start] = useTransition();
  const started = useRef(false);

  async function runDraft(text: string) {
    setError(null);
    setStep("drafting");
    setLine(0);
    setPairs(null);
    try {
      const r = await fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idea: text, timezone: tz() }) });
      const d = (await r.json()) as { draft?: Draft; error?: { message: string } };
      if (!r.ok || !d.draft) throw new Error(d.error?.message ?? "Couldn't draft that. Try again.");
      setDraft(d.draft);
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

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 pb-24">
      <Progress step={step} />

      {step === "idea" && (
        <section className="animate-rise">
          <div className="flex flex-col items-center text-center">
            <Mascot pose="wave" size={110} className="animate-bob" />
            <h1 className="mt-2 text-[30px] leading-9 text-ink">What&apos;s your misogi?</h1>
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
        <section className="flex flex-col items-center pt-10 text-center">
          <Mascot pose="think" size={140} className="animate-bob" />
          <h2 className="mt-4 text-[24px] leading-8 text-ink">Drafting your year</h2>
          <p className="mt-2 text-[16px] font-bold text-ink-2" aria-live="polite">
            {DRAFTING_LINES[line]}
          </p>
          <p className="mt-6 max-w-sm text-[14px] leading-6 text-ink-3">“{idea}”</p>
        </section>
      )}

      {step === "draft" && draft && (
        <section className="animate-rise">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-4 p-5" style={{ background: pal.tint }}>
              <IconTile name={draft.icon} size={64} bg="#fff" />
              <div className="min-w-0">
                <div className="label" style={{ color: pal.deep }}>
                  Your misogi
                </div>
                <textarea
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, " ").slice(0, 60) })}
                  rows={draft.title.length > 26 ? 2 : 1}
                  className="mt-0.5 w-full resize-none bg-transparent font-display text-[22px] leading-7 font-semibold text-ink outline-none"
                  aria-label="Challenge title"
                />
                <p className="mt-0.5 text-[14px] leading-5 text-ink-2">{draft.tagline}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-line">
              <div className="bg-white p-4">
                <div className="label">Measured by</div>
                <div className="mt-1 text-[15px] font-extrabold text-ink first-letter:uppercase">{draft.metric.name}</div>
              </div>
              <div className="bg-white p-4">
                <div className="label">Summit</div>
                <div className="mt-1 text-[15px] font-extrabold text-ink">
                  {draft.metric.target != null ? withUnit(draft.metric.target, draft.metric.unit) : "Your call"}
                </div>
              </div>
            </div>
          </div>

          <h3 className="mt-7 mb-3 text-[18px] text-ink">Camps on the way up</h3>
          <ol className="relative flex flex-col gap-3 pl-7">
            <span className="absolute top-3 bottom-3 left-[13px] w-[3px] rounded-full" style={{ background: pal.tint }} />
            {draft.camps.map((c, i) => (
              <li key={i} className="relative">
                <span
                  className="absolute top-4 -left-7 grid h-7 w-7 place-items-center rounded-full font-display text-[13px] font-semibold text-white"
                  style={{ background: i === draft.camps.length - 1 ? pal.deep : pal.accent }}
                >
                  {i + 1}
                </span>
                <div className="card flex items-center gap-3 p-3">
                  <IconTile name={c.icon} size={44} bg={pal.tint} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] leading-5 font-extrabold text-ink">{c.title}</div>
                    <div className="mt-0.5 text-[13px] leading-5 text-ink-2">{c.detail}</div>
                  </div>
                  <div className="shrink-0 text-right text-[12px] font-extrabold text-ink-3">
                    {c.target != null && <div className="text-ink-2">{withUnit(c.target, draft.metric.unit)}</div>}
                    {shortDate(c.due_on)}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <h3 className="mt-7 mb-3 text-[18px] text-ink">This week</h3>
          <div className="flex flex-col gap-2">
            {draft.first_quests.map((q, i) => (
              <div key={i} className="flex items-center gap-3 rounded-[18px] bg-white p-3 ring-1 ring-line" style={{ boxShadow: "0 3px 0 var(--color-line)" }}>
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
          <p className="mt-5 rounded-2xl bg-white/70 px-4 py-3 text-[14px] leading-6 text-ink-2 ring-1 ring-line">
            This is a first draft. Your AI tunes it to your life after a short chat.
          </p>
          <div className="mt-6 flex gap-3">
            <button className="btn btn-ghost flex-1" onClick={() => void runDraft(idea)}>
              Try again
            </button>
            <button className="btn flex-[2]" onClick={() => setStep("style")}>
              Looks good
            </button>
          </div>
        </section>
      )}

      {step === "style" && (
        <section className="animate-rise">
          <div className="text-center">
            <h2 className="text-[26px] leading-8 text-ink">How should your guide talk to you?</h2>
            <p className="mt-2 text-[15px] text-ink-2">Pick the message you&apos;d rather get.</p>
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
                          "rounded-[20px] p-4 text-left text-[15px] leading-6 ring-2 transition",
                          choices[i] === k ? "bg-white text-ink shadow-[var(--shadow-card)]" : "bg-white/60 text-ink-2 ring-transparent hover:bg-white",
                        )}
                        style={choices[i] === k ? { ["--tw-ring-color" as string]: pal.accent } : undefined}
                      >
                        “{p[k]}”
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
              Now bring your AI. It reads your plan, asks a few questions, and keeps your page up to date from now on.
            </p>
          </div>
          <div className="mt-6">
            <ConnectPanel origin={origin} slug={created.slug} title={draft?.title} initialKey={created.key} initialStatus={null} />
          </div>
          <button className="btn btn-moss mt-6 w-full" onClick={() => router.push(`/c/${created.slug}/${created.handle}`)}>
            See my page
          </button>
          <p className="mt-3 text-center text-[13px] text-ink-3">
            No AI handy? Tap <b>Ask Virgil</b> on your page and Misogi&apos;s own guide takes it from there.
          </p>
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
      <Mascot pose="climb" size={140} className="animate-bob" />
      <h2 className="mt-4 text-[24px] leading-8 text-ink">Setting up your camp…</h2>
    </section>
  );
}

const ORDER: Step[] = ["idea", "draft", "style", "name", "connect"];

function Progress({ step }: { step: Step }) {
  const map: Partial<Record<Step, Step>> = { drafting: "idea", creating: "name" };
  const idx = ORDER.indexOf(map[step] ?? step);
  return (
    <div className="mb-8 flex items-center gap-1.5" aria-hidden>
      {ORDER.map((s, i) => (
        <span key={s} className="h-2 flex-1 rounded-full transition-colors duration-500" style={{ background: i <= idx ? "var(--color-coral)" : "var(--color-line)" }} />
      ))}
    </div>
  );
}
