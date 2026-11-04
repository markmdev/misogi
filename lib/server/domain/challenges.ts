import type { Aggregation, ChallengeSummary, Direction, Metric, Standing, Theme } from "@/lib/shared/types";
import { AGGREGATIONS, THEMES } from "@/lib/shared/types";
import type { UserRow } from "../auth";
import { all, one, run, tx } from "../db";
import { aggregate, levelFor, MILESTONE_XP, progressOf, standingScore, streaks, type FactLog } from "../facts";
import { addYear, AppError, dateIn, id, isIsoDate, nowIso, parseJson, sameGoal, slugify } from "../util";
import { recordActivity } from "./feed";
import { publicUser } from "./users";

export type ChallengeRow = {
  id: string;
  slug: string;
  creator_id: string | null;
  title: string;
  tagline: string;
  description_md: string;
  emoji: string;
  theme: Theme;
  category: string;
  metric_name: string;
  metric_unit: string;
  metric_target: number | null;
  metric_aggregation: Aggregation;
  metric_direction: Direction;
  cover_path: string | null;
  virgil_path: string | null;
  status: "draft" | "active" | "completed" | "template";
  template_year: number | null;
  template_label: string | null;
  created_at: string;
  updated_at: string;
};

export type MembershipRow = {
  challenge_id: string;
  user_id: string;
  role: "creator" | "member";
  status: "active" | "completed" | "left";
  joined_at: string;
  starts_on: string;
  ends_on: string;
  completed_at: string | null;
  review_md: string | null;
  helpful: number | null;
  helpful_note: string | null;
};

export const CATEGORIES = [
  "language",
  "fitness",
  "reading",
  "code",
  "making",
  "music",
  "art",
  "travel",
  "mindful",
  "cooking",
  "writing",
  "money",
  "social",
  "other",
] as const;

export function metricOf(c: ChallengeRow): Metric {
  return {
    name: c.metric_name,
    unit: c.metric_unit,
    target: c.metric_target,
    aggregation: c.metric_aggregation,
    direction: c.metric_direction,
  };
}

export function coverUrl(c: Pick<ChallengeRow, "cover_path">): string | null {
  if (!c.cover_path) return null;
  return c.cover_path.startsWith("/") ? c.cover_path : `/media/${c.cover_path}`;
}

export function getChallenge(slug: string): ChallengeRow {
  const c = one<ChallengeRow>("SELECT * FROM challenges WHERE slug = ?", slug.toLowerCase().trim());
  if (!c) throw new AppError("not_found", `No challenge called "${slug}".`, "Call list_my_challenges to see the right slugs.");
  return c;
}

export function findChallenge(slug: string): ChallengeRow | null {
  return one<ChallengeRow>("SELECT * FROM challenges WHERE slug = ?", slug.toLowerCase().trim()) ?? null;
}

export type LiveTwin = ChallengeSummary & { faces: { name: string; avatar: string }[] };

/** The titles of the live challenges, the most climbed first. */
export function liveTitles(limit = 80): string[] {
  return all<{ title: string }>(
    `SELECT title FROM challenges c WHERE status = 'active'
     ORDER BY (SELECT COUNT(*) FROM memberships m WHERE m.challenge_id = c.id AND m.status != 'left') DESC LIMIT ?`,
    limit,
  ).map((c) => c.title);
}

/** The live challenge a new one with this title would copy, the one most people climb when there are several, with its leaders' faces. */
export function liveTwin(title: string): LiveTwin | null {
  const goal = sameGoal(title);
  const row = all<ChallengeRow>(
    `SELECT c.* FROM challenges c WHERE status = 'active'
     ORDER BY (SELECT COUNT(*) FROM memberships m WHERE m.challenge_id = c.id AND m.status != 'left') DESC`,
  ).find((c) => sameGoal(c.title) === goal);
  if (!row) return null;
  return { ...summarize(row), faces: standings(row).slice(0, 5).map((s) => ({ name: s.display_name, avatar: s.avatar })) };
}

export function getMembership(challengeId: string, userId: string): MembershipRow | null {
  return one<MembershipRow>("SELECT * FROM memberships WHERE challenge_id = ? AND user_id = ?", challengeId, userId) ?? null;
}

export function requireMember(c: ChallengeRow, userId: string): MembershipRow {
  const m = getMembership(c.id, userId);
  if (!m || m.status === "left")
    throw new AppError("forbidden", "You're not in this challenge.", `Call join_challenge with challenge "${c.slug}" first.`);
  return m;
}

export function requireCreator(c: ChallengeRow, userId: string): MembershipRow {
  const m = requireMember(c, userId);
  if (m.role !== "creator")
    throw new AppError("forbidden", `Only the person who started "${c.title}" can change the shared challenge.`);
  return m;
}

