"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

/** Safari and every iPhone browser show see-through HEVC; the others show see-through WebM. */
function seeThroughType() {
  const ua = navigator.userAgent;
  const apple = /iP(hone|ad|od)/.test(ua) || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua));
  return apple ? "mov" : "webm";
}

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fetches a pose's loop ahead of time, so it starts at once when that pose appears. */
export function warmMascot(pose: string) {
  void fetch(`/art/motion/virgil/${pose}.${seeThroughType()}`).catch(() => {});
}

/**
 * A muted loop laid over its still. It loads only once its spot is on screen, plays while it stays there
 * (and, with `onlyWhen`, only while that's true), fades in over the still, and never starts under reduced motion.
 */
function Loop({ src, className, style, onlyWhen = true }: { src: () => string; className?: string; style?: CSSProperties; onlyWhen?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const spot = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (calm()) return;
    const el = spot.current!;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const on = seen && onlyWhen;
  if (on && !url) setUrl(src());

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (on) {
      // Starts over from the still each time it comes back, so the still never jumps to a mid-loop frame.
      v.currentTime = 0;
      void v.play().catch(() => {});
    } else v.pause();
  }, [on, url]);

  return (
    <span ref={spot} className="pointer-events-none absolute inset-0" aria-hidden>
      {url && (
        <video
          ref={ref}
          src={url}
          muted
          loop
          playsInline
          autoPlay
          onPlaying={() => setShown(true)}
          className={cx("transition-[opacity,transform] duration-500", on && shown ? "opacity-100" : "opacity-0", className)}
          style={style}
        />
      )}
    </span>
  );
}

/** Virgil: his still, with his loop for that pose playing over it. */
export function LiveMascot({ pose, still, size, alt, className, style }: { pose: string; still: string; size: number; alt: string; className?: string; style?: CSSProperties }) {
  return (
    <span className={cx("inline-block shrink-0 select-none", className)} style={{ width: size, height: size, ...style }}>
      <span className="relative block h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={still} alt={alt} width={size} height={size} className="h-full w-full object-contain" draggable={false} />
        <Loop key={pose} src={() => `/art/motion/virgil/${pose}.${seeThroughType()}`} className="absolute inset-0 h-full w-full object-contain" />
      </span>
    </span>
  );
}

/** A mountain scene's drifting clouds over its still; `className` places the video exactly as the still is placed. */
export function LiveScene({ name, className }: { name: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  return (
    <span ref={box} className="pointer-events-none absolute inset-0">
      <Loop src={() => `/art/motion/scenes/${name}-${(box.current?.offsetWidth ?? 0) * devicePixelRatio > 1000 ? 1600 : 800}.mp4`} className={className} />
    </span>
  );
}

/**
 * A challenge cover's loop. With a mouse it plays while the card is hovered or focused; on a touch screen,
 * while the card crosses the middle of the window, so one card moves at a time as you scroll.
 */
export function LiveCover({ stem, className }: { stem: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const card = box.current!.closest("a") ?? box.current!;
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const on = () => setActive(true);
      const off = () => setActive(false);
      card.addEventListener("pointerenter", on);
      card.addEventListener("pointerleave", off);
      card.addEventListener("focusin", on);
      card.addEventListener("focusout", off);
      return () => {
        card.removeEventListener("pointerenter", on);
        card.removeEventListener("pointerleave", off);
        card.removeEventListener("focusin", on);
        card.removeEventListener("focusout", off);
      };
    }
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { rootMargin: "-45% 0px -45% 0px" });
    io.observe(card);
    return () => io.disconnect();
  }, []);

  return (
    <span ref={box} className="pointer-events-none absolute inset-0">
      <Loop src={() => `/art/motion/covers/${stem}.mp4`} onlyWhen={active} className={className} />
    </span>
  );
}
