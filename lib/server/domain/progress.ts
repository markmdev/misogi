import type { Facts, LogEntry, Milestone, Plan, Quest } from "@/lib/shared/types";
import type { UserRow } from "../auth";
import { all, one, run, tx } from "../db";
import { aggregate, computeFacts, levelFor, MILESTONE_XP } from "../facts";
import { addDays, AppError, dateIn, id, isIsoDate, nowIso, parseJson } from "../util";
import {
  getChallenge,
  memberLogs,
  metricOf,
  requireMember,
  standings,
  type ChallengeRow,
  type MembershipRow,
} from "./challenges";
import { recordActivity } from "./feed";
import { getUser, publicUser } from "./users";

// ---------- Plans (the curriculum) ----------

type PlanRow = {
  id: string;
  version: number;
  summary_md: string;
  cadence: string;
  milestones_json: string;
  reason: string;
  author: string;
  created_at: string;
};

function toPlan(r: PlanRow): Plan {
  return {
    version: r.version,
    summary_md: r.summary_md,
    cadence: r.cadence,
    milestones: parseJson<Milestone[]>(r.milestones_json, []),
    reason: r.reason,
    author: r.author,
    created_at: r.created_at,
  };
}

export function currentPlan(challengeId: string, userId: string): Plan | null {
  const r = one<PlanRow>(
    "SELECT * FROM plans WHERE challenge_id = ? AND user_id = ? ORDER BY version DESC LIMIT 1",
    challengeId,
    userId,
  );
  return r ? toPlan(r) : null;
}

export function planHistory(challengeId: string, userId: string): Plan[] {
  return all<PlanRow>(
    "SELECT * FROM plans WHERE challenge_id = ? AND user_id = ? ORDER BY version DESC",
    challengeId,
    userId,
  ).map(toPlan);
}

export type MilestoneInput = { title: string; detail?: string; target?: number | null; due_on?: string | null; emoji?: string; id?: string };

