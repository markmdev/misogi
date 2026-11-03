"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx, Mascot } from "../ui";
import { Sheet } from "./sheet";
import { Spinner } from "./space-frame";

type Step = { name: string; label: string; status: "running" | "ok" | "error"; error?: string };
type Msg = { role: "user" | "assistant"; text: string; steps?: Step[] };

/** Renders the small subset of markdown Virgil uses: paragraphs, **bold**, and "- " lists. */
function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="prose-misogi">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>));
}

const STARTERS = [
  "Walk me through my plan",
  "I did a session today",
  "Make my page feel cozier",
  "I fell behind. Help me adjust",
];

export function Virgil({ signedIn, challenge, thread = "main", autoOpen = false }: { signedIn: boolean; challenge?: string; thread?: string; autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const t = challenge ? `c:${challenge}` : thread;

  useEffect(() => {
    if (!open || loaded || !signedIn) return;
    fetch(`/api/virgil?thread=${encodeURIComponent(t)}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d: { messages: Msg[] }) => setMsgs(d.messages ?? []))
      .finally(() => setLoaded(true));
  }, [open, loaded, signedIn, t]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: message }, { role: "assistant", text: "", steps: [] }]);
    const update = (fn: (last: Msg) => Msg) =>
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = fn(copy[copy.length - 1]);
        return copy;
      });
    try {
      const res = await fetch("/api/virgil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, thread: t, challenge }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        update((l) => ({ ...l, text: err?.error?.message ?? "Virgil couldn't answer right now." }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as { type: string; name?: string; label?: string; ok?: boolean; error?: string; text?: string; message?: string };
          if (e.type === "tool") update((l) => ({ ...l, steps: [...(l.steps ?? []), { name: e.name!, label: e.label!, status: "running" }] }));
          if (e.type === "tool_done")
            update((l) => {
              const steps = [...(l.steps ?? [])];
              const i = steps.map((s) => s.name).lastIndexOf(e.name!);
              if (i >= 0) steps[i] = { ...steps[i], status: e.ok ? "ok" : "error", error: e.error };
              return { ...l, steps };
            });
          if (e.type === "message") update((l) => ({ ...l, text: e.text ?? "" }));
          if (e.type === "error") update((l) => ({ ...l, text: e.message ?? "Something went wrong." }));
          if (e.type === "changed") router.refresh();
        }
      }
    } catch {
      update((l) => ({ ...l, text: l.text || "Lost the connection. Try again." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-40 flex items-center gap-2 rounded-full bg-white py-1.5 pr-4 pl-1.5 shadow-[var(--shadow-float)] ring-1 ring-line transition hover:-translate-y-0.5"
        aria-label="Ask Virgil"
      >
        <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-cream-2">
          <Mascot pose="idle" size={40} alt="" />
        </span>
        <span className="font-display text-[16px] font-semibold text-ink">Ask Virgil</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Virgil" wide>
        {!signedIn ? (
          <div className="flex flex-col items-center py-4 text-center">
            <Mascot pose="wave" size={110} />
            <p className="mt-3 max-w-sm text-[15px] leading-6 text-ink-2">
              I&apos;m Virgil, Misogi&apos;s built-in guide. Start a challenge and I&apos;ll plan it with you, log your progress and build your page.
            </p>
            <Link href="/start" className="btn mt-5">
              Start yours
            </Link>
          </div>
        ) : (
          <div className="flex h-[min(68dvh,620px)] flex-col">
            <div ref={scroller} className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1 pb-2">
              {msgs.length === 0 && (
                <div className="flex flex-col items-center pt-4 text-center">
                  <Mascot pose="wave" size={96} />
                  <p className="mt-2 max-w-sm text-[15px] leading-6 text-ink-2">
                    I can update your plan, log what you did, add quests and rebuild your page. What&apos;s up?
                  </p>
                </div>
              )}
              {msgs.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[15px] leading-6 text-white">{m.text}</div>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-cream-2">
                      <Mascot pose={m.text ? "idle" : "think"} size={30} alt="" />
                    </span>
                    <div className="min-w-0 max-w-[85%]">
                      {(m.steps ?? []).length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {m.steps!.map((s, j) => (
                            <span
                              key={j}
                              title={s.error}
                              className={cx(
                                "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-extrabold ring-1",
                                s.status === "running" && "bg-white text-ink-2 ring-line",
                                s.status === "ok" && "bg-moss-soft text-moss-deep ring-moss/20",
                                s.status === "error" && "bg-coral-soft text-coral-deep ring-coral/20",
                              )}
                            >
                              {s.status === "running" ? <Spinner className="!h-3 !w-3" /> : s.status === "ok" ? "✓" : "!"}
                              {s.label}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.text ? (
                        <div className="rounded-[20px] rounded-bl-md bg-white px-4 py-2.5 text-[15px] leading-6 text-ink ring-1 ring-line">
                          <Rich text={m.text} />
                        </div>
                      ) : (
                        busy &&
                        i === msgs.length - 1 && (
                          <div className="inline-flex items-center gap-1 rounded-[20px] bg-white px-4 py-3 ring-1 ring-line">
                            {[0, 1, 2].map((d) => (
                              <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${d * 120}ms` }} />
                            ))}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
            {msgs.length === 0 && (
              <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-3">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="chip shrink-0 pl-3.5">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form
              className="flex items-end gap-2 border-t border-line pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder="Tell Virgil what happened…"
                className="input h-auto max-h-32 min-h-[52px] flex-1 resize-none py-3.5 leading-6"
              />
              <button className="btn h-[52px] w-[52px] shrink-0 !px-0" disabled={busy || !input.trim()} aria-label="Send">
                {busy ? (
                  <Spinner />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                )}
              </button>
            </form>
            <p className="mt-2 text-center text-[12px] font-bold text-ink-3">
              Prefer your own AI? <Link href="/connect" className="underline decoration-line-2 underline-offset-2 hover:text-ink">Connect Muse</Link>
            </p>
          </div>
        )}
      </Sheet>
    </>
  );
}
