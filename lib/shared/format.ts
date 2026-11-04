import type { ActivityItem, Metric } from "./types";

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (d < 60) return `${w}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Muse Wonder" for "muse-wonder-1.0": the Meta model to credit on screen, or null for any other model. */
export function museName(model: string | null | undefined): string | null {
  const m = /^muse-([a-z]+)/.exec(model ?? "");
  return m ? `Muse ${m[1][0].toUpperCase()}${m[1].slice(1)}` : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 2" or "Nov 2, 2027" for a YYYY-MM-DD date. */
export function shortDate(date: string | null | undefined, withYear = false): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

export function num(n: number | null | undefined): string {
  if (n == null) return "–";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return String(Math.round(n * 10) / 10);
}

/** "12.5 mi", "3 books", "HSK 2", "V5" style value. */
/**
 * A log that keeps the streak without moving the number: no number on a sum or latest metric, or 0 on a count, where a
 * log without a number is one more of the thing counted.
 */
export function isCheckin(value: number | null, aggregation: string): boolean {
  return aggregation === "sum" || aggregation === "latest" ? value == null : aggregation === "count" && value === 0;
}

export function withUnit(n: number | null | undefined, unit: string): string {
  if (n == null) return "–";
  if (!unit) return num(n);
  if (/^(level|hsk|lvl)$/i.test(unit)) return `${unit.toUpperCase() === "HSK" ? "HSK" : "Level"} ${num(n)}`;
  if (unit === "V") return `V${num(n)}`;
  if (/^[$€£¥₹]/.test(unit)) return `${unit[0]}${num(n)}${unit.slice(1)}`;
  if (/^(s|sec|secs|seconds)$/i.test(unit) && n >= 60 && n < 3600) return withUnit(n / 60, "min");
  if (/^(min|mins|minutes)$/i.test(unit) && !Number.isInteger(n) && n < 1000) {
    const secs = Math.round(n * 60);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} ${unit}`;
  }
  const singular = Math.abs(n) === 1 && unit.length > 3 && unit.endsWith("s") ? unit.slice(0, -1) : unit;
  return `${num(n)} ${singular}`;
}

/** A climber's number; none yet when lower is better and nothing has been timed, where 0 would read as a record. */
export function shownTotal(total: number, m: Metric): string {
  return withUnit(m.direction === "down" && !total ? null : total, m.unit);
}

/** The goal beside a climber's number: "of 365 mi", or "goal 8 min" when lower is better. */
export function againstGoal(target: number, m: Metric): string {
  return `${m.direction === "down" ? "goal" : "of"} ${withUnit(target, m.unit)}`;
}

/** How far a climber is from the summit: a share of the way, or when lower is better, what's left to cut from their best. */
export function toSummit(f: { total: number; target: number | null; progress: number | null }, m: Metric): string {
  const progress = f.progress ?? 0;
  if (m.direction !== "down" || f.target == null) return `${Math.round(progress * 100)}% to the summit`;
  if (f.total === 0) return "No time logged yet";
  if (progress >= 1) return "Summit reached";
  return `${withUnit(Math.round((f.total - f.target) * 100) / 100, m.unit)} to cut`;
}

export function metricLine(m: Metric): string {
  const target = m.target != null ? withUnit(m.target, m.unit) : null;
  switch (m.aggregation) {
    case "days":
      return m.target != null ? `${num(m.target)} days` : "Daily";
    case "latest":
      return target ? `Reach ${target}` : `Track ${m.name}`;
    case "distinct":
      return m.target != null ? `${num(m.target)} ${m.name.replace(/^(different|distinct)\s+/i, "")}` : m.name;
    default:
      return target ?? m.name;
  }
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** One plain sentence for a feed item, without the person's name. */
export function activityText(a: ActivityItem): string {
  const d = a.data as Record<string, unknown>;
  switch (a.kind) {
    case "started":
      return `started ${a.challenge.title}`;
    case "joined":
      return `joined ${a.challenge.title}`;
    case "logged": {
      const v = d.value as number | null;
      const label = d.label as string | null;
      if (label) return `logged ${label}`;
      if (d.checkin) return "checked in";
      if (v != null) return `logged ${withUnit(v, String(d.unit ?? ""))}`;
      const unit = String(d.unit ?? "");
      if (unit && unit !== "days") return `logged 1 ${unit.replace(/s$/, "")}`;
      return "checked in";
    }
    case "quest_done":
      return `finished a quest: ${String(d.title ?? "")}`;
    case "milestone":
      return `reached camp: ${String(d.title ?? "")}`;
    case "plan":
      return Number(d.version) > 1 ? "updated their plan" : "wrote their plan";
    case "space":
      return d.target === "me" ? "rebuilt their page" : "redesigned the challenge page";
    case "completed":
      return `reached the summit of ${a.challenge.title}`;
    case "level":
      return `reached level ${String(d.level ?? "")}`;
    default:
      return a.kind;
  }
}

/** Folds back-to-back repeats of the same quiet event by one person (rebuilt their page, updated their plan) into one row with a count. */
export function foldRepeats(items: ActivityItem[]): { a: ActivityItem; times: number }[] {
  const out: { a: ActivityItem; times: number }[] = [];
  for (const a of items) {
    const last = out.at(-1);
    const same =
      last &&
      (a.kind === "space" || a.kind === "plan") &&
      last.a.kind === a.kind &&
      last.a.user?.handle === a.user?.handle &&
      last.a.challenge.slug === a.challenge.slug &&
      last.a.data.target === a.data.target;
    if (same) last.times++;
    else out.push({ a, times: 1 });
  }
  return out;
}

/**
 * Who coaches someone, the one way the site says it: "Bao, your Muse", "Helen's Muse", "Claude, your AI" or "Muse",
 * the preview of Muse on Misogi for people without it. `whose` is how the owner reads in that spot: "Your" to open a line, "your", or "Helen's".
 */
export function agentLabel(kind: string | null | undefined, name: string | null | undefined, whose = "Your"): string | null {
  const k = (kind ?? "").toLowerCase();
  if (k === "virgil") return "Muse";
  const brand = k === "muse" ? "Muse" : k === "mcp" || k === "agent" ? "AI" : null;
  if (!brand) return name ?? null;
  if (name?.trim().toLowerCase() === "muse") return `${whose} Muse`;
  return name ? `${name}, ${whose.toLowerCase() === "your" ? "your" : whose} ${brand}` : `${whose} ${brand}`;
}

/** Who a line tells someone to ask, by the guide they coach with: "Muse", "your AI" or "your Muse". */
export function askWhoFor(kind: string | null | undefined): string {
  const k = (kind ?? "").toLowerCase();
  return k === "virgil" ? "Muse" : k === "mcp" || k === "agent" ? "your AI" : "your Muse";
}
