"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../ui";

// True once a live page has been checked for changes, so what mounts after that arrived with a refresh.
let settled = false;

type Latest = { id: string; text: string; via: string | null; at: string } | null;

/**
 * Keeps a challenge page live: refreshes when anything changes (an agent logged, a space finished)
 * and shows a small toast for new activity.
 */
export function LivePulse({ slug, stamp, interval = 6000 }: { slug: string; stamp: string; interval?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  // The page's own stamp, so a page loaded ahead of a tap (and changed since) refreshes on the first check.
  const last = useRef<string | null>(stamp);
  const lastActivity = useRef<string | null>(null);
  const [toast, setToast] = useState<Latest>(null);

  useLayoutEffect(() => {
    settled = false;
    return () => {
      settled = false;
    };
  }, [pathname]);

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
            settled = true;
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

/**
 * Wraps something that can change while the page is open. When it first appears after a live refresh
 * (a new log, a finished quest, a changed number: key it by what changed), it rises in and glows once,
 * or plays `arrive` instead.
 */
export function Fresh({ children, className, arrive = "animate-fresh" }: { children: ReactNode; className?: string; arrive?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (settled) ref.current?.classList.add(arrive);
  }, [arrive]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
