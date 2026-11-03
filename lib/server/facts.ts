// Pure functions that turn a member's logs and plan into plain numbers.
// Facts carry no advice: agents reason over them.

import type { Aggregation, Direction, Facts, Milestone } from "@/lib/shared/types";
import { addDays, clamp, daysBetween } from "./util";

export type FactLog = {
  logged_for: string;
  value: number | null;
  label: string | null;
  xp: number;
  created_at: string;
};

export type MetricDef = {
  target: number | null;
  aggregation: Aggregation;
  direction: Direction;
};

/** XP needed to reach `level` (level 1 starts at 0). 0, 100, 300, 600, 1000, ... */
export function levelThreshold(level: number): number {
  return 50 * level * (level - 1);
}

export function levelFor(xp: number) {
  let level = 1;
  while (xp >= levelThreshold(level + 1)) level++;
  const floor = levelThreshold(level);
  return { level, level_xp: xp - floor, level_xp_needed: levelThreshold(level + 1) - floor };
}

export const MILESTONE_XP = 100;

function sortLogs(logs: FactLog[]): FactLog[] {
  return [...logs].sort((a, b) =>
    a.logged_for === b.logged_for ? a.created_at.localeCompare(b.created_at) : a.logged_for.localeCompare(b.logged_for),
  );
}

/** The member's aggregated metric value from their logs. */
export function aggregate(logs: FactLog[], metric: MetricDef): number {
  if (logs.length === 0) return 0;
  switch (metric.aggregation) {
    case "sum":
      return round(logs.reduce((s, l) => s + (l.value ?? 0), 0));
    case "count":
      return round(logs.reduce((s, l) => s + (l.value ?? 1), 0));
    case "days":
      return new Set(logs.map((l) => l.logged_for)).size;
    case "distinct":
      return new Set(logs.map((l) => (l.label ?? "").trim().toLowerCase()).filter(Boolean)).size;
    case "latest": {
      const withValue = sortLogs(logs).filter((l) => l.value != null);
      return withValue.length ? (withValue[withValue.length - 1].value as number) : 0;
    }
  }
}

/** First measured value, used as the baseline for `latest` metrics. */
function baseline(logs: FactLog[]): number | null {
  const withValue = sortLogs(logs).filter((l) => l.value != null);
  return withValue.length ? (withValue[0].value as number) : null;
}

export function progressOf(total: number, logs: FactLog[], metric: MetricDef): number | null {
  if (metric.target == null || metric.target === 0) return null;
  if (metric.direction === "down") {
    // Lower is better (a 5k time): reaching the target is 100%; before that, measure from the first try.
    // Check-ins without a number don't count as a try.
    const base = baseline(logs);
    if (base == null) return 0;
    if (total <= metric.target) return 1;
    if (base <= metric.target) return 0;
    return clamp((base - total) / (base - metric.target), 0, 1);
  }
  return clamp(total / metric.target, 0, 1);
}

/** Where the member is expected to be today, following numeric milestones when the plan has them. */
export function expectedByNow(
  today: string,
  startsOn: string,
  endsOn: string,
  metric: MetricDef,
  milestones: Milestone[],
): number | null {
  if (metric.target == null) return null;
  if (metric.aggregation === "latest") return null; // levels/times don't grow linearly
  const total = Math.max(1, daysBetween(startsOn, endsOn) + 1);
  const elapsed = clamp(daysBetween(startsOn, today) + 1, 0, total);
  const points: { day: number; value: number }[] = [{ day: 0, value: 0 }];
  for (const m of milestones) {
    if (m.target == null || !m.due_on) continue;
    points.push({ day: clamp(daysBetween(startsOn, m.due_on) + 1, 0, total), value: m.target });
  }
  points.push({ day: total, value: metric.target });
  points.sort((a, b) => a.day - b.day || a.value - b.value);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (elapsed <= b.day) {
      if (b.day === a.day) return round(b.value);
      return round(a.value + ((b.value - a.value) * (elapsed - a.day)) / (b.day - a.day));
    }
  }
  return metric.target;
}

export function streaks(dates: string[], today: string) {
  const set = new Set(dates);
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  // A streak stays alive through today if yesterday was logged.
  let cursor = set.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

function weekTotal(logs: FactLog[], from: string, to: string, metric: MetricDef): number {
  const inRange = logs.filter((l) => l.logged_for >= from && l.logged_for <= to);
  if (metric.aggregation === "latest") return inRange.length;
  return aggregate(inRange, metric);
}

export type MemberFactInput = {
  today: string;
  starts_on: string;
  ends_on: string;
  status: "active" | "completed" | "left";
  metric: MetricDef;
  milestones: Milestone[];
  logs: FactLog[];
  open_quests: number;
  standing: { rank: number | null; members: number; gap_to_next: number | null };
};

export function computeFacts(input: MemberFactInput): Facts {
  const { today, starts_on, ends_on, metric, milestones, logs } = input;
  const days_total = Math.max(1, daysBetween(starts_on, ends_on) + 1);
  const day = clamp(daysBetween(starts_on, today) + 1, 0, days_total);
  const total = aggregate(logs, metric);
  const progress = progressOf(total, logs, metric);
  const expected = expectedByNow(today, starts_on, ends_on, metric, milestones);
  const dates = logs.map((l) => l.logged_for);
  const { current, longest } = streaks(dates, today);
  const sorted = sortLogs(logs);
  const last = sorted.length ? sorted[sorted.length - 1].logged_for : null;
  const milestonesDone = milestones.filter((m) => m.done_at).length;
  const xp = logs.reduce((s, l) => s + l.xp, 0) + milestonesDone * MILESTONE_XP;
  const next = milestones.find((m) => !m.done_at) ?? null;
  return {
    today,
    starts_on,
    ends_on,
    day,
    days_total,
    days_remaining: Math.max(0, days_total - day),
    total,
    target: metric.target,
    progress,
    expected_by_now: expected,
    // Pace is noise in the first week; hide it until there's a real trend.
    pace: expected && expected > 0 && day >= 7 ? round(Math.min(total / expected, 9.99)) : null,
    last_log_on: last,
    days_since_last_log: last ? Math.max(0, daysBetween(last, today)) : null,
    streak: current,
    longest_streak: longest,
    active_days: new Set(dates).size,
    this_week: weekTotal(logs, addDays(today, -6), today, metric),
    last_week: weekTotal(logs, addDays(today, -13), addDays(today, -7), metric),
    xp,
    ...levelFor(xp),
    rank: input.standing.rank,
    members: input.standing.members,
    gap_to_next: input.standing.gap_to_next,
    next_milestone: next
      ? {
          id: next.id,
          title: next.title,
          target: next.target ?? null,
          due_on: next.due_on ?? null,
          remaining: next.target != null && metric.direction === "up" ? round(Math.max(0, next.target - total)) : null,
        }
      : null,
    milestones_done: milestonesDone,
    milestones_total: milestones.length,
    open_quests: input.open_quests,
    status: input.status,
  };
}

/** Sort key for leaderboards: higher is better. */
export function standingScore(total: number, progress: number | null, metric: MetricDef): number {
  // For "lower is better" everyone is compared on the same number, not on progress from their own start.
  if (metric.direction === "down") return -total;
  if (progress != null) return progress;
  return total;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
