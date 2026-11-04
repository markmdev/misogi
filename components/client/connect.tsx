"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
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

/** Shows a key or connect code as its last four characters, so a screenshot can't use it; Copy still copies the whole text. */
function CopyBlock({ text, secret, label = "Copy", mono = false, big = false }: { text: string; secret?: string | null; label?: string; mono?: boolean; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  const parts = secret ? text.split(secret) : [text];
  return (
    <div className="relative rounded-2xl bg-white ring-1 ring-line">
      <pre className={cx("overflow-x-auto px-4 py-3.5 pr-24 text-[13.5px] leading-6 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]", mono ? "font-mono text-[12.5px]" : "font-sans", big && "max-h-72")}>
        {parts.map((p, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span title="Copy adds the whole thing" className="rounded-md bg-cream-2 px-1.5 py-0.5 font-mono text-[0.92em] whitespace-nowrap text-ink-2 ring-1 ring-line">
                {secret!.startsWith("msk_") ? "msk_" : ""}••••{secret!.slice(-4)}
              </span>
            )}
            {p}
          </Fragment>
        ))}
      </pre>
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
  title,
  connectCode,
  initialKey,
  initialStatus,
  hasKey = false,
}: {
  origin: string;
  title?: string;
  /** Names this account in the Muse message, so Muse signs in to it with one tap. */
  connectCode: string;
  initialKey?: string | null;
  initialStatus: Status | null;
  /** The person already made a key (its text can't be shown again). */
  hasKey?: boolean;
}) {
  const [key, setKey] = useState<string | null>(initialKey ?? null);
  const [tab, setTab] = useState<"muse" | "mcp">("muse");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const status = useAgentStatus(initialStatus, true);
  const connected = status?.agent_seen_at && status.agent_kind && status.agent_kind !== "virgil" && status.agent_kind !== "web";

  const keyText = key ?? "msk_••••••••";
  const museMessage = `Hi! I'm climbing ${title ? `“${title}”` : "a challenge"} on Misogi this year, and I'd like you to be my coach.

Connect to my Misogi here, it shows you how: ${origin}/hi/${connectCode}

Then ask me your first question.`;

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
      {connected ? (
        <div className="flex animate-rise items-center gap-3.5 rounded-2xl bg-moss-soft px-4 py-3.5 ring-1 ring-moss/20">
          <Icon name="check" size={40} className="animate-pop [animation-delay:150ms]" />
          <div className="min-w-0">
            <div className="font-display text-[18px] leading-6 font-semibold text-moss-deep">
              {status.agent_kind === "muse" ? (status.agent_name && status.agent_name.toLowerCase() !== "muse" ? `${status.agent_name} is your Muse` : "Your Muse is connected") : status.agent_name ? `${status.agent_name} is your coach` : "Your AI is connected"}
            </div>
            <div className="text-[13px] leading-5 font-bold text-moss-deep/75">
              Last seen {timeAgo(status.agent_seen_at)}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-ink-2 ring-1 ring-line">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-coral opacity-60" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-coral" />
          </span>
          <div className="text-[14px] leading-5 font-bold">Not connected yet. This turns green when Muse says hello.</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-cream-2 p-1">
        {(["muse", "mcp"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx("h-10 rounded-xl text-[14px] font-extrabold transition", tab === t ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
          >
            {t === "muse" ? "Muse" : "Claude & other AIs"}
          </button>
        ))}
      </div>

      {tab === "muse" ? (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] leading-6 text-ink-2">Copy this and send it to Muse. It connects and sets up your check-ins by itself.</p>
          <CopyBlock text={museMessage} secret={connectCode} label="Copy" big />
          <p className="text-[13px] leading-5 text-ink-3">
            When Muse asks, tap <b>Always allow</b> for {new URL(origin).host}, then <b>Connect</b> on its card, and <b>Connect</b> again in the window it opens.
          </p>
          <a href="https://muse.ai" target="_blank" rel="noreferrer" className="btn btn-ink btn-sm w-fit">
            Open Muse
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {!key && (
            <div className="card flex flex-col items-start gap-3 p-4">
              <p className="text-[14px] leading-6 text-ink-2">
                {hasKey
                  ? "Already set up? You're done. Lost your key? Make a new one: the old key, and any AI connected before, stop working."
                  : "Your AI needs a key to act for you."}
              </p>
              <button className={hasKey ? "btn btn-sm btn-ghost" : "btn btn-sm"} onClick={makeKey} disabled={pending}>
                {pending ? <Spinner /> : <Icon name="key" size={22} />}
                {hasKey ? "Make a new key" : "Make my key"}
              </button>
              {error && <p className="text-[14px] font-bold text-coral-deep">{error}</p>}
            </div>
          )}
          <p className="label">Claude Code</p>
          <CopyBlock text={claudeCmd} secret={key} mono />
          <p className="label mt-1">Any MCP client (URL only)</p>
          <CopyBlock text={urlOnly} secret={key} mono />
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
