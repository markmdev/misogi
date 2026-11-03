// The data a generated space reads. It's inlined into the page as
// <script id="misogi-data" type="application/json"> on every load.

import type { Facts, Metric, Milestone, Quest, Theme } from "@/lib/shared/types";
import { all, one } from "./db";
import { getMembership, metricOf, standings, type ChallengeRow } from "./domain/challenges";
import { currentPlan, listQuests, memberFacts } from "./domain/progress";
import { getUser } from "./domain/users";

export type SpaceData = {
  kind: "challenge" | "member";
  challenge: {
    slug: string;
    title: string;
    tagline: string;
    description: string;
    metric: Metric;
    theme: Theme;
    status: string;
    created_on: string;
  };
  /** Present on a member's own space. */
  member: {
    handle: string;
    name: string;
    starts_on: string;
    ends_on: string;
    plan: { summary: string; cadence: string; camps: Milestone[] } | null;
    quests: Pick<Quest, "title" | "detail" | "kind" | "xp" | "due_on" | "status">[];
    facts: Facts;
  } | null;
  members: { handle: string; name: string; total: number; progress: number | null; rank: number; streak: number; level: number }[];
  /** Newest first. On a member space, only that member's entries. */
  logs: { who: string; date: string; value: number | null; label: string | null; note: string }[];
  generated_at: string;
};

export function spaceData(c: ChallengeRow, ownerUserId: string | null): SpaceData {
  const board = standings(c);
  let member: SpaceData["member"] = null;
  if (ownerUserId) {
    const u = getUser(ownerUserId);
    const m = getMembership(c.id, ownerUserId);
    if (m) {
      const plan = currentPlan(c.id, ownerUserId);
      member = {
        handle: u.handle,
        name: u.display_name,
        starts_on: m.starts_on,
        ends_on: m.ends_on,
        plan: plan ? { summary: plan.summary_md, cadence: plan.cadence, camps: plan.milestones } : null,
        quests: listQuests(c.id, ownerUserId).map((q) => ({ title: q.title, detail: q.detail, kind: q.kind, xp: q.xp, due_on: q.due_on, status: q.status })),
        facts: memberFacts(c, m),
      };
    }
  }
  const logs = all<{ display_name: string; logged_for: string; value: number | null; label: string | null; note: string }>(
    `SELECT u.display_name, l.logged_for, l.value, l.label, l.note FROM logs l JOIN users u ON u.id = l.user_id
     WHERE l.challenge_id = ? AND l.deleted_at IS NULL ${ownerUserId ? "AND l.user_id = ?" : ""}
     ORDER BY l.logged_for DESC, l.created_at DESC LIMIT 400`,
    ...(ownerUserId ? [c.id, ownerUserId] : [c.id]),
  );
  return {
    kind: ownerUserId ? "member" : "challenge",
    challenge: {
      slug: c.slug,
      title: c.title,
      tagline: c.tagline,
      description: c.description_md,
      metric: metricOf(c),
      theme: c.theme,
      status: c.status,
      created_on: c.created_at.slice(0, 10),
    },
    member,
    members: board.slice(0, 50).map((s) => ({
      handle: s.handle,
      name: s.display_name,
      total: s.total,
      progress: s.progress,
      rank: s.rank,
      streak: s.streak,
      level: s.level,
    })),
    logs: logs.map((l) => ({ who: l.display_name, date: l.logged_for, value: l.value, label: l.label, note: l.note })),
    generated_at: new Date().toISOString(),
  };
}

/** Escapes JSON so it can't close the script tag it lives in. */
export function inlineJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function exists(versionId: string) {
  return !!one("SELECT 1 FROM space_versions WHERE id = ?", versionId);
}
