// The packet an agent reads at every check-in: one complete, current record.

import type { UserRow } from "./auth";
import { getChallenge, metricOf, requireMember, standings } from "./domain/challenges";
import { currentPlan, listLogs, listQuests, memberFacts } from "./domain/progress";
import { PLAYBOOK } from "./playbook";
import { ownerKeyFor, spaceStatus } from "./spaces";

export function agentContext(user: UserRow, slug: string, origin: string, includePlaybook: boolean) {
  const c = getChallenge(slug);
  const m = requireMember(c, user.id);
  const facts = memberFacts(c, m);
  const plan = currentPlan(c.id, user.id);
  const quests = listQuests(c.id, user.id);
  const board = standings(c);
  const meIdx = board.findIndex((s) => s.handle === user.handle);
  const nearby = board.filter((_, i) => i < 5 || Math.abs(i - meIdx) <= 1);
  const shared = spaceStatus(c.id, ownerKeyFor("challenge", user.id));
  const mine = spaceStatus(c.id, ownerKeyFor("me", user.id));

  const setup: string[] = [];
  if (c.status === "draft") setup.push("The challenge is a draft. After the intake, call update_challenge with status \"active\".");
  if (!plan) setup.push("No plan yet. Run the intake, then call set_plan.");
  if (plan && quests.filter((q) => q.status === "open").length === 0) setup.push("No open quests. Add this week's quests with add_quests.");
  if (!mine.current && !mine.pending) setup.push("No personal space yet. Describe one with update_space (target \"me\").");
  if (m.role === "creator" && !shared.current && !shared.pending)
    setup.push("The shared challenge page has no space yet. Describe one with update_space (target \"challenge\").");
  if (!user.agent_name) setup.push("Tell Misogi your name with set_preferences (agent_name) so the person sees who's guiding them.");

  return {
    challenge: {
      slug: c.slug,
      title: c.title,
      tagline: c.tagline,
      description: c.description_md,
      status: c.status,
      metric: metricOf(c),
      url: `${origin}/c/${c.slug}`,
    },
    you: {
      name: user.display_name,
      handle: user.handle,
      role: m.role,
      motivation_style: user.motivation_style || "Not set. Ask how they like to be pushed, then save it with set_preferences.",
      timezone: user.timezone,
      starts_on: m.starts_on,
      ends_on: m.ends_on,
      status: m.status,
      page: `${origin}/c/${c.slug}/${user.handle}`,
    },
    facts,
    plan,
    quests: {
      open: quests.filter((q) => q.status === "open"),
      recently_done: quests.filter((q) => q.status === "done").slice(0, 8),
    },
    recent_logs: listLogs(c.id, { userId: user.id, limit: 20 }).map((l) => ({
      id: l.id,
      date: l.logged_for,
      value: l.value,
      label: l.label,
      note: l.note,
      quest: l.quest_title,
      cheers: l.cheers,
    })),
    leaderboard: nearby.map((s) => ({
      rank: s.rank,
      name: s.display_name,
      handle: s.handle,
      total: s.total,
      progress: s.progress,
      streak: s.streak,
      last_log_on: s.last_log_on,
      is_you: s.handle === user.handle,
    })),
    spaces: { challenge: shared, me: mine },
    setup,
    ...(includePlaybook ? { playbook: PLAYBOOK } : {}),
  };
}
