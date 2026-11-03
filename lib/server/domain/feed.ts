import type { ActivityItem, Theme } from "@/lib/shared/types";
import { all, run } from "../db";
import { id, nowIso, parseJson } from "../util";

export type ActivityKind =
  | "started"
  | "joined"
  | "logged"
  | "quest_done"
  | "milestone"
  | "plan"
  | "space"
  | "completed"
  | "level";

export function recordActivity(challengeId: string, userId: string | null, kind: ActivityKind, data: Record<string, unknown>) {
  run(
    "INSERT INTO activity (id, challenge_id, user_id, kind, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id("act"),
    challengeId,
    userId,
    kind,
    JSON.stringify(data),
    nowIso(),
  );
}

type Row = {
  id: string;
  kind: string;
  created_at: string;
  data_json: string;
  handle: string | null;
  display_name: string | null;
  avatar: string | null;
  agent_name: string | null;
  agent_kind: string | null;
  agent_seen_at: string | null;
  slug: string;
  title: string;
  emoji: string;
  theme: Theme;
};

export function listActivity(opts: { challengeId?: string; userId?: string; limit?: number; before?: string }): ActivityItem[] {
  const where: string[] = ["c.status != 'draft'"];
  const params: unknown[] = [];
  if (opts.challengeId) {
    where.push("a.challenge_id = ?");
    params.push(opts.challengeId);
  }
  if (opts.userId) {
    where.push("a.user_id = ?");
    params.push(opts.userId);
  }
  if (opts.before) {
    where.push("a.created_at < ?");
    params.push(opts.before);
  }
  params.push(Math.min(opts.limit ?? 30, 100));
  const rows = all<Row>(
    `SELECT a.id, a.kind, a.created_at, a.data_json, u.handle, u.display_name, u.avatar, u.agent_name, u.agent_kind,
            u.agent_seen_at, c.slug, c.title, c.emoji, c.theme
     FROM activity a JOIN challenges c ON c.id = a.challenge_id LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC LIMIT ?`,
    ...params,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    created_at: r.created_at,
    data: parseJson<Record<string, unknown>>(r.data_json, {}),
    user: r.handle
      ? {
          handle: r.handle,
          display_name: r.display_name!,
          avatar: r.avatar!,
          agent_name: r.agent_name,
          agent_kind: r.agent_kind,
          agent_seen_at: r.agent_seen_at,
        }
      : null,
    challenge: { slug: r.slug, title: r.title, emoji: r.emoji, theme: r.theme },
  }));
}
