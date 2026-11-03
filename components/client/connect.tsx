"use client";

import { useEffect, useState, useTransition } from "react";
import { newKeyAction } from "@/app/actions";
import { timeAgo } from "@/lib/shared/format";
import { cx, Icon, Mascot } from "../ui";
import { Spinner } from "./space-frame";

type Status = { agent_kind: string | null; agent_name: string | null; agent_seen_at: string | null };

function useAgentStatus(initial: Status | null, watching: boolean) {
  const [status, setStatus] = useState<Status | null>(initial);
  useEffect(() => {
    if (!watching) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch("/api/me/agent", { cache: "no-store" });
        if (r.ok) setStatus((await r.json()) as Status);
      } catch {
        /* retry */
      }
      if (!stop) timer = setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [watching]);
  return status;
}

function CopyBlock({ text, label = "Copy", mono = false, big = false }: { text: string; label?: string; mono?: boolean; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-2xl bg-white ring-1 ring-line">
      <pre className={cx("overflow-x-auto px-4 py-3.5 pr-24 text-[13.5px] leading-6 whitespace-pre-wrap text-ink", mono ? "font-mono text-[12.5px]" : "font-sans", big && "max-h-72")}>{text}</pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className="btn btn-sm absolute top-2.5 right-2.5 !h-9 !px-3 !text-[14px]"
      >
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}

export function ConnectPanel({
  origin,
  slug,
  title,
  initialKey,
  initialStatus,
}: {
  origin: string;
  slug: string | null;
  title?: string;
  initialKey?: string | null;
  initialStatus: Status | null;
}) {
  const [key, setKey] = useState<string | null>(initialKey ?? null);
  const [tab, setTab] = useState<"muse" | "mcp">("muse");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const status = useAgentStatus(initialStatus, true);
  const connected = status?.agent_seen_at && status.agent_kind && status.agent_kind !== "virgil" && status.agent_kind !== "web";

  const keyText = key ?? "msk_••••••••";
  const museMessage = `Hi! I'm doing a year-long challenge on Misogi and I'd like you to be my guide.

1. Read the guide for AI agents: ${origin}/agent.md
2. My Misogi key is ${keyText}. Save it privately on your computer as the guide shows. Never share it.
3. ${slug ? `Open my challenge "${slug}"${title ? ` (${title})` : ""} with get_challenge` : "List my challenges"}, then ask me your intake questions one at a time.
4. Set up your own recurring check-ins for it, and keep my Misogi page updated as we talk.`;

  const claudeCmd = `claude mcp add --transport http misogi ${origin}/api/mcp --header "Authorization: Bearer ${keyText}"`;
  const urlOnly = `${origin}/api/mcp/u/${keyText}`;

  function makeKey() {
    setError(null);
    start(async () => {
      const r = await newKeyAction();
      if (!r.ok) return setError(r.error);
      setKey(r.data!.key);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cx(
          "flex items-center gap-3 rounded-2xl px-4 py-3 ring-1",
          connected ? "bg-moss-soft text-moss-deep ring-moss/20" : "bg-white text-ink-2 ring-line",
        )}
      >
        {connected ? <Icon name="check" size={30} /> : <Spinner className="text-ink-3" />}
        <div className="text-[14px] leading-5 font-bold">
          {connected ? (
            <>
              Connected{status?.agent_name ? ` to ${status.agent_name}` : ""} · last seen {timeAgo(status!.agent_seen_at)}
            </>
          ) : (
            "Waiting for your AI to say hello…"
          )}
        </div>
      </div>

      {!key && (
        <div className="card flex flex-col items-start gap-3 p-4">
          <p className="text-[14px] leading-6 text-ink-2">
            Your AI needs a key to act for you. Making a new key turns off any old one.
          </p>
          <button className="btn btn-sm" onClick={makeKey} disabled={pending}>
            {pending ? <Spinner /> : <Icon name="key" size={22} />}
            Make my key
          </button>
          {error && <p className="text-[14px] font-bold text-coral-deep">{error}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-cream-2 p-1">
        {(["muse", "mcp"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx("h-10 rounded-xl text-[14px] font-extrabold transition", tab === t ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
          >
            {t === "muse" ? "Muse" : "Claude & other agents"}
          </button>
        ))}
      </div>

      {tab === "muse" ? (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] leading-6 text-ink-2">
            Paste this into your Muse chat. Muse uses its own computer to read the guide, save your key and call Misogi, and its own scheduler for check-ins.
          </p>
          <CopyBlock text={museMessage} label="Copy" big />
          <a href="https://muse.ai" target="_blank" rel="noreferrer" className="btn btn-ink btn-sm w-fit">
            Open Muse
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="label">Claude Code</p>
          <CopyBlock text={claudeCmd} mono />
          <p className="label mt-1">Any MCP client (URL only)</p>
          <CopyBlock text={urlOnly} mono />
          <p className="text-[13px] leading-5 text-ink-3">The URL contains your key. Keep it private. Agents without MCP can follow {origin}/agent.md.</p>
        </div>
      )}
    </div>
  );
}

export function ConnectHero() {
  return (
    <div className="flex items-center gap-3">
      <Mascot pose="wave" size={72} alt="" />
      <div>
        <h2 className="text-[22px] leading-7 text-ink">Bring your own AI</h2>
        <p className="text-[14px] leading-5 text-ink-2">It plans, checks in and keeps your page up to date.</p>
      </div>
    </div>
  );
}
