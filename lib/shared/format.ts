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
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 10 ? 1 : 0);
}

/** "12.5 mi", "3 books", "HSK 2" style value. */
export function withUnit(n: number | null | undefined, unit: string): string {
  if (n == null) return "–";
  if (!unit) return num(n);
  if (/^(level|hsk|lvl)$/i.test(unit)) return `${unit.toUpperCase() === "HSK" ? "HSK" : "Level"} ${num(n)}`;
  const singular = Math.abs(n) === 1 && unit.length > 3 && unit.endsWith("s") ? unit.slice(0, -1) : unit;
  return `${num(n)} ${singular}`;
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
      return d.target === "me" ? "rebuilt their space" : "redesigned the challenge page";
    case "completed":
      return `reached the summit of ${a.challenge.title}`;
    case "level":
      return `reached level ${String(d.level ?? "")}`;
    default:
      return a.kind;
  }
}

export function agentLabel(kind: string | null | undefined, name: string | null | undefined): string | null {
  const k = (kind ?? "").toLowerCase();
  const brand = k === "muse" ? "Muse" : k === "mcp" ? "MCP agent" : k === "virgil" ? "Misogi" : k === "agent" ? "AI agent" : null;
  if (name && brand && k !== "virgil") return `${name} · ${brand}`;
  if (k === "virgil") return "Virgil";
  return name ?? brand;
}
