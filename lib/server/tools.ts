// Every action an agent can take, defined once. The REST API, the MCP server and
// Virgil (the built-in guide) are thin adapters over this list.

import { z } from "zod";
import { activityText } from "@/lib/shared/format";
import { AGGREGATIONS, THEMES } from "@/lib/shared/types";
import { createSignInToken, type UserRow } from "./auth";
import { agentContext } from "./context";
import {
  CATEGORIES,
  completeMembership,
  createChallenge,
  getChallenge,
  joinChallenge,
  listChallenges,
  myChallenges,
  requireMember,
  updateChallenge,
} from "./domain/challenges";
import { listActivity } from "./domain/feed";
import { addQuests, completeMilestone, logProgress, memberFacts, removeLog, setPlan, skipQuest } from "./domain/progress";
import { getUser, publicUser, touchAgent, updatePreferences } from "./domain/users";
import { queueCover } from "./covers";
import { ownerKeyFor, queueChallengeApp, requestSpace, spaceStatus, undoSpace } from "./spaces";
import { queueVirgil } from "./virgils";
import { AppError } from "./util";

export type ToolSource = "muse" | "agent" | "mcp" | "virgil" | "web";

export type ToolCtx = { user: UserRow; source: ToolSource; origin: string };

type AnyObject = z.ZodObject<z.ZodRawShape>;

export type ToolDef<S extends AnyObject = AnyObject> = {
  name: string;
  /** Short present-tense label for UIs, e.g. "Logging progress". */
  label: string;
  description: string;
  input: S;
  /** Tools that change something. Read-only tools can be retried freely. */
  writes: boolean;
  handler: (ctx: ToolCtx, args: z.infer<S>) => unknown | Promise<unknown>;
};

function tool<S extends AnyObject>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

const challengeArg = z.string().describe("The challenge slug, e.g. \"learn-mandarin\". Get it from list_my_challenges.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const metricSchema = z.object({
  name: z.string().describe("What's counted, e.g. \"miles run\", \"books read\", \"days practiced\", \"HSK level\""),
  unit: z.string().optional().describe("Unit for values, e.g. \"mi\", \"books\"; empty if none"),
  target: z.number().nullable().optional().describe("Number to reach by the end of the year"),
  aggregation: z
    .enum(AGGREGATIONS)
    .describe("sum = add values (miles); count = items done (books); days = days with a log (daily habits); distinct = different labels (states visited); latest = newest value is the level (HSK level)"),
  direction: z.enum(["up", "down"]).optional().describe("\"down\" when lower is better, like a 5k time. Default up."),
});

const milestoneSchema = z.object({
  id: z.string().optional().describe("Keep an existing camp's id when re-planning so progress carries over"),
  title: z.string().describe("Camp name, max 80 chars"),
  detail: z.string().optional(),
  target: z.number().nullable().optional().describe("Metric value that marks this camp (it's then marked reached automatically)"),
  due_on: date.nullable().optional(),
  emoji: z.string().optional().describe("Icon name, e.g. camp, flag, summit, books, streak, trophy"),
});

const questSchema = z.object({
  title: z.string().describe("A concrete step doable in one sitting, max 100 chars"),
  detail: z.string().optional(),
  kind: z.enum(["daily", "weekly", "boss", "one_off"]).optional().describe("\"boss\" for a camp's final test"),
  xp: z.number().optional().describe("Reward, 10–80 (boss up to 200). Default 20."),
  due_on: date.nullable().optional(),
});

function url(ctx: ToolCtx, path: string) {
  return `${ctx.origin}${path}`;
}

