// A starter plan for people who join someone else's challenge from the web, so their page isn't empty.

import { starterPlan } from "./ai/draft";
import type { UserRow } from "./auth";
import { getChallenge, metricOf } from "./domain/challenges";
import { addQuests, currentPlan, setPlan } from "./domain/progress";
import { dateIn } from "./util";
import { finishBeforeExit } from "./unfinished";

const state = globalThis as unknown as { __starting?: Set<string> };
const inFlight = () => (state.__starting ??= new Set());

/** Drafts and saves a starter plan in the background. Never throws; skips if a plan appears meanwhile. */
export function queueStarterPlan(user: UserRow, slug: string) {
  const key = `${user.id}:${slug}`;
  if (inFlight().has(key)) return;
  inFlight().add(key);
  void finishBeforeExit((async () => {
    try {
      const c = getChallenge(slug);
      if (currentPlan(c.id, user.id)) return;
      const s = await starterPlan({ title: c.title, tagline: c.tagline, metric: metricOf(c) }, dateIn(user.timezone), user.id);
      // Their own AI may have written a plan while we were drafting; theirs wins.
      if (currentPlan(c.id, user.id)) return;
      setPlan(
        user,
        slug,
        {
          summary_md: s.plan_summary,
          cadence: s.cadence,
          milestones: s.camps.map((m) => ({ title: m.title, detail: m.detail, target: m.target, due_on: m.due_on, emoji: m.icon })),
          reason: "Starter plan for joining. Your AI makes it yours after a short chat.",
        },
        "system",
      );
      addQuests(user, slug, s.first_quests.map((q) => ({ title: q.title, detail: q.detail, kind: q.kind, xp: q.xp })));
    } catch (e) {
      console.error("[starter] failed", e instanceof Error ? e.message : e);
    } finally {
      inFlight().delete(key);
    }
  })());
}
