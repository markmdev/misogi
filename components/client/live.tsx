"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Refreshes the page when anything on the challenge changes (an agent logged, a space finished, ...). */
export function LivePulse({ slug, interval = 6000 }: { slug: string; interval?: number }) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/pulse?c=${encodeURIComponent(slug)}`, { cache: "no-store" });
          if (r.ok) {
            const { stamp } = (await r.json()) as { stamp: string | null };
            if (last.current && stamp && stamp !== last.current) router.refresh();
            last.current = stamp;
          }
        } catch {
          /* offline: try again next tick */
        }
      }
      if (!stopped) timer = setTimeout(tick, interval);
    }
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [slug, interval, router]);
  return null;
}
