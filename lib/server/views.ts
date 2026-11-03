// Data loaders for pages. Each returns plain objects the UI can render.

import type { UserRow } from "./auth";
import { keyStatus } from "./auth";
import { findChallenge, getMembership, metricOf, standings, summarize, type ChallengeRow } from "./domain/challenges";
import { listActivity } from "./domain/feed";
import { currentPlan, listLogs, listQuests, memberFacts, planHistory } from "./domain/progress";
import { getUserByHandle, publicUser } from "./domain/users";
import { ownerKeyFor, spaceHistory, spaceStatus } from "./spaces";
import { one } from "./db";

export function challengeView(slug: string, viewer: UserRow | null) {
  const c = findChallenge(slug);
  if (!c || c.status === "draft") {
    // Drafts are visible only to their creator.
    if (!c || !viewer || c.creator_id !== viewer.id) return null;
  }
  const summary = summarize(c);
  const board = c.status === "template" ? [] : standings(c);
  const membership = viewer ? getMembership(c.id, viewer.id) : null;
  const isMember = !!membership && membership.status !== "left";
  const myFacts = isMember ? memberFacts(c, membership!) : null;
  const myPlan = isMember ? currentPlan(c.id, viewer!.id) : null;
  const creator = c.creator_id ? one<UserRow>("SELECT * FROM users WHERE id = ?", c.creator_id) : null;
  return {
    c,
    summary,
    metric: metricOf(c),
    board,
    feed: listActivity({ challengeId: c.id, limit: 25 }),
    space: spaceStatus(c.id, ""),
    spaceVersions: spaceHistory(c.id, ""),
    creator: creator ? publicUser(creator) : null,
    viewer: viewer ? { ...publicUser(viewer), id: viewer.id } : null,
    membership,
    isMember,
    isCreator: membership?.role === "creator",
    myFacts,
    myPlan,
  };
}

export function memberView(slug: string, handle: string, viewer: UserRow | null) {
  const c = findChallenge(slug);
  if (!c || c.status === "template") return null;
  const user = getUserByHandle(handle);
  if (!user) return null;
  const m = getMembership(c.id, user.id);
  if (!m || m.status === "left") return null;
  if (c.status === "draft" && viewer?.id !== user.id) return null;
  const isOwner = viewer?.id === user.id;
  return {
    c,
    summary: summarize(c),
    metric: metricOf(c),
    user: publicUser(user),
    userId: user.id,
    membership: m,
    facts: memberFacts(c, m),
    plan: currentPlan(c.id, user.id),
    plans: planHistory(c.id, user.id).slice(0, 8),
    quests: listQuests(c.id, user.id),
    logs: listLogs(c.id, { userId: user.id, limit: 60 }),
    space: spaceStatus(c.id, ownerKeyFor("me", user.id)),
    spaceVersions: spaceHistory(c.id, ownerKeyFor("me", user.id)),
    board: standings(c),
    isOwner,
    viewerIsMember: viewer ? !!getMembership(c.id, viewer.id) : false,
    keys: isOwner ? keyStatus(user.id) : null,
  };
}

/** A cheap fingerprint of everything visible on a challenge page; changes when anything updates. */
export function pulse(c: Pick<ChallengeRow, "id" | "updated_at">): string {
  const a = one<{ t: string | null; n: number }>("SELECT MAX(created_at) t, COUNT(*) n FROM activity WHERE challenge_id = ?", c.id);
  const s = one<{ t: string | null }>(
    "SELECT MAX(COALESCE(finished_at, created_at) || status) t FROM space_versions WHERE challenge_id = ?",
    c.id,
  );
  const sp = one<{ t: string | null }>("SELECT GROUP_CONCAT(current_version_id) t FROM spaces WHERE challenge_id = ?", c.id);
  const l = one<{ n: number }>("SELECT COUNT(*) n FROM logs WHERE challenge_id = ? AND deleted_at IS NULL", c.id);
  const q = one<{ t: string | null }>("SELECT MAX(COALESCE(completed_at, created_at)) t FROM quests WHERE challenge_id = ?", c.id);
  const ch = one<{ n: number }>("SELECT COUNT(*) n FROM cheers ch JOIN logs l ON l.id = ch.log_id WHERE l.challenge_id = ?", c.id);
  return [c.updated_at, a?.t, a?.n, s?.t, sp?.t, l?.n, q?.t, ch?.n].join("|");
}
