// Types shared by server code, the UI and generated spaces.

export const THEMES = ["teal", "mint", "sand", "peach", "lilac", "sky", "rose", "night"] as const;
export type Theme = (typeof THEMES)[number];

export const AGGREGATIONS = ["sum", "count", "days", "latest", "distinct"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export type Direction = "up" | "down";

export type Metric = {
  name: string;
  unit: string;
  target: number | null;
  aggregation: Aggregation;
  direction: Direction;
};

export type Milestone = {
  id: string;
  title: string;
  detail?: string;
  /** Metric value that reaches this camp, if it's measurable. */
  target?: number | null;
  due_on?: string | null;
  emoji?: string;
  done_at?: string | null;
  /** Generated badge image (path under /media) once the camp is reached. */
  badge?: string | null;
};

export type Plan = {
  version: number;
  summary_md: string;
  cadence: string;
  milestones: Milestone[];
  reason: string;
  author: string;
  created_at: string;
};

export type Quest = {
  id: string;
  title: string;
  detail: string;
  kind: "daily" | "weekly" | "boss" | "one_off";
  xp: number;
  due_on: string | null;
  status: "open" | "done" | "skipped";
  completed_at: string | null;
};

export type LogEntry = {
  id: string;
  logged_for: string;
  value: number | null;
  label: string | null;
  note: string;
  evidence_url: string | null;
  xp: number;
  source: string;
  created_at: string;
  quest_title?: string | null;
  cheers?: number;
  user?: PublicUser;
};

export type PublicUser = {
  handle: string;
  display_name: string;
  avatar: string;
  agent_name: string | null;
  agent_kind: string | null;
  agent_seen_at: string | null;
};

export type Facts = {
  today: string;
  starts_on: string;
  ends_on: string;
  day: number;
  days_total: number;
  days_remaining: number;
  total: number;
  target: number | null;
  /** 0..1 share of the target reached, or null when there's no numeric target. */
  progress: number | null;
  expected_by_now: number | null;
  /** total / expected_by_now; >1 means ahead of plan. */
  pace: number | null;
  last_log_on: string | null;
  days_since_last_log: number | null;
  streak: number;
  longest_streak: number;
  active_days: number;
  this_week: number;
  last_week: number;
  xp: number;
  level: number;
  level_xp: number;
  level_xp_needed: number;
  rank: number | null;
  members: number;
  gap_to_next: number | null;
  next_milestone: { id: string; title: string; target: number | null; due_on: string | null; remaining: number | null } | null;
  milestones_done: number;
  milestones_total: number;
  open_quests: number;
  status: "active" | "completed" | "left";
};

export type Standing = PublicUser & {
  total: number;
  progress: number | null;
  rank: number;
  streak: number;
  xp: number;
  level: number;
  last_log_on: string | null;
  status: string;
  role: string;
  joined_at: string;
};

export type ChallengeSummary = {
  slug: string;
  title: string;
  tagline: string;
  emoji: string;
  theme: Theme;
  category: string;
  status: "draft" | "active" | "completed" | "template";
  metric: Metric;
  members: number;
  cover_url: string | null;
  /** Virgil dressed for this challenge, cut out; null until he's drawn. */
  virgil_url: string | null;
  template_year: number | null;
  template_label: string | null;
  creator: PublicUser | null;
  created_at: string;
  /** Members who logged in the last 7 days. */
  active_this_week: number;
};

export type SpaceStatus = {
  current: { id: string; version: number; url: string; request: string; created_at: string; built_by: string | null } | null;
  pending: { id: string; version: number; status: "queued" | "building"; request: string; created_at: string } | null;
  last_failure: { id: string; version: number; error: string; request: string; created_at: string } | null;
  versions: number;
};

export type ActivityItem = {
  id: string;
  kind: string;
  created_at: string;
  data: Record<string, unknown>;
  user: PublicUser | null;
  challenge: { slug: string; title: string; emoji: string; theme: Theme };
};
