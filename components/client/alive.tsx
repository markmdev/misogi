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
 * A muted loop over its still. It loads as its spot nears the screen, so it's playing by the time it arrives, plays while it stays near, fades in over
 * the still and never starts under reduced motion. Once it shows it stays, only pausing off screen, so the still never
 * comes back over a frame that has moved. `onShown` says when it starts fading in.
 */
function Loop({ src, className, onShown }: { src: () => string; className?: string; onShown?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const spot = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (calm()) return;
    const el = spot.current!;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { rootMargin: "60% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (seen && !url) setUrl(src());

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (seen) void v.play().catch(() => {});
    else v.pause();
  }, [seen, url]);

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
          onPlaying={() => {
            setShown(true);
            onShown?.();
          }}
          className={cx("transition-[opacity,transform] duration-500", shown ? "opacity-100" : "opacity-0", className)}
        />
      )}
    </span>
  );
}

/**
 * Virgil: his still until his loop has faded in over it, then only the loop, so he never shows twice.
 * `loop` is the loop's address without its ending: a pose's, or a dressed Virgil's own.
 */
export function LiveMascot({ loop, still, size, alt, className, style }: { loop: string; still: string; size: number; alt: string; className?: string; style?: CSSProperties }) {
  const [liveLoop, setLiveLoop] = useState<string | null>(null);
  return (
    <span className={cx("inline-block shrink-0 select-none", className)} style={{ width: size, height: size, ...style }}>
      <span className="relative block h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={still} alt={alt} width={size} height={size} className={cx("h-full w-full object-contain transition-opacity duration-0", liveLoop === loop ? "opacity-0 delay-500" : "delay-0")} draggable={false} />
        <Loop key={loop} src={() => `${loop}.${seeThroughType()}`} onShown={() => setLiveLoop(loop)} className="absolute inset-0 h-full w-full object-contain" />
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

/** A challenge cover's loop, playing wherever the cover is on screen. */
export function LiveCover({ stem, className }: { stem: string; className?: string }) {
  return <Loop src={() => `/art/motion/covers/${stem}.mp4`} className={className} />;
}
