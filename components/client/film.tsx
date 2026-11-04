"use client";

import { useRef, useState } from "react";

/** The Misogi film: its poster with a play button until tapped, then the film with sound and its controls. */
export function Film({ src, poster, length }: { src: string; poster: string; length: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  return (
    <div className="relative">
      <div className="relative aspect-video overflow-hidden rounded-[28px] bg-cream-2 shadow-[var(--shadow-float)] ring-1 ring-line">
        <video
          ref={ref}
          src={src}
          poster={poster}
          preload="none"
          playsInline
          controls={started}
          onPlay={() => setStarted(true)}
          className="absolute inset-0 h-full w-full"
        />
      </div>
      {/* The whole poster plays it; the pill hangs on its bottom edge, where it covers no one's face or name. */}
      {!started && (
        <button
          type="button"
          onClick={() => void ref.current?.play()}
          aria-label={`Play the Misogi film, ${length}`}
          className="group absolute inset-0 rounded-[28px]"
        >
          <span className="absolute bottom-0 left-1/2 flex -translate-x-1/2 translate-y-1/2 items-center gap-3 rounded-full bg-white py-1.5 pr-5 pl-1.5 whitespace-nowrap shadow-[var(--shadow-float)] ring-1 ring-line transition duration-200 group-hover:scale-[1.04] group-active:scale-[0.98] sm:py-2 sm:pl-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-coral shadow-[0_3px_0_var(--color-coral-deep)] sm:h-12 sm:w-12">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden className="ml-0.5">
                <path d="M8 5.5v13l10.5-6.5z" fill="white" stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="font-display text-[17px] font-semibold text-ink sm:text-[19px]">Watch the film</span>
            <span className="text-[14px] font-bold text-ink-3">{length}</span>
          </span>
        </button>
      )}
    </div>
  );
}
