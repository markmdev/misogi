import type { CSSProperties, ReactNode } from "react";
import { ICONS, MASCOT, sizedSet, virgilLoop } from "@/lib/shared/art";
import { LiveMascot } from "./client/alive";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Pictures load as they near the screen, at the size they're drawn. `eager` is for the few a visitor sees
 * on arriving or on their first scroll, so those never show a gap.
 */
function Picture({ src, size, eager, alt, className, style }: { src: string; size: number; eager?: boolean; alt: string; className?: string; style?: CSSProperties }) {
  const set = sizedSet(src);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} srcSet={set} sizes={set && `${size}px`} width={size} height={size} loading={eager ? undefined : "lazy"} alt={alt} className={className} style={style} draggable={false} />
  );
}

export function Icon({ name, size = 40, className, alt = "", eager }: { name: string; size?: number; className?: string; alt?: string; eager?: boolean }) {
  const src = (ICONS as Record<string, string>)[name] ?? ICONS.summit;
  return <Picture src={src} size={size} eager={eager} alt={alt} className={cx("select-none object-contain", className)} />;
}

export function Mascot({
  pose = "idle",
  size = 120,
  className,
  alt = "Misogi's little felt mountain",
  style,
  src,
  eager,
}: {
  pose?: string;
  /** A picture of him to show instead of the pose, such as Virgil dressed for a challenge. */
  src?: string | null;
  size?: number;
  className?: string;
  alt?: string;
  style?: CSSProperties;
  eager?: boolean;
}) {
  const known = pose in MASCOT ? pose : "idle";
  const still = src ?? (MASCOT as Record<string, string>)[known];
  const dressed = src ? virgilLoop(src) : null;
  const loop = src ? dressed && `/art/motion/virgils/${dressed}` : `/art/motion/virgil/${known}`;
  // Small Virgils (the chat button, avatars beside each chat message) stay still, so a list never twitches,
  // and so does a dressed Virgil until his loop is made.
  if (size < 48 || !loop) {
    return <Picture src={still} size={size} eager={eager} alt={alt} style={style} className={cx("select-none object-contain", className)} />;
  }
  return <LiveMascot loop={loop} still={still} size={size} alt={alt} eager={eager} className={className} style={style} />;
}

/** Icon on a soft rounded tile, like an app's settings row. */
export function IconTile({ name, size = 44, bg = "var(--color-cream-2)", className, eager }: { name: string; size?: number; bg?: string; className?: string; eager?: boolean }) {
  return (
    <span className={cx("tile shrink-0", className)} style={{ width: size, height: size, background: bg }}>
      <Icon name={name} size={Math.round(size * 0.72)} eager={eager} />
    </span>
  );
}

const AVATAR_COLORS: Record<string, [string, string]> = {
  sky: ["#D3E6F9", "#2C6FB3"],
  mint: ["#D7EFD3", "#2E8B52"],
  peach: ["#FFD9C9", "#C2502F"],
  lilac: ["#E2D9F6", "#674EB2"],
  sand: ["#F6E2C3", "#9A6418"],
  rose: ["#F9D9E3", "#B0425F"],
};

export function Avatar({ name, color, size = 40, className, ring }: { name: string; color: string; size?: number; className?: string; ring?: boolean }) {
  const [bg, fg] = AVATAR_COLORS[color] ?? AVATAR_COLORS.sky;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cx("inline-grid shrink-0 place-items-center rounded-full font-display font-semibold", ring && "ring-[3px] ring-white", className)}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

export function ProgressBar({
  value,
  color = "var(--color-moss)",
  height = 12,
  track = "var(--color-line)",
  className,
  children,
}: {
  value: number;
  color?: string;
  height?: number;
  track?: string;
  className?: string;
  children?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cx("relative w-full overflow-hidden rounded-full", className)} style={{ height, background: track }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%`, background: color, minWidth: pct > 0 ? height : 0, boxShadow: "inset 0 -2px 0 rgb(0 0 0 / 0.12)" }}
      />
      {pct > 0 && pct < 100 && (
        <div className="absolute top-[3px] h-[3px] rounded-full bg-white/45" style={{ left: 6, width: `calc(${pct}% - 14px)` }} />
      )}
      {children && <div className="absolute inset-0 grid place-items-center text-[11px] font-extrabold text-ink">{children}</div>}
    </div>
  );
}

export function Ring({ value, size = 72, stroke = 9, color = "var(--color-moss)", track = "var(--color-line)", children }: { value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Pill({ children, tone = "cream", className, style }: { children: ReactNode; tone?: "cream" | "moss" | "coral" | "gold" | "ink" | "white"; className?: string; style?: CSSProperties }) {
  const tones = {
    cream: "bg-cream-2 text-ink-2",
    moss: "bg-moss-soft text-moss-deep",
    coral: "bg-coral-soft text-coral-deep",
    gold: "bg-gold-soft text-gold-deep",
    ink: "bg-ink text-white",
    white: "bg-white/90 text-ink shadow-sm",
  } as const;
  return (
    <span className={cx("inline-flex min-h-7 items-center gap-1.5 rounded-[14px] px-2.5 py-1 text-[13px] leading-5 font-extrabold text-balance", tones[tone], className)} style={style}>
      {children}
    </span>
  );
}

export function SectionTitle({ title, action, icon, className }: { title: string; action?: ReactNode; icon?: string; className?: string }) {
  return (
    <div className={cx("mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5", className)}>
      <h2 className="flex items-center gap-2 text-[20px] leading-7 text-ink">
        {icon && <Icon name={icon} size={28} />}
        {title}
      </h2>
      {action}
    </div>
  );
}

export function Stat({ icon, value, label, tint = "var(--color-cream-2)" }: { icon: string; value: ReactNode; label: string; tint?: string }) {
  return (
    <div className="card flex items-center gap-3 p-3 pr-4">
      <IconTile name={icon} size={44} bg={tint} />
      <div className="min-w-0">
        <div className="font-display text-[22px] leading-6 font-semibold text-ink tabular-nums">{value}</div>
        <div className="label mt-0.5 truncate">{label}</div>
      </div>
    </div>
  );
}

export function EmptyState({ pose = "think", title, body, action }: { pose?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-8 text-center">
      <Mascot pose={pose} size={96} />
      <h3 className="mt-3 text-[19px] text-ink">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-[15px] leading-6 text-ink-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Mark Zuckerberg as a felt doll, our own caricature, beside his yearly challenges. */
export function ZuckAvatar({ size = 48 }: { size?: number }) {
  return <Picture src="/art/zuck.webp" size={size} alt="" className="shrink-0 rounded-full bg-cream-2 shadow-sm ring-2 ring-white" />;
}
