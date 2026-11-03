"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** A bottom sheet on phones and a centered card on wider screens. Closes on Escape or backdrop click. */
export function Sheet({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  // Callers pass a fresh onClose on every render; keep the latest in a ref so typing inside the sheet
  // doesn't re-run the open/close effect (which would steal focus on each keystroke).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => {
      const p = panel.current;
      // Prefer the first text field; fall back to the first button (the close button) for read-only sheets.
      (p?.querySelector<HTMLElement>("textarea, input:not([type=hidden])") ?? p?.querySelector<HTMLElement>("button"))?.focus();
    }, 30);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div
        ref={panel}
        className={`relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] bg-cream p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[var(--shadow-float)] sm:rounded-[28px] sm:p-6 ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
        style={{ animation: "rise .28s cubic-bezier(.2,.8,.2,1) both" }}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-2 sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[20px] leading-7 text-ink">{title}</h2>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-white text-ink-2 ring-1 ring-line hover:text-ink" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
