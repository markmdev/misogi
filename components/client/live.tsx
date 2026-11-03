"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui";

type Latest = { id: string; text: string; via: string | null; at: string } | null;

/**
 * Keeps a challenge page live: refreshes when anything changes (an agent logged, a space finished)
 * and shows a small toast for new activity.
 */
export function LivePulse({ slug, interval = 6000 }: { slug: string; interval?: number }) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const lastActivity = useRef<string | null>(null);
  const [toast, setToast] = useState<Latest>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/pulse?c=${encodeURIComponent(slug)}`, { cache: "no-store" });
          if (r.ok) {
            const { stamp, latest } = (await r.json()) as { stamp: string | null; latest: Latest };
            if (last.current && stamp && stamp !== last.current) router.refresh();
            if (lastActivity.current && latest && latest.id !== lastActivity.current) {
              setToast(latest);
              setTimeout(() => setToast((t) => (t?.id === latest.id ? null : t)), 6000);
            }
            last.current = stamp;
            lastActivity.current = latest?.id ?? lastActivity.current ?? "none";
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

  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4" role="status" aria-live="polite">
      <div className="pointer-events-auto flex max-w-md animate-rise items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-[var(--shadow-float)]">
        <Icon name={toast.via ? "orb" : "sparkles"} size={30} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-extrabold">{toast.text}</div>
          {toast.via && <div className="text-[12px] font-bold text-white/70">via {toast.via}</div>}
        </div>
      </div>
    </div>
  );
}
