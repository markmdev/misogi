"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { palette } from "@/lib/shared/theme";
import { virgilLoop } from "@/lib/shared/art";
import { cx, Mascot } from "../ui";
import { LiveMascot, warmMascot } from "./alive";
import { IntentLink } from "./intent-link";

/** In the wheel's order, clockwise from the top. */
const IDEAS: { text: string; icon: string; color: string }[] = [
  { text: "Hold a conversation in Mandarin", icon: "language", color: palette("sky").accent },
  { text: "Cook 52 new meals from scratch", icon: "cooking", color: "var(--color-gold)" },
  { text: "Read 25 books", icon: "books", color: palette("lilac").accent },
  { text: "Visit all 50 states", icon: "travel", color: palette("sand").accent },
  { text: "Build a smart home", icon: "smarthome", color: palette("rose").accent },
  { text: "Run 365 miles", icon: "running", color: palette("mint").accent },
  { text: "Write 52 essays", icon: "writing", color: palette("peach").accent },
  { text: "Learn 20 songs on guitar", icon: "music", color: palette("teal").accent },
];
const N = IDEAS.length;
const SLICE = 360 / N;

type Phase = "idle" | "spinning" | "landed" | "typing" | "going";

/** Marks the line that travels from the home box into the drafting card's title on /start. */
export const LINE = { viewTransitionName: "your-line", viewTransitionClass: "line" } as const;