export function setPlan(
  user: UserRow,
  slug: string,
  input: { summary_md: string; cadence: string; milestones: MilestoneInput[]; reason: string },
  author = "agent",
): Plan {
  const c = getChallenge(slug);
  const m = requireMember(c, user.id);
  const summary = input.summary_md.trim();
  if (summary.length < 20) throw new AppError("invalid", "The plan summary is too short. Describe the approach in a few sentences.");
  if (input.milestones.length > 20) throw new AppError("invalid", "Keep it to 20 camps or fewer.");
  const prev = currentPlan(c.id, user.id);
  const prevById = new Map((prev?.milestones ?? []).map((x) => [x.id, x]));
  const prevByTitle = new Map((prev?.milestones ?? []).map((x) => [x.title.toLowerCase(), x]));
  const milestones: Milestone[] = input.milestones.map((x, i) => {
    const title = x.title.trim().slice(0, 80);
    if (!title) throw new AppError("invalid", `Camp ${i + 1} needs a title.`);
    if (x.due_on && !isIsoDate(x.due_on)) throw new AppError("invalid", `Camp "${title}" has a bad due date. Use YYYY-MM-DD.`);
    if (x.due_on && (x.due_on < m.starts_on || x.due_on > addDays(m.ends_on, 30)))
      throw new AppError("invalid", `Camp "${title}" is due outside this challenge's year (${m.starts_on} to ${m.ends_on}).`);
    const carried = (x.id && prevById.get(x.id)) || prevByTitle.get(title.toLowerCase());
    return {
      id: carried?.id ?? id("cmp"),
      title,
      detail: (x.detail ?? "").trim().slice(0, 300),
      target: x.target ?? null,
      due_on: x.due_on ?? null,
      emoji: (x.emoji ?? carried?.emoji ?? "camp").slice(0, 24),
      done_at: carried?.done_at ?? null,
    };
  });
  return tx(() => {
    const version = (prev?.version ?? 0) + 1;
    run(
      `INSERT INTO plans (id, challenge_id, user_id, version, summary_md, cadence, milestones_json, reason, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id("pln"),
      c.id,
      user.id,
      version,
      summary.slice(0, 6000),
      input.cadence.trim().slice(0, 200),
      JSON.stringify(milestones),
      input.reason.trim().slice(0, 500),
      author,
      nowIso(),
    );
    recordActivity(c.id, user.id, "plan", { version, reason: input.reason.trim().slice(0, 140) });
    autoReachMilestones(c, user.id);
    return currentPlan(c.id, user.id)!;
  });
}

/** Marks numeric camps as reached once the member's total passes their target. */
function autoReachMilestones(c: ChallengeRow, userId: string): Milestone[] {
  const plan = one<PlanRow>("SELECT * FROM plans WHERE challenge_id = ? AND user_id = ? ORDER BY version DESC LIMIT 1", c.id, userId);
  if (!plan) return [];
  const milestones = parseJson<Milestone[]>(plan.milestones_json, []);
  const metric = metricOf(c);
  if (metric.direction === "down" || metric.aggregation === "latest") return [];
  const total = aggregate(memberLogs(c.id, userId), metric);
  const reached: Milestone[] = [];
  for (const m of milestones) {
    if (!m.done_at && m.target != null && total >= m.target) {
      m.done_at = nowIso();
      reached.push(m);
    }
  }
  if (reached.length) {
    run("UPDATE plans SET milestones_json = ? WHERE id = ?", JSON.stringify(milestones), plan.id);
    for (const m of reached) recordActivity(c.id, userId, "milestone", { milestone_id: m.id, title: m.title, emoji: m.emoji });
  }
  return reached;
}

export function completeMilestone(user: UserRow, slug: string, milestoneId: string): Milestone {
  const c = getChallenge(slug);
  requireMember(c, user.id);
  const plan = one<PlanRow>("SELECT * FROM plans WHERE challenge_id = ? AND user_id = ? ORDER BY version DESC LIMIT 1", c.id, user.id);
  if (!plan) throw new AppError("not_found", "There's no plan yet.", "Call set_plan first.");
  const milestones = parseJson<Milestone[]>(plan.milestones_json, []);
  const m = milestones.find((x) => x.id === milestoneId || x.title.toLowerCase() === milestoneId.toLowerCase());
  if (!m) throw new AppError("not_found", `No camp "${milestoneId}" in the current plan.`, "Use a milestone id from get_challenge.");
  if (m.done_at) return m;
  return tx(() => {
    m.done_at = nowIso();
    run("UPDATE plans SET milestones_json = ? WHERE id = ?", JSON.stringify(milestones), plan.id);
    recordActivity(c.id, user.id, "milestone", { milestone_id: m.id, title: m.title, emoji: m.emoji });
    return m;
  });
}

// ---------- Quests ----------

type QuestRow = Quest & { challenge_id: string; user_id: string; log_id: string | null };

function stripQuest(r: QuestRow): Quest {
  return { id: r.id, title: r.title, detail: r.detail, kind: r.kind, xp: r.xp, due_on: r.due_on, status: r.status, completed_at: r.completed_at };
}

export function listQuests(challengeId: string, userId: string, status?: Quest["status"][]): Quest[] {
  const st = status ?? ["open", "done", "skipped"];
  return all<QuestRow>(
    `SELECT * FROM quests WHERE challenge_id = ? AND user_id = ? AND status IN (${st.map(() => "?").join(",")})
     ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, COALESCE(due_on, '9999') ASC, created_at DESC LIMIT 60`,
    challengeId,
    userId,
    ...st,
  ).map(stripQuest);
}

export type QuestInput = { title: string; detail?: string; kind?: Quest["kind"]; xp?: number; due_on?: string | null };

export function addQuests(user: UserRow, slug: string, quests: QuestInput[], replaceOpen = false): Quest[] {
  const c = getChallenge(slug);
  requireMember(c, user.id);
  if (quests.length === 0) throw new AppError("invalid", "Add at least one quest.");
  if (quests.length > 14) throw new AppError("invalid", "Add at most 14 quests at a time.");
  return tx(() => {
    if (replaceOpen) run("UPDATE quests SET status = 'skipped' WHERE challenge_id = ? AND user_id = ? AND status = 'open'", c.id, user.id);
    const ids: string[] = [];
    for (const q of quests) {
      const title = q.title.trim().slice(0, 100);
      if (!title) throw new AppError("invalid", "Every quest needs a title.");
      if (q.due_on && !isIsoDate(q.due_on)) throw new AppError("invalid", `Quest "${title}" has a bad due date. Use YYYY-MM-DD.`);
      const qid = id("qst");
      ids.push(qid);
      run(
        `INSERT INTO quests (id, challenge_id, user_id, title, detail, kind, xp, due_on, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        qid,
        c.id,
        user.id,
        title,
        (q.detail ?? "").trim().slice(0, 400),
        q.kind ?? "weekly",
        Math.round(Math.min(Math.max(q.xp ?? (q.kind === "boss" ? 80 : 20), 5), 200)),
        q.due_on ?? null,
        nowIso(),
      );
    }
    return all<QuestRow>(`SELECT * FROM quests WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids).map(stripQuest);
  });
}

export function skipQuest(user: UserRow, slug: string, questId: string) {
  const c = getChallenge(slug);
  requireMember(c, user.id);
  const q = one<QuestRow>("SELECT * FROM quests WHERE id = ? AND challenge_id = ? AND user_id = ?", questId, c.id, user.id);
  if (!q) throw new AppError("not_found", "Quest not found.");
  if (q.status !== "open") throw new AppError("conflict", "That quest is already closed.");
  run("UPDATE quests SET status = 'skipped', completed_at = ? WHERE id = ?", nowIso(), questId);
}

// ---------- Logs ----------

export type LogInput = {
  value?: number | null;
  label?: string | null;
  note?: string;
  date?: string;
  evidence_url?: string | null;
  quest_id?: string | null;
};

const LOG_XP = 10;
const NOTE_BONUS_XP = 5;

export function logProgress(user: UserRow, slug: string, input: LogInput, source: string) {
  const c = getChallenge(slug);
  const m = requireMember(c, user.id);
  if (m.status === "completed") throw new AppError("conflict", "This challenge is already complete.");
  const today = dateIn(user.timezone);
  const date = input.date ?? today;
  if (!isIsoDate(date)) throw new AppError("invalid", `Bad date "${date}". Use YYYY-MM-DD.`);
  if (date > addDays(today, 1)) throw new AppError("invalid", "You can't log progress in the future.");
  if (date < m.starts_on) throw new AppError("invalid", `This challenge started on ${m.starts_on}; you can't log before that.`);
  const agg = c.metric_aggregation;
  let value = input.value ?? null;
  if (value != null && !Number.isFinite(value)) throw new AppError("invalid", "value must be a number.");
  if ((agg === "sum" || agg === "latest") && value == null)
    throw new AppError("invalid", `This challenge counts ${c.metric_name}, so include a number in "value" (in ${c.metric_unit || "units"}).`);
  if (agg === "sum" && value! < 0) throw new AppError("invalid", "value can't be negative.");
  if (agg === "days") value = value ?? null;
  const label = (input.label ?? "").trim().slice(0, 80) || null;
  if (agg === "distinct" && !label)
    throw new AppError("invalid", `This challenge counts distinct ${c.metric_name}, so include which one in "label".`);
  const note = (input.note ?? "").trim().slice(0, 2000);
  if (input.evidence_url && !/^https?:\/\//.test(input.evidence_url)) throw new AppError("invalid", "evidence_url must be an http(s) URL.");

  let quest: QuestRow | undefined;
  if (input.quest_id) {
    quest = one<QuestRow>("SELECT * FROM quests WHERE id = ? AND challenge_id = ? AND user_id = ?", input.quest_id, c.id, user.id);
    if (!quest) throw new AppError("not_found", "That quest doesn't exist for this member.");
    if (quest.status !== "open") throw new AppError("conflict", "That quest is already closed.");
  }

  return tx(() => {
    const before = levelFor(memberLogs(c.id, user.id).reduce((s, l) => s + l.xp, 0)).level;
    const xp = LOG_XP + (note.length >= 30 ? NOTE_BONUS_XP : 0) + (quest?.xp ?? 0);
    const logId = id("log");
    run(
      `INSERT INTO logs (id, challenge_id, user_id, logged_for, value, label, note, evidence_url, quest_id, xp, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      logId,
      c.id,
      user.id,
      date,
      value,
      label,
      note,
      input.evidence_url ?? null,
      quest?.id ?? null,
      xp,
      source,
      nowIso(),
    );
    if (quest) {
      run("UPDATE quests SET status = 'done', completed_at = ?, log_id = ? WHERE id = ?", nowIso(), logId, quest.id);
      recordActivity(c.id, user.id, "quest_done", { quest_id: quest.id, title: quest.title, log_id: logId, xp });
    } else {
      recordActivity(c.id, user.id, "logged", {
        log_id: logId,
        value,
        label,
        unit: c.metric_unit,
        metric: c.metric_name,
        note: note.slice(0, 140),
        xp,
      });
    }
    const reached = autoReachMilestones(c, user.id);
    const after = levelFor(memberLogs(c.id, user.id).reduce((s, l) => s + l.xp, 0) + 0).level;
    if (after > before) recordActivity(c.id, user.id, "level", { level: after });
    return { log_id: logId, xp, milestones_reached: reached.map((r) => ({ id: r.id, title: r.title })) };
  });
}

export function removeLog(user: UserRow, slug: string, logId: string) {
  const c = getChallenge(slug);
  requireMember(c, user.id);
  const row = one<{ user_id: string; deleted_at: string | null; quest_id: string | null }>(
    "SELECT user_id, deleted_at, quest_id FROM logs WHERE id = ? AND challenge_id = ?",
    logId,
    c.id,
  );
  if (!row || row.deleted_at) throw new AppError("not_found", "Log entry not found.");
  if (row.user_id !== user.id) throw new AppError("forbidden", "You can only remove your own log entries.");
  tx(() => {
    run("UPDATE logs SET deleted_at = ? WHERE id = ?", nowIso(), logId);
    if (row.quest_id) run("UPDATE quests SET status = 'open', completed_at = NULL, log_id = NULL WHERE id = ?", row.quest_id);
  });
}

type LogRow = LogEntry & {
  user_id: string;
  quest_title: string | null;
  cheers: number;
  handle: string;
  display_name: string;
  avatar: string;
  agent_name: string | null;
  agent_kind: string | null;
  agent_seen_at: string | null;
};

export function listLogs(challengeId: string, opts: { userId?: string; limit?: number } = {}): LogEntry[] {
  const params: unknown[] = [challengeId];
  let where = "l.challenge_id = ? AND l.deleted_at IS NULL";
  if (opts.userId) {
    where += " AND l.user_id = ?";
    params.push(opts.userId);
  }
  params.push(Math.min(opts.limit ?? 30, 200));
  return all<LogRow>(
    `SELECT l.id, l.logged_for, l.value, l.label, l.note, l.evidence_url, l.xp, l.source, l.created_at, l.user_id,
            q.title AS quest_title, (SELECT COUNT(*) FROM cheers ch WHERE ch.log_id = l.id) AS cheers,
            u.handle, u.display_name, u.avatar, u.agent_name, u.agent_kind, u.agent_seen_at
     FROM logs l JOIN users u ON u.id = l.user_id LEFT JOIN quests q ON q.id = l.quest_id
     WHERE ${where} ORDER BY l.logged_for DESC, l.created_at DESC LIMIT ?`,
    ...params,
  ).map((r) => ({
    id: r.id,
    logged_for: r.logged_for,
    value: r.value,
    label: r.label,
    note: r.note,
    evidence_url: r.evidence_url,
    xp: r.xp,
    source: r.source,
    created_at: r.created_at,
    quest_title: r.quest_title,
    cheers: r.cheers,
    user: publicUser(r),
  }));
}

export function cheer(user: UserRow, logId: string): { cheers: number } {
  const log = one<{ challenge_id: string; user_id: string }>("SELECT challenge_id, user_id FROM logs WHERE id = ? AND deleted_at IS NULL", logId);
  if (!log) throw new AppError("not_found", "Log entry not found.");
  if (log.user_id === user.id) throw new AppError("invalid", "You can't cheer your own entry.");
  const existing = one("SELECT 1 FROM cheers WHERE log_id = ? AND user_id = ?", logId, user.id);
  if (existing) run("DELETE FROM cheers WHERE log_id = ? AND user_id = ?", logId, user.id);
  else run("INSERT INTO cheers (log_id, user_id, created_at) VALUES (?, ?, ?)", logId, user.id, nowIso());
  return { cheers: one<{ n: number }>("SELECT COUNT(*) n FROM cheers WHERE log_id = ?", logId)!.n };
}

// ---------- Facts ----------

export function memberFacts(c: ChallengeRow, m: MembershipRow): Facts {
  const user = getUser(m.user_id);
  const plan = currentPlan(c.id, m.user_id);
  const board = standings(c);
  const idx = board.findIndex((s) => s.handle === user.handle);
  const me = board[idx];
  const above = idx > 0 ? board[idx - 1] : null;
  const metric = metricOf(c);
  let gap: number | null = null;
  if (above && me && metric.direction === "up" && metric.aggregation !== "latest") gap = Math.max(0, Math.round((above.total - me.total) * 100) / 100);
  const openQuests = one<{ n: number }>(
    "SELECT COUNT(*) n FROM quests WHERE challenge_id = ? AND user_id = ? AND status = 'open'",
    c.id,
    m.user_id,
  )!.n;
  return computeFacts({
    today: dateIn(user.timezone),
    starts_on: m.starts_on,
    ends_on: m.ends_on,
    status: m.status,
    metric,
    milestones: plan?.milestones ?? [],
    logs: memberLogs(c.id, m.user_id),
    open_quests: openQuests,
    standing: { rank: me?.rank ?? null, members: board.length, gap_to_next: gap },
  });
}

export { MILESTONE_XP };