function uniqueSlug(title: string): string {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; one("SELECT 1 FROM challenges WHERE slug = ?", slug); i++) slug = `${base}-${i}`;
  return slug;
}

export type MetricInput = {
  name: string;
  unit?: string;
  target?: number | null;
  aggregation: Aggregation;
  direction?: Direction;
};

function cleanMetric(m: MetricInput) {
  const name = m.name.trim().slice(0, 40);
  if (!name) throw new AppError("invalid", "The metric needs a name, like “miles run” or “books read”.");
  if (!(AGGREGATIONS as readonly string[]).includes(m.aggregation))
    throw new AppError("invalid", `aggregation must be one of ${AGGREGATIONS.join(", ")}.`);
  if (m.target != null && (!Number.isFinite(m.target) || m.target < 0)) throw new AppError("invalid", "target must be a positive number.");
  return {
    name,
    unit: (m.unit ?? "").trim().slice(0, 20),
    target: m.target ?? null,
    aggregation: m.aggregation,
    direction: m.direction === "down" ? "down" : "up",
  } as const;
}

export function createChallenge(
  user: UserRow,
  input: {
    title: string;
    tagline?: string;
    description_md?: string;
    emoji?: string;
    theme?: string;
    category?: string;
    metric: MetricInput;
    starts_on?: string;
    status?: "draft" | "active";
  },
): ChallengeRow {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) throw new AppError("invalid", "The challenge needs a title.");
  const metric = cleanMetric(input.metric);
  const today = dateIn(user.timezone);
  const starts_on = input.starts_on && isIsoDate(input.starts_on) ? input.starts_on : today;
  const theme = (THEMES as readonly string[]).includes(input.theme ?? "") ? input.theme! : THEMES[Math.floor(Math.random() * THEMES.length)];
  const category = (CATEGORIES as readonly string[]).includes(input.category ?? "") ? input.category! : "other";
  return tx(() => {
    const cid = id("chl");
    const slug = uniqueSlug(title);
    const now = nowIso();
    run(
      `INSERT INTO challenges (id, slug, creator_id, title, tagline, description_md, emoji, theme, category,
        metric_name, metric_unit, metric_target, metric_aggregation, metric_direction, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cid,
      slug,
      user.id,
      title,
      (input.tagline ?? "").trim().slice(0, 140),
      (input.description_md ?? "").slice(0, 4000),
      (input.emoji ?? "summit").slice(0, 24),
      theme,
      category,
      metric.name,
      metric.unit,
      metric.target,
      metric.aggregation,
      metric.direction,
      input.status ?? "active",
      now,
      now,
    );
    run(
      `INSERT INTO memberships (challenge_id, user_id, role, status, joined_at, starts_on, ends_on)
       VALUES (?, ?, 'creator', 'active', ?, ?, ?)`,
      cid,
      user.id,
      now,
      starts_on,
      addYear(starts_on),
    );
    if ((input.status ?? "active") === "active") recordActivity(cid, user.id, "started", { title });
    return one<ChallengeRow>("SELECT * FROM challenges WHERE id = ?", cid)!;
  });
}

export function updateChallenge(
  user: UserRow,
  slug: string,
  patch: {
    title?: string;
    tagline?: string;
    description_md?: string;
    emoji?: string;
    theme?: string;
    category?: string;
    metric?: MetricInput;
    status?: "active";
  },
): ChallengeRow {
  const c = getChallenge(slug);
  requireCreator(c, user.id);
  return tx(() => {
    const next = { ...c };
    if (patch.title != null) next.title = patch.title.replace(/\s+/g, " ").trim().slice(0, 80) || c.title;
    if (patch.tagline != null) next.tagline = patch.tagline.trim().slice(0, 140);
    if (patch.description_md != null) next.description_md = patch.description_md.slice(0, 4000);
    if (patch.emoji != null) next.emoji = patch.emoji.slice(0, 24);
    if (patch.theme != null && (THEMES as readonly string[]).includes(patch.theme)) next.theme = patch.theme as Theme;
    if (patch.category != null && (CATEGORIES as readonly string[]).includes(patch.category)) next.category = patch.category;
    if (patch.metric) {
      const members = one<{ n: number }>("SELECT COUNT(*) n FROM memberships WHERE challenge_id = ? AND status != 'left'", c.id)!.n;
      const m = cleanMetric(patch.metric);
      const changesMeaning = m.aggregation !== c.metric_aggregation || m.direction !== c.metric_direction;
      if (members > 1 && changesMeaning)
        throw new AppError("conflict", "Other people already joined, so the way progress is counted is locked. You can still rename the metric or change the target.");
      next.metric_name = m.name;
      next.metric_unit = m.unit;
      next.metric_target = m.target;
      next.metric_aggregation = m.aggregation;
      next.metric_direction = m.direction;
    }
    const activating = patch.status === "active" && c.status === "draft";
    if (activating) next.status = "active";
    run(
      `UPDATE challenges SET title = ?, tagline = ?, description_md = ?, emoji = ?, theme = ?, category = ?, metric_name = ?,
        metric_unit = ?, metric_target = ?, metric_aggregation = ?, metric_direction = ?, status = ?, updated_at = ? WHERE id = ?`,
      next.title,
      next.tagline,
      next.description_md,
      next.emoji,
      next.theme,
      next.category,
      next.metric_name,
      next.metric_unit,
      next.metric_target,
      next.metric_aggregation,
      next.metric_direction,
      next.status,
      nowIso(),
      c.id,
    );
    if (activating) recordActivity(c.id, user.id, "started", { title: next.title });
    return getChallenge(c.slug);
  });
}

export function setCover(challengeId: string, path: string) {
  run("UPDATE challenges SET cover_path = ?, updated_at = ? WHERE id = ?", path, nowIso(), challengeId);
}

export function virgilUrl(c: Pick<ChallengeRow, "virgil_path">): string | null {
  return c.virgil_path ? `/media/${c.virgil_path}` : null;
}

export function setVirgil(challengeId: string, path: string) {
  run("UPDATE challenges SET virgil_path = ?, updated_at = ? WHERE id = ?", path, nowIso(), challengeId);
}

export function joinChallenge(user: UserRow, slug: string): { challenge: ChallengeRow; membership: MembershipRow; already: boolean } {
  const c = getChallenge(slug);
  if (c.status === "template")
    throw new AppError("invalid", `"${c.title}" is a template. Start your own from it instead.`, "Call create_challenge with a similar title and metric.");
  if (c.status === "draft") throw new AppError("invalid", "This challenge hasn't started yet.");
  return tx(() => {
    const existing = getMembership(c.id, user.id);
    if (existing && existing.status !== "left") return { challenge: c, membership: existing, already: true };
    const today = dateIn(user.timezone);
    const now = nowIso();
    if (existing) {
      run(
        "UPDATE memberships SET status = 'active', joined_at = ?, starts_on = ?, ends_on = ? WHERE challenge_id = ? AND user_id = ?",
        now,
        today,
        addYear(today),
        c.id,
        user.id,
      );
    } else {
      run(
        `INSERT INTO memberships (challenge_id, user_id, role, status, joined_at, starts_on, ends_on)
         VALUES (?, ?, 'member', 'active', ?, ?, ?)`,
        c.id,
        user.id,
        now,
        today,
        addYear(today),
      );
    }
    recordActivity(c.id, user.id, "joined", {});
    return { challenge: c, membership: getMembership(c.id, user.id)!, already: false };
  });
}

export function completeMembership(
  user: UserRow,
  slug: string,
  input: { review_md: string; helpful: boolean; helpful_note?: string },
) {
  const c = getChallenge(slug);
  const m = requireMember(c, user.id);
  if (m.status === "completed") throw new AppError("conflict", "This challenge is already complete.");
  const review = input.review_md.trim();
  if (review.length < 20) throw new AppError("invalid", "Write a real year-in-review (a few sentences at least).");
  tx(() => {
    run(
      `UPDATE memberships SET status = 'completed', completed_at = ?, review_md = ?, helpful = ?, helpful_note = ?
       WHERE challenge_id = ? AND user_id = ?`,
      nowIso(),
      review.slice(0, 8000),
      input.helpful ? 1 : 0,
      (input.helpful_note ?? "").slice(0, 1000),
      c.id,
      user.id,
    );
    recordActivity(c.id, user.id, "completed", {});
  });
  return getMembership(c.id, user.id)!;
}

// ---------- Reading ----------

export function memberLogs(challengeId: string, userId: string): FactLog[] {
  return all<FactLog>(
    "SELECT logged_for, value, label, xp, created_at FROM logs WHERE challenge_id = ? AND user_id = ? AND deleted_at IS NULL",
    challengeId,
    userId,
  );
}

type MemberJoin = MembershipRow & UserRow;

/** Leaderboard for a challenge, best first. */
export function standings(c: ChallengeRow): Standing[] {
  const metric = metricOf(c);
  const rows = all<MemberJoin>(
    `SELECT m.*, u.* FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.challenge_id = ? AND m.status != 'left'`,
    c.id,
  );
  const allLogs = all<FactLog & { user_id: string }>(
    "SELECT user_id, logged_for, value, label, xp, created_at FROM logs WHERE challenge_id = ? AND deleted_at IS NULL",
    c.id,
  );
  const plans = all<{ user_id: string; milestones_json: string }>(
    `SELECT p.user_id, p.milestones_json FROM plans p
     JOIN (SELECT user_id, MAX(version) v FROM plans WHERE challenge_id = ? GROUP BY user_id) last
       ON last.user_id = p.user_id AND last.v = p.version
     WHERE p.challenge_id = ?`,
    c.id,
    c.id,
  );
  const doneByUser = new Map(
    plans.map((p) => [p.user_id, parseJson<{ done_at?: string | null }[]>(p.milestones_json, []).filter((m) => m.done_at).length]),
  );
  const scored = rows.map((r) => {
    const logs = allLogs.filter((l) => l.user_id === r.user_id);
    const total = aggregate(logs, metric);
    const progress = progressOf(total, logs, metric);
    const xp = logs.reduce((s, l) => s + l.xp, 0) + (doneByUser.get(r.user_id) ?? 0) * MILESTONE_XP;
    const dates = logs.map((l) => l.logged_for);
    const last = dates.length ? [...dates].sort().at(-1)! : null;
    return {
      ...publicUser(r),
      total,
      progress,
      streak: streaks(dates, dateIn(r.timezone)).current,
      xp,
      level: levelFor(xp).level,
      last_log_on: last,
      status: r.status,
      role: r.role,
      joined_at: r.joined_at,
      score: ranked(logs, metric) ? standingScore(total, progress, metric) : Number.NEGATIVE_INFINITY,
    };
  });
  scored.sort((a, b) => b.score - a.score || b.xp - a.xp || a.joined_at.localeCompare(b.joined_at));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return scored.map(({ score, ...s }, i) => ({ ...s, rank: i + 1 }));
}

/** Whether someone has logged enough to place. For level/time metrics, check-ins without a number don't count (a 0 would win "lower is better"). */
function ranked(logs: FactLog[], metric: Metric): boolean {
  return metric.aggregation === "latest" ? logs.some((l) => l.value != null) : logs.length > 0;
}

export function summarize(c: ChallengeRow): ChallengeSummary {
  const members = one<{ n: number }>("SELECT COUNT(*) n FROM memberships WHERE challenge_id = ? AND status != 'left'", c.id)!.n;
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const active = one<{ n: number }>(
    "SELECT COUNT(DISTINCT user_id) n FROM logs WHERE challenge_id = ? AND deleted_at IS NULL AND logged_for >= ?",
    c.id,
    weekAgo,
  )!.n;
  const creator = c.creator_id ? one<UserRow>("SELECT * FROM users WHERE id = ?", c.creator_id) : undefined;
  return {
    slug: c.slug,
    title: c.title,
    tagline: c.tagline,
    emoji: c.emoji,
    theme: c.theme,
    category: c.category,
    status: c.status,
    metric: metricOf(c),
    members,
    cover_url: coverUrl(c),
    virgil_url: virgilUrl(c),
    template_year: c.template_year,
    template_label: c.template_label,
    creator: creator ? publicUser(creator) : null,
    created_at: c.created_at,
    active_this_week: active,
  };
}

export function listChallenges(opts: {
  status?: ("active" | "template" | "completed")[];
  query?: string;
  limit?: number;
  includeDemo?: boolean;
}): ChallengeSummary[] {
  const status = opts.status ?? ["active"];
  const params: unknown[] = [...status];
  let sql = `SELECT c.*, (SELECT COUNT(*) FROM memberships m WHERE m.challenge_id = c.id AND m.status != 'left') AS members,
      (SELECT MAX(l.created_at) FROM logs l WHERE l.challenge_id = c.id AND l.deleted_at IS NULL) AS last_activity
    FROM challenges c WHERE c.status IN (${status.map(() => "?").join(",")})`;
  if (opts.query) {
    sql += " AND (c.title LIKE ? OR c.tagline LIKE ? OR c.category LIKE ?)";
    const q = `%${opts.query.trim()}%`;
    params.push(q, q, q);
  }
  sql += " ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END, members DESC, last_activity DESC, c.template_year ASC LIMIT ?";
  params.push(Math.min(opts.limit ?? 30, 100));
  return all<ChallengeRow>(sql, ...params).map(summarize);
}

export function myChallenges(userId: string): (ChallengeSummary & { role: string; membership_status: string })[] {
  const rows = all<ChallengeRow & { role: string; membership_status: string }>(
    `SELECT c.*, m.role, m.status AS membership_status FROM memberships m JOIN challenges c ON c.id = m.challenge_id
     WHERE m.user_id = ? AND m.status != 'left' ORDER BY m.joined_at DESC`,
    userId,
  );
  return rows.map((r) => ({ ...summarize(r), role: r.role, membership_status: r.membership_status }));
}