/** Types each example into the empty box's placeholder, holds it, wipes it and moves on; still under reduced motion. */
function useTypedExample(examples: string[], on: boolean) {
  const [shown, setShown] = useState(examples[0] ?? "");
  // Where the typing is, kept across pauses so it picks up where it stopped: example k, i letters, typing or wiping.
  const at = useRef({ k: 0, i: examples[0]?.length ?? 0, wiping: true });
  useEffect(() => {
    if (!on || examples.length === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const p = at.current;
    let t = 0;
    const step = () => {
      const text = examples[p.k % examples.length];
      if (!p.wiping) {
        p.i++;
        setShown(text.slice(0, p.i));
        if (p.i >= text.length) {
          p.wiping = true;
          return void (t = window.setTimeout(step, 1900));
        }
        return void (t = window.setTimeout(step, 45 + Math.random() * 40));
      }
      p.i = Math.max(0, p.i - 2);
      setShown(text.slice(0, p.i));
      if (p.i > 0) return void (t = window.setTimeout(step, 16));
      p.wiping = false;
      p.k = (p.k + 1) % examples.length;
      t = window.setTimeout(step, 350);
    };
    t = window.setTimeout(step, 1900);
    return () => clearTimeout(t);
  }, [examples, on]);
  return shown;
}

/** A real challenge under the box, with the Muse dressed for it; only Muses with a loop, so every chip moves. */
export type MuseChip = { title: string; muse: string };

/**
 * The home page's box: say your misogi and start the climb, pick an example under it, or let the wheel decide. While
 * it's empty, real challenges from the site type themselves into it.
 */
export function StartBox({ examples, chips }: { examples: string[]; chips: MuseChip[] }) {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [focused, setFocused] = useState(false);
  // What the chosen line comes from (the box or a chip), so only that one travels into the draft.
  const [from, setFrom] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fresh = useMemo(() => examples.filter((t) => !chips.some((c) => c.title === t)), [examples, chips]);
  const example = useTypedExample(fresh, !focused && !idea && phase === "idle");

  function go(text: string) {
    setFrom("box");
    router.push(`/start?idea=${encodeURIComponent(text)}`, { transitionTypes: ["open"] });
  }
  const travels = (source: string) => (from === source ? LINE : undefined);

  function landed(text: string) {
    setPhase("landed");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const later = (f: () => void, ms: number) => (timer.current = window.setTimeout(f, ms));
    let i = 0;
    const type = () => {
      i = calm ? text.length : i + 1;
      setIdea(text.slice(0, i));
      if (i < text.length) return void later(type, 28 + Math.random() * 34);
      later(() => {
        setPhase("going");
        later(() => go(text), 160);
      }, 420);
    };
    later(() => {
      setPhase("typing");
      type();
    }, 650);
  }

  const pose = phase === "idle" ? "wave" : phase === "spinning" ? "think" : "cheer";
  const submit = () => {
    if (idea.trim().length >= 3) go(idea.trim());
    else field.current?.focus();
  };

  return (
    <>
      <Mascot
        key={pose}
        pose={pose}
        size={96}
        eager
        className={cx("absolute -top-[62px] left-1/2 -translate-x-1/2", from && "lg:[view-transition-name:guide]", phase !== "idle" && "animate-pop")}
      />
      <form
        ref={formRef}
        action="/start"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={cx(
          "relative z-10 mt-6 rounded-[24px] bg-paper p-2 text-left ring-[1.5px] shadow-[0_4px_0_var(--color-line-2),0_20px_40px_-24px_rgb(46_42_38/0.45)] transition-[box-shadow,--tw-ring-color] duration-150",
          focused || phase === "typing" || phase === "going" ? "ring-coral shadow-[0_4px_0_var(--color-line-2),0_0_0_5px_var(--color-coral-soft)]" : "ring-line-2",
        )}
      >
        <label htmlFor="idea" className="sr-only">
          Your one hard thing this year
        </label>
        <textarea
          ref={field}
          id="idea"
          name="idea"
          required
          minLength={3}
          maxLength={200}
          rows={2}
          value={idea}
          onChange={(e) => setIdea(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          readOnly={phase !== "idle"}
          style={travels("box")}
          className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[19px] leading-7 font-semibold text-ink outline-none placeholder:text-ink-3 sm:text-[20px]"
          placeholder={phase !== "idle" ? "" : focused ? "Your one hard thing this year" : example}
          autoComplete="off"
        />
        <div className="grid grid-cols-2 gap-2 pt-1 sm:flex sm:justify-end">
          <button
            type="button"
            disabled={phase !== "idle"}
            className="btn btn-ghost group !h-12 !gap-1.5 !px-2.5 !text-[15px] sm:!gap-2 sm:!px-4 sm:!text-[16px]"
            onClick={() => {
              warmMascot("think");
              warmMascot("cheer");
              setPhase("spinning");
            }}
          >
            <MiniWheel className="transition-transform duration-500 ease-out group-hover:rotate-[135deg]" />
            Decide for me
          </button>
          <button className={cx("btn !h-12 !px-3 !text-[15px] sm:!px-5 sm:!text-[16px]", phase === "going" && "btn-pressed")} type="submit">
            Start my climb
          </button>
        </div>
      </form>
      {phase === "idle" ? (
        <div className="muse-chips -mx-4 mt-3 max-[239px]:-mx-3 sm:-mx-10">
          {[0, 1].map((r) => {
            const row = chips.filter((_, i) => i % 2 === r);
            return (
              <div key={r} className="scrollbar-none overflow-x-auto py-1" onFocus={(e) => e.target.matches(":focus-visible") && e.target.scrollIntoView({ block: "nearest", inline: "center" })}>
                {/* Two copies of the row, so it loops without a seam; the second is for the eye only, and goes when nothing moves. A swipe or a key reaches a chip past the edge. */}
                <div className={cx("muse-chips-row flex w-max gap-2 pr-2", r === 1 && "muse-chips-back")} style={{ ["--n" as string]: row.length }}>
                  {[0, 1].map((copy) =>
                    row.map((c) => {
                      const key = `${copy}:${c.title}`;
                      return (
                        <IntentLink
                          key={key}
                          href={`/start?idea=${encodeURIComponent(c.title)}`}
                          transitionTypes={["open"]}
                          onNavigate={() => setFrom(key)}
                          style={travels(key)}
                          aria-hidden={copy === 1 || undefined}
                          tabIndex={copy === 1 ? -1 : undefined}
                          className={cx("chip muse-chip", copy === 1 && "motion-reduce:hidden")}
                        >
                          <LiveMascot loop={`/art/motion/virgils/chip/${virgilLoop(c.muse)}`} still={c.muse} size={36} alt="" release />
                          {c.title}
                        </IntentLink>
                      );
                    }),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Wheel onLanded={landed} scrollFrom={formRef} />
      )}
    </>
  );
}

function wedge(i: number, r: number) {
  const a = ((i * SLICE - SLICE / 2) * Math.PI) / 180;
  const b = ((i * SLICE + SLICE / 2) * Math.PI) / 180;
  return `M0 0L${r * Math.sin(a)} ${-r * Math.cos(a)}A${r} ${r} 0 0 1 ${r * Math.sin(b)} ${-r * Math.cos(b)}Z`;
}

function MiniWheel({ className }: { className?: string }) {
  return (
    <svg viewBox="-12 -12 24 24" width={24} height={24} className={className} aria-hidden>
      <circle r={11.5} fill="white" style={{ stroke: "var(--color-line-2)" }} />
      {IDEAS.map((e, i) => (
        <path key={e.text} d={wedge(i, 9.5)} style={{ fill: `color-mix(in srgb, ${e.color} 75%, white)` }} />
      ))}
      <circle r={3} fill="white" />
    </svg>
  );
}

const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Where a spin is at `t` seconds: a short pull back, a push up to full speed, then a long slow-down to `total`. */
function spinPlan(total: number) {
  const back = 7;
  const tb = 0.3,
    ta = 0.65,
    td = 4.8,
    p = 1.25;
  const vmax = (total + back) / (ta / 2 + td / (p + 1));
  return (t: number) => {
    if (t < tb) {
      const u = t / tb;
      return { angle: -back * (1 - (1 - u) * (1 - u)), speed: (-back * 2 * (1 - u)) / tb };
    }
    if (t < tb + ta) {
      const u = t - tb;
      return { angle: -back + (vmax * u * u) / (2 * ta), speed: (vmax * u) / ta };
    }
    if (t < tb + ta + td) {
      const s = (t - tb - ta) / td;
      return { angle: -back + (vmax * ta) / 2 + (vmax * td * (1 - (1 - s) ** (p + 1))) / (p + 1), speed: vmax * (1 - s) ** p };
    }
    return { angle: total, speed: 0 };
  };
}

const CONFETTI = ["var(--color-coral)", "var(--color-gold)", "var(--color-moss)", "var(--color-sky)", "var(--color-lilac)", palette("rose").accent];

type Bit = { x: number; y: number; vx: number; vy: number; r: number; vr: number; life: number };

function Wheel({ onLanded, scrollFrom }: { onLanded: (text: string) => void; scrollFrom: React.RefObject<HTMLFormElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const rotor = useRef<SVGSVGElement>(null);
  const pointer = useRef<SVGSVGElement>(null);
  const readout = useRef<HTMLParagraphElement>(null);
  const bits = useRef<(HTMLSpanElement | null)[]>([]);
  const [winner, setWinner] = useState<number | null>(null);
  const done = useRef(onLanded);

  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = box.current!;
    const form = scrollFrom.current!;
    // Bring the box and the whole wheel into view together, without hiding the box under the top bar.
    const bottom = el.getBoundingClientRect().bottom + window.scrollY + 40;
    const top = form.getBoundingClientRect().top + window.scrollY - 64 - 20;
    const want = Math.min(bottom - window.innerHeight, top);
    if (want > window.scrollY) window.scrollTo({ top: want, behavior: calm ? "auto" : "smooth" });

    const pick = Math.floor(Math.random() * N);
    const rest = -(pick * SLICE + (Math.random() * 2 - 1) * SLICE * 0.25);
    const at = spinPlan(mod(rest, 360) + 360 * 3);
    const size = el.offsetWidth;
    let raf = 0;
    let start = 0;
    let last = 0;
    let shown = -1;
    let flap = 0;
    let flapV = 0;
    let burst: Bit[] = [];
    let burstAt = 0;

    const show = (angle: number) => {
      rotor.current!.style.transform = `rotate(${angle}deg)`;
      const i = mod(Math.round(-angle / SLICE), N);
      if (i !== shown) {
        shown = i;
        readout.current!.textContent = IDEAS[i].text;
      }
    };

    const land = () => {
      setWinner(pick);
      done.current(IDEAS[pick].text);
      if (calm) return;
      burst = Array.from({ length: bits.current.length }, (_, k) => {
        const a = (-90 + (Math.random() * 2 - 1) * 70) * (Math.PI / 180);
        const v = size * (0.8 + Math.random() * 0.9);
        return { x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 360, vr: (Math.random() * 2 - 1) * 720, life: 1.1 + (k % 5) * 0.12 };
      });
    };

    const frame = (now: number) => {
      if (!start) start = last = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - start) / 1000;
      const { angle, speed } = at(t);
      show(angle);
      rotor.current!.style.filter = speed > 320 ? `blur(${Math.min(1.4, (speed - 320) / 220).toFixed(2)}px)` : "";

      // The pointer rides over the pegs between slices: pushed while one passes under it, then it springs back.
      const o = mod(angle, SLICE) - SLICE / 2;
      const reach = 11;
      let push = 0;
      if (speed > 0 && o > -reach && o < 0) push = -30 * ((o + reach) / reach);
      if (speed < 0 && o < reach && o > 0) push = 30 * ((reach - o) / reach);
      if ((push < 0 && flap > push) || (push > 0 && flap < push)) {
        flap = push;
        flapV = 0;
      } else {
        flapV += (-1500 * flap - 30 * flapV) * dt;
        flap += flapV * dt;
      }
      pointer.current!.style.transform = `rotate(${flap}deg)`;

      if (!burstAt && t > 1 && speed < 5) {
        burstAt = now;
        land();
      }
      if (burstAt) {
        const bt = (now - burstAt) / 1000;
        burst.forEach((b, k) => {
          b.vy += size * 3.4 * dt;
          b.vx *= 1 - 1.6 * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.r += b.vr * dt;
          const s = bits.current[k];
          if (s) {
            s.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.r}deg)`;
            s.style.opacity = String(Math.max(0, Math.min(1, (b.life - bt) / 0.35)));
          }
        });
        if (bt > 1.8 && Math.abs(flap) < 0.05) return;
      }
      raf = requestAnimationFrame(frame);
    };

    if (calm) {
      show(rest);
      land();
      return;
    }
    show(0);
    const wait = setTimeout(() => (raf = requestAnimationFrame(frame)), 520);
    return () => {
      clearTimeout(wait);
      cancelAnimationFrame(raf);
    };
  }, [scrollFrom]);

  return (
    <div className="mt-5 flex animate-rise flex-col items-center">
      <p ref={readout} aria-hidden className={cx("relative z-10 h-7 max-w-full truncate bg-cream px-2 font-display text-[18px] leading-7 font-semibold", winner === null ? "text-ink-3" : "animate-pop text-ink")} />
      <p className="sr-only" aria-live="polite">
        {winner !== null && `The wheel picked: ${IDEAS[winner].text}`}
      </p>
      <div ref={box} className="relative mt-8 aspect-square w-[min(100%,300px)] sm:w-[340px]">
        <div className="absolute inset-0 rounded-full bg-paper ring-1 ring-line" style={{ boxShadow: "0 6px 0 var(--color-line-2), 0 22px 40px -18px rgb(46 42 38 / 0.45)" }} />
        <svg ref={rotor} viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full will-change-transform" aria-hidden>
          {IDEAS.map((e, i) => (
            <path key={e.text} d={wedge(i, 88)} stroke="white" strokeWidth={1.6} strokeLinejoin="round" style={{ fill: `color-mix(in srgb, ${e.color} 40%, white)` }} />
          ))}
          <circle r={83.5} fill="none" stroke="white" strokeOpacity={0.85} strokeWidth={0.9} strokeDasharray="2.2 2.6" />
          {IDEAS.map((e, i) => (
            <g key={e.text} transform={`rotate(${i * SLICE})`}>
              <image href={`/art/icons/${e.icon}.webp`} x={-18} y={-74} width={36} height={36} className={cx(winner === i && "animate-land")} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
              <path d={wedge(0, 88)} fill="white" className="transition-opacity duration-500" opacity={winner !== null && winner !== i ? 0.42 : 0} />
            </g>
          ))}
          {IDEAS.map((e, i) => {
            const a = ((i * SLICE + SLICE / 2) * Math.PI) / 180;
            return <circle key={e.text} cx={93.5 * Math.sin(a)} cy={-93.5 * Math.cos(a)} r={2.7} strokeWidth={0.8} style={{ fill: "var(--color-cream-2)", stroke: "var(--color-line-2)" }} />;
          })}
        </svg>
        {/* Light stays where it is while the wheel turns. */}
        <svg viewBox="-100 -100 200 200" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <radialGradient id="wheel-light" cx="34%" cy="28%" r="80%">
              <stop offset="0%" stopColor="white" stopOpacity={0.4} />
              <stop offset="45%" stopColor="white" stopOpacity={0} />
              <stop offset="88%" stopOpacity={0.02} style={{ stopColor: "var(--color-ink)" }} />
              <stop offset="100%" stopOpacity={0.12} style={{ stopColor: "var(--color-ink)" }} />
            </radialGradient>
          </defs>
          <circle r={88} fill="url(#wheel-light)" />
          <circle r={19} cy={1.8} opacity={0.1} style={{ fill: "var(--color-ink)" }} />
          <circle r={19} fill="white" strokeWidth={1} style={{ stroke: "var(--color-line)" }} />
          <image href="/art/icons/summit.webp" x={-13} y={-14} width={26} height={26} />
        </svg>
        <svg
          ref={pointer}
          viewBox="0 0 40 52"
          className="absolute top-[-8%] left-[44%] h-[15.6%] w-[12%] origin-[50%_30.8%]"
          style={{ filter: "drop-shadow(0 3px 2px rgb(46 42 38 / 0.18))" }}
          aria-hidden
        >
          <path d="M20 51C14 41 6 29 6 17.5A14 14 0 1 1 34 17.5C34 29 26 41 20 51Z" style={{ fill: "var(--color-coral-deep)" }} />
          <path d="M20 48C14 38 6 27 6 16A14 14 0 1 1 34 16C34 27 26 38 20 48Z" style={{ fill: "var(--color-coral)" }} />
          <ellipse cx={13.5} cy={10} rx={4.2} ry={2.6} transform="rotate(-32 13.5 10)" fill="white" opacity={0.5} />
          <circle cx={20} cy={16} r={4.6} strokeOpacity={0.35} style={{ fill: "var(--color-cream)", stroke: "var(--color-coral-deep)" }} />
        </svg>
        <div className="pointer-events-none absolute top-[5%] left-1/2" aria-hidden>
          {CONFETTI.concat(CONFETTI, CONFETTI, CONFETTI).map((c, k) => (
            <span
              key={k}
              ref={(n) => {
                bits.current[k] = n;
              }}
              className={cx("absolute block opacity-0", k % 3 === 0 ? "-mt-[5px] -ml-[5px] h-[10px] w-[10px] rounded-full" : "-mt-[4px] -ml-[7px] h-[8px] w-[14px] rounded-[4px]")}
              style={{ background: c, boxShadow: "inset 0 -2px 0 rgb(0 0 0 / 0.14), inset 0 1.5px 0 rgb(255 255 255 / 0.35)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