export const TOOLS = [
  tool({
    name: "list_my_challenges",
    label: "Checking your challenges",
    writes: false,
    description:
      "Start here. Returns the person you're guiding (name, motivation style, time zone) and every challenge they're in, with headline facts.",
    input: z.object({}),
    handler: (ctx) => {
      const me = getUser(ctx.user.id);
      return {
        person: { ...publicUser(me), motivation_style: me.motivation_style, timezone: me.timezone, page: url(ctx, `/u/${me.handle}`) },
        challenges: myChallenges(me.id).map((c) => {
          const ch = getChallenge(c.slug);
          const m = requireMember(ch, me.id);
          const f = memberFacts(ch, m);
          return {
            slug: c.slug,
            title: c.title,
            status: c.status,
            role: c.role,
            membership: c.membership_status,
            metric: c.metric,
            total: f.total,
            progress: f.progress,
            streak: f.streak,
            days_since_last_log: f.days_since_last_log,
            members: c.members,
            url: url(ctx, `/c/${c.slug}`),
          };
        }),
      };
    },
  }),
  tool({
    name: "get_challenge",
    label: "Reading the challenge",
    writes: false,
    description:
      "The complete current record for one challenge, from the caller's point of view: challenge, facts (pace, streak, gaps, rank), plan, quests, recent logs, nearby leaderboard, space status and setup steps still missing. Call it at the start of every check-in.",
    input: z.object({
      challenge: challengeArg,
      include_playbook: z.boolean().optional().describe("Include the coaching playbook (do this the first time in a session)."),
    }),
    handler: (ctx, a) => agentContext(ctx.user, a.challenge, ctx.origin, a.include_playbook ?? false),
  }),
  tool({
    name: "create_challenge",
    label: "Starting a challenge",
    writes: true,
    description:
      "Start a new challenge for the person (they become its creator). Run the intake first so the title and metric are right. Returns the slug.",
    input: z.object({
      title: z.string().describe("Short, vivid title, max 80 chars"),
      tagline: z.string().optional().describe("One sentence on why it matters to them"),
      description_md: z.string().optional().describe("A short public description (markdown)"),
      metric: metricSchema,
      category: z.enum(CATEGORIES).optional(),
      emoji: z.string().optional().describe("Icon name, e.g. language, running, books, code, smarthome, music"),
      theme: z.enum(THEMES).optional().describe("Color theme for the page"),
      starts_on: date.optional().describe("Defaults to today"),
    }),
    handler: (ctx, a) => {
      const c = createChallenge(ctx.user, { ...a, status: "active" });
      queueCover(c.id);
      queueVirgil(c.id);
      queueChallengeApp(c.id);
      return { slug: c.slug, url: url(ctx, `/c/${c.slug}`), next: "Run set_plan with the curriculum, then add_quests for this week." };
    },
  }),
  tool({
    name: "update_challenge",
    label: "Updating the challenge",
    writes: true,
    description:
      "Change the shared challenge (creator only): title, tagline, description, icon, theme or metric. Set status \"active\" to publish a draft started on the website. The way progress is counted locks once others join.",
    input: z.object({
      challenge: challengeArg,
      title: z.string().optional(),
      tagline: z.string().optional(),
      description_md: z.string().optional(),
      metric: metricSchema.optional(),
      category: z.enum(CATEGORIES).optional(),
      emoji: z.string().optional(),
      theme: z.enum(THEMES).optional(),
      status: z.enum(["active"]).optional(),
    }),
    handler: (ctx, a) => {
      const { challenge, ...patch } = a;
      const c = updateChallenge(ctx.user, challenge, patch);
      return { slug: c.slug, status: c.status, url: url(ctx, `/c/${c.slug}`) };
    },
  }),
  tool({
    name: "set_plan",
    label: "Writing the plan",
    writes: true,
    description:
      "Save a new version of the caller's plan: the curriculum for their year. Camps are milestones (4–8, the first within weeks). Give camps numeric targets when the metric allows. Every version is kept; say why it changed in `reason`.",
    input: z.object({
      challenge: challengeArg,
      summary_md: z.string().describe("The approach for the year, 3–8 sentences, addressed to the person"),
      cadence: z.string().describe("How often they practice and you check in, e.g. \"4 sessions a week, check-in Sun 7pm\""),
      milestones: z.array(milestoneSchema).describe("Camps in order"),
      reason: z.string().describe("Why this version: \"first plan\", \"fell behind after the flu\", ..."),
    }),
    handler: (ctx, a) => {
      const plan = setPlan(ctx.user, a.challenge, a, ctx.source === "virgil" ? "virgil" : "agent");
      return { version: plan.version, milestones: plan.milestones.map((m) => ({ id: m.id, title: m.title, done: !!m.done_at })) };
    },
  }),
  tool({
    name: "add_quests",
    label: "Adding quests",
    writes: true,
    description: "Add this week's quests: 3–5 concrete steps toward the next camp. Use replace_open=true for a weekly refresh.",
    input: z.object({
      challenge: challengeArg,
      quests: z.array(questSchema),
      replace_open: z.boolean().optional().describe("Skip all currently open quests first"),
    }),
    handler: (ctx, a) => ({ quests: addQuests(ctx.user, a.challenge, a.quests, a.replace_open ?? false) }),
  }),
  tool({
    name: "skip_quest",
    label: "Skipping a quest",
    writes: true,
    description: "Close an open quest without completing it.",
    input: z.object({ challenge: challengeArg, quest_id: z.string() }),
    handler: (ctx, a) => {
      skipQuest(ctx.user, a.challenge, a.quest_id);
      return { ok: true };
    },
  }),
  tool({
    name: "log_progress",
    label: "Logging progress",
    writes: true,
    description:
      "Record what the person actually did. `value` is a number in the metric's unit (needed for sum/latest metrics; leave it out only for a practice check-in that doesn't change the number, and then add a note). `label` names the thing for distinct metrics (e.g. a state). Backdate with `date`. Pass quest_id to complete a quest. Returns updated facts.",
    input: z.object({
      challenge: challengeArg,
      value: z.number().nullable().optional(),
      label: z.string().optional(),
      note: z.string().optional().describe("Short note in their words"),
      date: date.optional().describe("Day it happened, in their time zone. Defaults to today."),
      evidence_url: z.string().optional().describe("Link to proof, like a Strava activity"),
      quest_id: z.string().optional(),
    }),
    handler: (ctx, a) => {
      const { challenge, ...input } = a;
      const result = logProgress(ctx.user, challenge, input, ctx.source);
      const c = getChallenge(challenge);
      const f = memberFacts(c, requireMember(c, ctx.user.id));
      return {
        ...result,
        facts: {
          total: f.total,
          target: f.target,
          progress: f.progress,
          pace: f.pace,
          streak: f.streak,
          xp: f.xp,
          level: f.level,
          rank: f.rank,
          next_milestone: f.next_milestone,
        },
      };
    },
  }),
  tool({
    name: "remove_log",
    label: "Removing a log entry",
    writes: true,
    description: "Delete one of the caller's own log entries (to fix a mistake).",
    input: z.object({ challenge: challengeArg, log_id: z.string() }),
    handler: (ctx, a) => {
      removeLog(ctx.user, a.challenge, a.log_id);
      return { ok: true };
    },
  }),
  tool({
    name: "complete_milestone",
    label: "Marking a camp reached",
    writes: true,
    description: "Mark a camp in the current plan as reached (for camps without a numeric target).",
    input: z.object({ challenge: challengeArg, milestone_id: z.string() }),
    handler: (ctx, a) => {
      const m = completeMilestone(ctx.user, a.challenge, a.milestone_id);
      return { id: m.id, title: m.title, done_at: m.done_at };
    },
  }),
  tool({
    name: "update_space",
    label: "Building the page",
    writes: true,
    description:
      "Ask Misogi to build a new version of a space: a small web page generated from your description. target \"me\" is the caller's own space; \"challenge\" is the shared page (creator only). Describe what to show and the feel. It builds in the background (about a minute); check with get_space.",
    input: z.object({
      challenge: challengeArg,
      target: z.enum(["me", "challenge"]),
      request: z.string().describe("What the page should show and feel like, in plain words"),
    }),
    handler: (ctx, a) => {
      const r = requestSpace(ctx.user, a.challenge, a.target, a.request, ctx.source === "virgil" ? "virgil" : "agent");
      const page = a.target === "me" ? `/c/${a.challenge}/${ctx.user.handle}` : `/c/${a.challenge}`;
      return { ...r, page: url(ctx, page), note: "Building now. It usually takes 30–90 seconds." };
    },
  }),
  tool({
    name: "get_space",
    label: "Checking the page",
    writes: false,
    description: "Status of a space: the live version, any build in progress, and the last failure with its reason.",
    input: z.object({ challenge: challengeArg, target: z.enum(["me", "challenge"]) }),
    handler: (ctx, a) => {
      const c = getChallenge(a.challenge);
      requireMember(c, ctx.user.id);
      const s = spaceStatus(c.id, ownerKeyFor(a.target, ctx.user.id));
      return { ...s, current: s.current ? { ...s.current, url: url(ctx, s.current.url) } : null };
    },
  }),
  tool({
    name: "undo_space",
    label: "Undoing the page",
    writes: true,
    description: "Go back to the previous version of a space.",
    input: z.object({ challenge: challengeArg, target: z.enum(["me", "challenge"]) }),
    handler: (ctx, a) => undoSpace(ctx.user, a.challenge, a.target),
  }),
  tool({
    name: "browse_challenges",
    label: "Browsing challenges",
    writes: false,
    description: "Find live challenges to join and templates to start from (including Mark Zuckerberg's yearly challenges).",
    input: z.object({ query: z.string().optional() }),
    handler: (ctx, a) => ({
      challenges: listChallenges({ status: ["active", "template"], query: a.query, limit: 25 }).map((c) => ({
        slug: c.slug,
        title: c.title,
        tagline: c.tagline,
        status: c.status,
        members: c.members,
        metric: c.metric,
        template: c.template_label,
        url: url(ctx, `/c/${c.slug}`),
      })),
    }),
  }),
  tool({
    name: "join_challenge",
    label: "Joining a challenge",
    writes: true,
    description: "Join someone's live challenge: same goal and leaderboard, the caller's own plan and pace.",
    input: z.object({ challenge: challengeArg }),
    handler: (ctx, a) => {
      const r = joinChallenge(ctx.user, a.challenge);
      return {
        slug: r.challenge.slug,
        already_member: r.already,
        next: "Run a short intake for this person, then set_plan and add_quests.",
        url: url(ctx, `/c/${r.challenge.slug}`),
      };
    },
  }),
  tool({
    name: "get_feed",
    label: "Reading the feed",
    writes: false,
    description: "Recent activity from others in a challenge (joins, logs, camps reached), for cheering and friendly competition.",
    input: z.object({ challenge: challengeArg.optional() }),
    handler: (ctx, a) => {
      const c = a.challenge ? getChallenge(a.challenge) : null;
      return {
        items: listActivity({ challengeId: c?.id, limit: 20 }).map((i) => ({
          kind: i.kind,
          at: i.created_at,
          who: i.user?.display_name ?? null,
          challenge: i.challenge.slug,
          text: activityText(i),
          data: i.data,
        })),
      };
    },
  }),
  tool({
    name: "set_preferences",
    label: "Saving preferences",
    writes: true,
    description:
      "Update the person's profile: display name, motivation style (how they like to be pushed, in a sentence), IANA time zone, and agent_name (YOUR name, shown on their page as their guide).",
    input: z.object({
      display_name: z.string().optional(),
      motivation_style: z.string().optional(),
      timezone: z.string().optional().describe("IANA name, e.g. America/Los_Angeles"),
      agent_name: z.string().optional(),
    }),
    handler: (ctx, a) => {
      const u = updatePreferences(ctx.user.id, a);
      return { display_name: u.display_name, motivation_style: u.motivation_style, timezone: u.timezone, agent_name: u.agent_name };
    },
  }),
  tool({
    name: "complete_challenge",
    label: "Reaching the summit",
    writes: true,
    description:
      "Finish the caller's challenge with a year-in-review (what they did, what changed, the hardest stretch) and their honest answer to whether Misogi helped.",
    input: z.object({
      challenge: challengeArg,
      review_md: z.string(),
      helpful: z.boolean(),
      helpful_note: z.string().optional(),
    }),
    handler: (ctx, a) => {
      completeMembership(ctx.user, a.challenge, a);
      return { ok: true, url: url(ctx, `/c/${a.challenge}/${ctx.user.handle}`) };
    },
  }),
  tool({
    name: "get_sign_in_link",
    label: "Making a sign-in link",
    writes: true,
    description: "A one-time link (valid 15 minutes) that signs the person in to Misogi on a new device.",
    input: z.object({}),
    handler: (ctx) => ({ url: url(ctx, `/signin/${createSignInToken(ctx.user.id)}`), expires_in_minutes: 15 }),
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

const BY_NAME = new Map<string, ToolDef>(TOOLS.map((t) => [t.name, t as unknown as ToolDef]));

export function findTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

export type ToolResult = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; hint?: string } };

export async function runTool(name: string, ctx: ToolCtx, rawArgs: unknown): Promise<ToolResult> {
  const def = findTool(name);
  if (!def) return { ok: false, error: { code: "not_found", message: `Unknown tool "${name}".`, hint: "GET /api/v1/tools lists them." } };
  const parsed = def.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { ok: false, error: { code: "invalid", message: `Invalid arguments for ${name}: ${issues}` } };
  }
  try {
    if (ctx.source !== "web") touchAgent(ctx.user.id, ctx.source);
    const result = await def.handler(ctx, parsed.data);
    return { ok: true, result };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message, hint: e.hint } };
    console.error(`[tool] ${name} failed`, e);
    return { ok: false, error: { code: "internal", message: "Something went wrong on Misogi's side." } };
  }
}

/** JSON Schemas for the API docs, the agent guide and model function calling. */
export function toolSchemas() {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, writes: t.writes, input_schema: schema };
  });
}
