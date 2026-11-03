"use client";

import { useEffect, useRef, useState } from "react";
import type { SpaceStatus } from "@/lib/shared/types";
import { Mascot } from "../ui";

/**
 * Shows a generated space in a locked-down iframe. The page inside can't reach this one;
 * it can only tell us its height and whether it crashed.
 */
export function SpaceFrame({ space, title, reloadKey, empty }: { space: SpaceStatus; title: string; reloadKey?: string; empty: React.ReactNode }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(560);
  const [loaded, setLoaded] = useState(false);
  const current = space.current;

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { source?: string; type?: string; height?: number; message?: string; shows?: boolean; id?: string };
      if (d?.source !== "misogi-space") return;
      if (d.type === "height" && typeof d.height === "number") setHeight(Math.min(Math.max(d.height, 240), 6000));
      if (d.type === "error" && current && d.id === current.id) {
        void fetch(`/api/spaces/${current.id}/error`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: d.message, shows: d.shows === true }),
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [current]);

  if (!current) {
    return (
      <div className="relative">
        {space.pending ? <Building request={space.pending.request} /> : empty}
      </div>
    );
  }

  return (
    <div className="relative">
      {space.pending && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-white/80 px-4 py-2.5 text-[14px] font-bold text-ink-2 ring-1 ring-line">
          <Spinner />A new version is being built. It shows up here when it&apos;s ready.
        </div>
      )}
      <div className="overflow-hidden rounded-[26px] bg-white/50 ring-1 ring-line">
        {!loaded && <div className="h-[420px] animate-pulse bg-cream-2/60" />}
        <iframe
          ref={frame}
          key={`${current.id}:${reloadKey ?? ""}`}
          src={`${current.url}?v=${encodeURIComponent(reloadKey ?? "")}`}
          title={title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className="block w-full border-0"
          style={{ height: loaded ? height : 0 }}
        />
      </div>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-block h-4 w-4 animate-spin rounded-full border-[2.5px] border-current border-t-transparent ${className}`} aria-hidden />
  );
}

function Building({ request }: { request: string }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <Mascot pose="think" size={100} className="animate-bob" alt="" />
      <h3 className="mt-3 text-[19px] text-ink">Building this space…</h3>
      <p className="mt-1 max-w-md text-[14px] leading-6 text-ink-2">“{request}”</p>
      <p className="mt-3 flex items-center gap-2 text-[13px] font-bold text-ink-3">
        <Spinner /> Usually about a minute
      </p>
    </div>
  );
}
