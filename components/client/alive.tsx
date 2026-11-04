"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sizedSet } from "@/lib/shared/art";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

/** Safari and every iPhone browser show see-through HEVC; the others show see-through WebM. */
function seeThroughType() {
  const ua = navigator.userAgent;
  const apple = /iP(hone|ad|od)/.test(ua) || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua));
  return apple ? "mov" : "webm";
}

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The pictures that load at once, the first screen's, are all in. A person's page in a frame isn't waited for, as the
 * page's own load event would. Once they're in it stays so, also across pages, so every loop's check stays cheap.
 */
let allIn = false;
const picturesIn = () => (allIn ||= [...document.querySelectorAll<HTMLImageElement>('img:not([loading="lazy"])')].every((i) => i.complete));

function onPictureDone(changed: () => void) {
  document.addEventListener("load", changed, true);
  document.addEventListener("error", changed, true);
  return () => {
    document.removeEventListener("load", changed, true);
    document.removeEventListener("error", changed, true);
  };
}

/** Whether the first screen's pictures are all in, for anything heavy that should load after them. */
export const useFirstScreenIn = () => useSyncExternalStore(onPictureDone, picturesIn, () => false);

/** Fetches a pose's loop ahead of time, so it starts at once when that pose appears. */
export function warmMascot(pose: string) {
  void fetch(`/art/motion/virgil/${pose}.${seeThroughType()}`).catch(() => {});
}

/**
 * A muted loop over its still. It loads as its spot nears the screen, once the first screen's pictures are in, so it's playing by the time it arrives, plays while it stays near, fades in over
 * the still and never starts under reduced motion. Once it shows it stays, only pausing off screen, so the still never
 * comes back over a frame that has moved. `onShown` says when it starts fading in. With `release` it lets go of the
 * video whenever it's out of sight instead, for a row of many passing by, and `onGone` says so.
 */
function Loop({ src, className, onShown, release, onGone }: { src: () => string; className?: string; onShown?: () => void; release?: boolean; onGone?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const spot = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const [shown, setShown] = useState(false);
  const pictures = useFirstScreenIn();

  useEffect(() => {
    if (calm()) return;
    const el = spot.current!;
    const io = new IntersectionObserver(
      ([e]) => {
        setSeen(e.isIntersecting);
        if (release && !e.isIntersecting) {
          setUrl(null);
          setShown(false);
          onGone?.();
        }
      },
      { rootMargin: "60% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [release, onGone]);

  if (seen && pictures && !url) setUrl(src());

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
export function LiveMascot({ loop, still, size, alt, eager, className, style, release }: { loop: string; still: string; size: number; alt: string; eager?: boolean; className?: string; style?: CSSProperties; release?: boolean }) {
  const [liveLoop, setLiveLoop] = useState<string | null>(null);
  const gone = useCallback(() => setLiveLoop(null), []);
  const set = sizedSet(still);
  return (
    <span className={cx("inline-block shrink-0 select-none", className)} style={{ width: size, height: size, ...style }}>
      <span className="relative block h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={still} srcSet={set} sizes={set && `${size}px`} loading={eager ? undefined : "lazy"} alt={alt} width={size} height={size} className={cx("h-full w-full object-contain transition-opacity duration-0", liveLoop === loop ? "opacity-0 delay-500" : "delay-0")} draggable={false} />
        <Loop key={loop} src={() => `${loop}.${seeThroughType()}`} onShown={() => setLiveLoop(loop)} release={release} onGone={release ? gone : undefined} className="absolute inset-0 h-full w-full object-contain" />
      </span>
    </span>
  );
}

/** The clouds' width for a scene this many device pixels wide: 1200 on a phone, 1600 on a laptop. */
const sceneWidth = (px: number) => (px > 1400 ? 1600 : px > 1000 ? 1200 : 800);

/** A mountain scene's drifting clouds over its still; `className` places the video exactly as the still is placed. */
export function LiveScene({ name, className }: { name: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  return (
    <span ref={box} className="pointer-events-none absolute inset-0">
      <Loop src={() => `/art/motion/scenes/${name}-${sceneWidth((box.current?.offsetWidth ?? 0) * devicePixelRatio)}.mp4`} className={className} />
    </span>
  );
}

/** A challenge cover's loop, playing wherever the cover is on screen. */
export function LiveCover({ stem, className }: { stem: string; className?: string }) {
  return <Loop src={() => `/art/motion/covers/${stem}.mp4`} className={className} />;
}
