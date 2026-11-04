"use client";

import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 14;
const EDGE = 12;

type Spot = { left: number; top?: number; bottom?: number; thread: number; side: "below" | "above" };

/**
 * The word misogi, marked with a stitched underline. A mouse resting on it, or a tap, hangs a felt tag from it on a
 * thread that explains the word. `side` is where the tag prefers to hang; it flips when there isn't room.
 */
export function MisogiWord({ children = "misogi", side = "below" }: { children?: ReactNode; side?: "below" | "above" }) {
  const id = useId();
  const word = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<Spot | null>(null);

  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const hold = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  const place = useCallback(() => {
    const w = word.current, c = card.current;
    if (!w || !c) return;
    const r = w.getBoundingClientRect();
    const width = c.offsetWidth, height = c.offsetHeight;
    const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, EDGE), innerWidth - width - EDGE);
    const thread = r.left + r.width / 2 - left;
    const fitsBelow = r.bottom + GAP + height < innerHeight - EDGE;
    const fitsAbove = r.top - GAP - height > EDGE;
    const s = side === "above" ? (fitsAbove || !fitsBelow ? "above" : "below") : fitsBelow || !fitsAbove ? "below" : "above";
    setSpot(s === "below" ? { left, top: r.bottom + GAP, thread, side: s } : { left, bottom: innerHeight - r.top + GAP, thread, side: s });
  }, [side]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!word.current?.contains(t) && !card.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        word.current?.focus();
      }
    };
    addEventListener("pointerdown", away, true);
    addEventListener("keydown", key);
    addEventListener("scroll", place, true);
    addEventListener("resize", place);
    return () => {
      removeEventListener("pointerdown", away, true);
      removeEventListener("keydown", key);
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => () => hold(), []);

  const mouse = (e: React.PointerEvent) => e.pointerType === "mouse";

  return (
    <>
      <button
        ref={word}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={(e) => mouse(e) && later(() => setOpen(true), 140)}
        onPointerLeave={(e) => mouse(e) && later(() => setOpen(false), 220)}
        onClick={() => setOpen((o) => !o)}
        className="misogi-word inline cursor-help rounded-[4px] p-0 [font:inherit] [color:inherit] [letter-spacing:inherit]"
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={card}
            id={id}
            role="dialog"
            aria-label="What misogi means"
            onPointerEnter={(e) => mouse(e) && hold()}
            onPointerLeave={(e) => mouse(e) && later(() => setOpen(false), 220)}
            className="fixed z-[60] w-[min(310px,calc(100vw-24px))]"
            style={{
              left: spot?.left ?? -9999,
              top: spot?.top,
              bottom: spot?.bottom,
              visibility: spot ? "visible" : "hidden",
            }}
          >
            <div
              key={spot?.side ?? "measuring"}
              className={spot ? (spot.side === "below" ? "misogi-tag-hang" : "misogi-tag-float") : "relative"}
              style={spot ? { transformOrigin: `${spot.thread}px ${spot.side === "below" ? `-${GAP}px` : `calc(100% + ${GAP}px)`}` } : undefined}
            >
              {spot && (
                <>
                  <span
                    aria-hidden
                    className="absolute h-[14px] border-l-2 border-dashed border-ink-3/60"
                    style={{ left: spot.thread - 1, ...(spot.side === "below" ? { top: -GAP } : { bottom: -GAP }) }}
                  />
                  <span
                    aria-hidden
                    className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cream-2 ring-1 ring-line"
                    style={{ left: spot.thread, ...(spot.side === "below" ? { top: -4 } : { bottom: -4 }) }}
                  />
                </>
              )}
              <Meaning />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Meaning() {
  const calm = typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="relative rounded-[22px] bg-white p-3.5 pb-4 text-left shadow-[var(--shadow-float)] ring-1 ring-line">
      <div className="flex items-center gap-3">
        <span className="relative block h-[88px] w-[88px] shrink-0 overflow-hidden rounded-[16px] bg-cream-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/misogi-falls.webp" alt="" className="absolute inset-0 h-full w-full object-cover" />
          {!calm && <video src="/art/motion/misogi-falls.mp4" muted loop playsInline autoPlay className="absolute inset-0 h-full w-full object-cover" />}
        </span>
        <div className="min-w-0">
          <p className="font-display text-[24px] leading-7 font-semibold text-ink">mi·so·gi</p>
          <p className="text-[13px] font-bold text-ink-3">(mee-soh-gee)</p>
        </div>
      </div>
      <p className="mt-3 text-[14px] leading-[21px] text-ink-2">
        A Japanese purification ritual, once done under icy waterfalls. Today: one challenge a year, so hard it changes the other 364 days.
      </p>
      <p className="mt-2.5 rounded-[14px] bg-cream-2 px-3 py-2 text-[14px] leading-5 text-ink">
        <b className="font-extrabold">Two rules:</b> make it really hard. Don&apos;t die.
      </p>
    </div>
  );
}
