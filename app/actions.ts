"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createApiKey, currentUser, endSession, rotateApiKey, startSession } from "@/lib/server/auth";
import { normalizeDraft, DraftSchema, styleFromChoices } from "@/lib/server/ai/draft";
import { createChallenge, getChallenge, joinChallenge } from "@/lib/server/domain/challenges";
import { addQuests, cheer, logProgress, setPlan, skipQuest } from "@/lib/server/domain/progress";
import { createUser } from "@/lib/server/domain/users";
import { requestSpace, restoreSpaceVersion, type SpaceTarget } from "@/lib/server/spaces";
import { queueCover } from "@/lib/server/covers";
import { queueStarterPlan } from "@/lib/server/starter";
import { tx } from "@/lib/server/db";
import { AppError, dateIn, isValidTimeZone } from "@/lib/server/util";
import { rateLimit } from "@/lib/server/http";
import { queueVirgil } from "@/lib/server/virgils";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  console.error("[action]", e);
  return { ok: false, error: "Something went wrong. Try again." };
}

async function limitByIp(bucket: string, perMinute: number, burst: number) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  rateLimit(`${bucket}:${ip}`, perMinute, burst);
}

async function requireUser() {
  const u = await currentUser();
  if (!u) throw new AppError("unauthorized", "Sign in first.");
  return u;
}

// ---------- Start flow ----------

const StartInput = z.object({
  draft: DraftSchema,
  name: z.string().min(1).max(40),
  timezone: z.string().max(64),
  choices: z.array(z.enum(["gentle", "firm"])).max(5),
  idea: z.string().max(300),
});

/** Creates the account, the challenge, its first plan and quests, and an agent key. */
export async function startChallenge(input: unknown): Promise<ActionResult<{ slug: string; key: string; handle: string }>> {
  try {
    await limitByIp("start", 2, 6);
    const parsed = StartInput.safeParse(input);
    if (!parsed.success) throw new AppError("invalid", "Some details are missing. Go back a step and try again.");
    const { name, choices } = parsed.data;
    const tz = isValidTimeZone(parsed.data.timezone) ? parsed.data.timezone : "UTC";
    const draft = normalizeDraft(parsed.data.draft, dateIn(tz));
    const existing = await currentUser();
    const result = tx(() => {
      const user = existing ?? createUser({ display_name: name, timezone: tz, motivation_style: styleFromChoices(choices) });
      const c = createChallenge(user, {
        title: draft.title,
        tagline: draft.tagline,
        description_md: "",
        emoji: draft.icon,
        theme: draft.theme,
        category: draft.category,
        metric: draft.metric,
        status: "active",
      });
      setPlan(
        user,
        c.slug,
        {
          summary_md: draft.plan_summary,
          cadence: draft.cadence,
          milestones: draft.camps.map((m) => ({ title: m.title, detail: m.detail, target: m.target, due_on: m.due_on, emoji: m.icon })),
          reason: "First draft from your one-line idea",
        },
        "system",
      );
      addQuests(user, c.slug, draft.first_quests.map((q) => ({ title: q.title, detail: q.detail, kind: q.kind, xp: q.xp })));
      const { key } = createApiKey(user.id);
      return { user, slug: c.slug, key, challengeId: c.id };
    });
    if (!existing) await startSession(result.user.id);
    queueCover(result.challengeId);
    queueVirgil(result.challengeId);
    return { ok: true, data: { slug: result.slug, key: result.key, handle: result.user.handle } };
  } catch (e) {
    return failure(e);
  }
}

/** Joins a challenge, creating a lightweight account first if needed. */
export async function joinAction(slug: string, name?: string, timezone?: string): Promise<ActionResult<{ handle: string }>> {
  try {
    let user = await currentUser();
    if (!user) {
      await limitByIp("join", 2, 6);
      if (!name?.trim()) throw new AppError("invalid", "Tell us your name to join.");
      const tz = timezone && isValidTimeZone(timezone) ? timezone : "UTC";
      user = createUser({ display_name: name, timezone: tz });
      // No API key yet: the Your AI panel makes one when they connect an agent.
      await startSession(user.id);
    }
    const joined = joinChallenge(user, slug);
    if (!joined.already) queueStarterPlan(user, slug);
    revalidatePath(`/c/${slug}`);
    return { ok: true, data: { handle: user.handle } };
  } catch (e) {
    return failure(e);
  }
}

// ---------- Progress from the web ----------

export async function logFromWeb(
  slug: string,
  input: { value?: number | null; label?: string; note?: string; quest_id?: string; date?: string },
): Promise<ActionResult<{ milestones: string[] }>> {
  try {
    const user = await requireUser();
    const r = logProgress(user, slug, input, "web");
    revalidatePath(`/c/${slug}`);
    revalidatePath(`/c/${slug}/${user.handle}`);
    return { ok: true, data: { milestones: r.milestones_reached.map((m) => m.title) } };
  } catch (e) {
    return failure(e);
  }
}

export async function skipQuestAction(slug: string, questId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    skipQuest(user, slug, questId);
    revalidatePath(`/c/${slug}/${user.handle}`);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function cheerAction(logId: string): Promise<ActionResult<{ cheers: number }>> {
  try {
    const user = await requireUser();
    return { ok: true, data: cheer(user, logId) };
  } catch (e) {
    return failure(e);
  }
}

export async function requestSpaceAction(slug: string, target: SpaceTarget, request: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    rateLimit(`space:${user.id}`, 2, 4);
    requestSpace(user, slug, target, request, "web");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function restoreSpaceAction(slug: string, target: SpaceTarget, versionId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    restoreSpaceVersion(user, slug, target, versionId);
    revalidatePath(`/c/${slug}`);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

// ---------- Account ----------

export async function newKeyAction(): Promise<ActionResult<{ key: string }>> {
  try {
    const user = await requireUser();
    return { ok: true, data: { key: rotateApiKey(user.id).key } };
  } catch (e) {
    return failure(e);
  }
}

export async function signOutAction() {
  await endSession();
  redirect("/");
}

export async function challengeExists(slug: string): Promise<boolean> {
  try {
    getChallenge(slug);
    return true;
  } catch {
    return false;
  }
}
