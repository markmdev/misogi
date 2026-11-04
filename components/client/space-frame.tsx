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
  // While a tick is still being saved, the frame isn't reloaded: a reload then would start from the value before it.
  const [held, setHeld] = useState<{ key: string; src: string } | null>(null);
  const live = current ? { key: `${current.id}:${reloadKey ?? ""}`, src: `${current.url}?v=${encodeURIComponent(reloadKey ?? "")}` } : null;
  const shown = held ?? live;
  const shownRef = useRef(shown);
  const waiting = useRef<{ id: string; body: string } | null>(null);
  const sending = useRef(0);
  const timer = useRef(0);

  useEffect(() => {
    shownRef.current = shown;
  });

  useEffect(() => {
    // A burst of ticks is saved once, as where they ended up; leaving or hiding the page sends what's still waiting.
    const flush = () => {
      clearTimeout(timer.current);
      const w = waiting.current;
      if (!w) return;
      waiting.current = null;
      sending.current++;
      void fetch(`/api/spaces/${w.id}/marks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: w.body, keepalive: true })
        .catch(() => {})
        .finally(() => {
          sending.current--;
          if (!waiting.current && sending.current === 0) setHeld(null);
        });
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    function onMessage(e: MessageEvent) {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { source?: string; type?: string; height?: number; message?: string; shows?: boolean; id?: string; data?: unknown };
      if (d?.source !== "misogi-space") return;
      if (d.type === "save" && current && d.id === current.id) {
        let body: string;
        try {
          body = JSON.stringify({ data: d.data ?? null });
        } catch {
          return;
        }
        if (body.length > 10_000) return;
        waiting.current = { id: current.id, body };
        setHeld((h) => h ?? shownRef.current);
        clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, 500);
      }
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
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      flush();
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [current]);

  if (!current) {
    return (
      <div className="relative">
        {space.pending ? <Building request={space.pending.request} builder={space.pending.built_by} imaginedBy={space.pending.imagined_by} /> : space.last_failure ? <Failed request={space.last_failure.request} /> : empty}
      </div>
    );
  }

  return (
    <div className="relative">
      {space.pending ? (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-white/80 px-4 py-2.5 text-[14px] font-bold text-ink-2 ring-1 ring-line">
          <Spinner />A new version is being built. It shows up here when it&apos;s ready.
        </div>
      ) : space.last_failure ? (
        <div className="mb-3 rounded-2xl bg-coral-soft px-4 py-2.5 text-[14px] leading-5 font-bold text-coral-deep ring-1 ring-coral/20">
          The newest version didn&apos;t build, so this one stays up.
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[26px] bg-white/50 ring-1 ring-line">
        {!loaded && <div className="h-[420px] animate-pulse bg-cream-2/60" />}
        <iframe
          ref={frame}
          key={shown!.key}
          src={shown!.src}
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

function Failed({ request }: { request: string }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <Mascot pose="think" size={100} alt="" />
      <h3 className="mt-3 text-[19px] text-ink">This page didn&apos;t build</h3>
      <p className="mt-1 max-w-md text-[14px] leading-6 text-ink-2">“{request}”</p>
    </div>
  );
}

function Building({ request, builder, imaginedBy }: { request: string; builder: string | null; imaginedBy: string | null }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <Mascot pose="think" size={100} alt="" />
      <h3 className="mt-3 text-[19px] text-ink">{builder ? `${builder} is building this page…` : "Building this page…"}</h3>
      {imaginedBy ? (
        <div className="mt-1 max-w-md">
          <p className="text-[13px] font-bold text-ink-3">{imaginedBy} imagined:</p>
          <p className="line-clamp-3 text-[14px] leading-6 text-ink-2">{request}</p>
        </div>
      ) : (
        <p className="mt-1 line-clamp-3 max-w-md text-[14px] leading-6 text-ink-2">“{request}”</p>
      )}
      <p className="mt-3 flex items-center gap-2 text-[13px] font-bold text-ink-3">
        <Spinner /> Usually about a minute
      </p>
    </div>
  );
}
