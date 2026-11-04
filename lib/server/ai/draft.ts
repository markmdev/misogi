// First drafts for the start flow: one line in, a whole year's challenge out.

import { z } from "zod";
import { CATEGORY_ICON, ICONS } from "@/lib/shared/art";
import { AGGREGATIONS, THEMES } from "@/lib/shared/types";
import { CATEGORIES, liveTitles } from "../domain/challenges";
import { addDays, addYear, isIsoDate } from "../util";
import { structured } from "./client";

export const DraftSchema = z.object({
  title: z.string().describe("Short, vivid challenge title, max 48 chars, e.g. 'Hold a 20-minute conversation in Mandarin'"),
  tagline: z.string().describe("One plain sentence on why it matters to them, max 110 chars"),
  category: z.enum(CATEGORIES),
  icon: z.string().describe("One icon name from the allowed list"),
  theme: z.enum(THEMES),
  metric: z.object({
    name: z.string().describe("What's counted, lower case, max 32 chars, e.g. 'miles run', 'books read', 'days practiced', 'HSK level'"),
    unit: z.string().describe("Unit shown after every number: what's counted or measured, plural, e.g. 'mi', 'books', 'parks', 'interviews', 'days', 'level'"),
    target: z.number().nullable().describe("Number to reach by the end of the year, or null if not numeric"),
    aggregation: z.enum(AGGREGATIONS),
    direction: z.enum(["up", "down"]),
  }),
  camps: z
    .array(
      z.object({
        title: z.string().describe("Camp name in sentence case, max 40 chars, no numbering (e.g. 'First five', not 'Camp 1: First Five')"),
        detail: z.string().describe("What being here means, one short sentence"),
        target: z.number().describe("Metric value that marks this camp, higher than the camp before it (lower when lower is better)"),
        due_on: z.string().describe("YYYY-MM-DD"),
        icon: z.string(),
      }),
    )
    .describe("4 to 6 camps across the year; the first within 2–4 weeks"),
  plan_summary: z.string().describe("3–5 sentences: the approach for the year, in plain words, addressed to the person"),
  cadence: z.string().describe("How often to practice and check in, e.g. '4 short sessions a week, check-in Sun'"),
  first_quests: z
    .array(z.object({ title: z.string(), detail: z.string(), kind: z.enum(["daily", "weekly", "boss", "one_off"]), xp: z.number() }))
    .describe("3 concrete quests for the first week, each doable in one sitting"),
});
export type Draft = z.infer<typeof DraftSchema>;

const AGG_GUIDE = `Metric aggregation:
- sum: add up values (miles, hours, pages). Each log has a number.
- count: count completed items (books, essays, songs). Each log is one item.
- days: count days with a log (do X every day, practice streaks).
- distinct: count different labeled things (states visited, recipes cooked, people met).
- latest: the newest value is the level (HSK level, max weight, 5k time). Use direction "down" when lower is better.`;

export async function draftChallenge(idea: string, today: string, visitor?: string): Promise<Draft> {
  const icons = Object.keys(ICONS).join(", ");
  const end = addYear(today);
  const draft = await structured(
    "draft",
    {
      name: "challenge_draft",
      system: `You turn a person's one-line idea for this year's hard challenge (their "misogi") into a clear, motivating plan.
Today is ${today}; the challenge runs to ${end}.
Make the goal concrete and measurable while keeping their intent. Ambitious but possible in a year for a busy adult.
Camps follow skill-building research: first win early, steady load increases, slack for bad weeks, a hard final test.
When the idea names a date or a dated event (a race, an exam, a trip), the last camp is that day, named for the event ("Race day", "Exam day"), and no camp comes after it.
Every camp is a number of the metric, reached by logging it: camp targets use the metric's unit, rise from one camp to the next, and the last camp is the summit.
Write like a sharp friend: short, specific, no clichés, no exclamation marks.
People already climb these challenges on Misogi. When the idea is the same goal as one of them, give it that title exactly, so they can climb together: ${liveTitles().join("; ")}.
${AGG_GUIDE}
Allowed icons: ${icons}.
Pick a theme color that fits the mood: ${THEMES.join(", ")}.`,
      input: `Idea: ${idea.trim().slice(0, 300)}`,
      schema: DraftSchema,
      maxTokens: 6000,
    },
    { visitor },
  );
  return normalizeDraft(draft, today);
}

/** At most `max` characters, ending on a whole word. */
function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1).lastIndexOf(" ");
  return (cut > 0 ? t.slice(0, cut) : t.slice(0, max)).replace(/[\s,;:.\-–—]+$/, "");
}

/** "Yards Swum Non-Stop" → "yards swum non-stop"; acronyms like HSK stay. */
function lowerWords(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(" ");
}

const iconOr = (name: string, fallback: string) => (name in ICONS ? name : fallback);

/** Camps inside the year, in date order, with known icons. */
function normalizeCamps(camps: Draft["camps"], today: string): Draft["camps"] {
  const end = addYear(today);
  const out = camps.slice(0, 6).map((c, i, arr) => {
    let due = isIsoDate(c.due_on) ? c.due_on : addDays(today, Math.round(((i + 1) * 365) / arr.length));
    if (due <= today) due = addDays(today, 14 + i * 30);
    if (due > end) due = end;
    return { ...c, title: clip(c.title, 40), icon: iconOr(c.icon, i === arr.length - 1 ? "summit" : "camp"), due_on: due };
  });
  return out.sort((a, b) => a.due_on.localeCompare(b.due_on));
}

/** Up to 4 quests with sane XP; one gentle default if the model gave none. */
function normalizeQuests(quests: Draft["first_quests"]): Draft["first_quests"] {
  return (quests.length ? quests : [{ title: "Do a first small session", detail: "Fifteen minutes is enough. Just start.", kind: "one_off" as const, xp: 20 }])
    .slice(0, 4)
    .map((q) => ({ ...q, xp: Math.min(Math.max(Math.round(q.xp) || 20, 10), 80) }));
}

/** Keeps model output inside what the product supports. */
export function normalizeDraft(d: Draft, today: string): Draft {
  const fallbackIcon = CATEGORY_ICON[d.category as keyof typeof CATEGORY_ICON] ?? "summit";
  const camps = normalizeCamps(d.camps, today);
  return {
    ...d,
    title: clip(d.title, 60),
    tagline: clip(d.tagline, 120),
    metric: { ...d.metric, name: clip(lowerWords(d.metric.name), 40) || d.metric.name },
    // Generic picks (mountain, tent, flag) say nothing about the challenge; prefer the category's icon.
    icon: ["summit", "camp", "flag"].includes(d.icon) && fallbackIcon !== "summit" ? fallbackIcon : iconOr(d.icon, fallbackIcon),
    camps,
    first_quests: normalizeQuests(d.first_quests),
  };
}

const StarterSchema = DraftSchema.pick({ camps: true, plan_summary: true, cadence: true, first_quests: true });
export type Starter = z.infer<typeof StarterSchema>;

/**
 * A starter plan for someone who just joined an existing challenge: the metric is fixed, so camps use its unit.
 * Their AI (or Virgil) tailors it after a chat.
 */
export async function starterPlan(
  c: { title: string; tagline: string; metric: { name: string; unit: string; target: number | null; aggregation: string; direction: string } },
  today: string,
  visitor?: string,
): Promise<Starter> {
  const icons = Object.keys(ICONS).join(", ");
  const m = c.metric;
  const s = await structured(
    "draft",
    {
      name: "starter_plan",
      system: `Someone just joined a year-long challenge that others are already climbing. Write their starter plan.
Today is ${today}; their year runs to ${addYear(today)}.
The metric is fixed: ${m.name}${m.unit ? ` (${m.unit})` : ""}, counted by "${m.aggregation}"${m.target != null ? `, summit at ${m.target}` : ""}${m.direction === "down" ? ", lower is better" : ""}.
Camp targets use that metric and unit, rise steadily, and the last camp is the summit. First camp within 2–4 weeks.
You know nothing personal about them yet, so keep it general and say their AI will tailor it after a short chat.
Write like a sharp friend: short, specific, no clichés, no exclamation marks.
${AGG_GUIDE}
Allowed icons: ${icons}.`,
      input: `Challenge: ${c.title}\n${c.tagline}`.slice(0, 400),
      schema: StarterSchema,
      maxTokens: 4000,
    },
    { visitor },
  );
  return { ...s, camps: normalizeCamps(s.camps, today), first_quests: normalizeQuests(s.first_quests).slice(0, 3) };
}

export const StylePairsSchema = z.object({
  pairs: z
    .array(
      z.object({
        situation: z.string().describe("2–4 words, how a person would say it"),
        gentle: z.string().describe("A warm nudge that makes room, ending with a question"),
        firm: z.string().describe("A blunt push: the plain fact, then the next step"),
      }),
    )
    .describe("Exactly 3 pairs: a missed week, a good streak, a plan that has to move"),
});

export async function stylePairs(title: string, visitor?: string) {
  const r = await structured(
    "fast",
    {
      name: "style_pairs",
      system: `A new climber picks how their AI coach, Muse, should talk to them during this year-long challenge. Write three moments,
each with two messages Muse could send, so different that anyone sees at a glance which one is for them. Use the challenge's own
units, sessions and places. The third moment is whatever most often derails this challenge (an injury, travel, a closed venue, work).

Here is the whole answer for a guitar challenge. Match its shape and length; write your own words and numbers, none of these:
- Missed a week. gentle: "Rough week? Happens. Want to just play the one song you love tonight, no plan?" firm: "Seven days, no practice. Tonight: twenty minutes on the chorus you keep dropping."
- 9 days in a row. gentle: "Nine days straight, that's a real habit now. Want to try a new song this weekend?" firm: "Nine days straight. Day ten is tonight. Record the full song once, no stopping."
- Sprained wrist. gentle: "That wrist needs a break. Want to learn songs by ear this week instead?" firm: "Wrist's out for a week. Ear training daily. Back on the strings Saturday if it's fine."

gentle takes the pressure off and ends with a question. firm opens with the fact, then says what to do and when, with no question.
Plain words with contractions (that's, you're), like a friend texting. No "I noticed", no "together", no emoji, no exclamation marks, no calendar dates.`,
      input: `Challenge: ${title.slice(0, 120)}`,
      schema: StylePairsSchema,
      maxTokens: 1500,
    },
    { visitor },
  );
  return r.pairs.slice(0, 3);
}

/** Used when the model is resting: still lets someone pick a style. */
export const FALLBACK_PAIRS = [
  {
    situation: "Missed a week",
    gentle: "Rough week? Happens. Want to do one small session tonight, no catching up?",
    firm: "A week with nothing logged. One session tonight. Log it.",
  },
  {
    situation: "Five in a row",
    gentle: "This is really clicking. Want to keep it easy and enjoy the run?",
    firm: "Five sessions straight. Do the sixth on Saturday. Don't break it.",
  },
  {
    situation: "Plans changed",
    gentle: "This week got away from you? Want to pick a lighter version for now?",
    firm: "This week's plan is gone. Move the session to Saturday. Book it now.",
  },
];

export function styleFromChoices(choices: ("gentle" | "firm")[]): string {
  const firm = choices.filter((c) => c === "firm").length;
  if (firm === 0) return "Gentle and encouraging. Celebrate small wins, never guilt. Suggest, don't push.";
  if (firm === choices.length) return "Direct and demanding. Short sentences, clear asks, call out slacking. Respect, no coddling.";
  if (firm > choices.length / 2) return "Mostly direct with warmth. Clear asks and honest feedback, plus real credit for good work.";
  return "Mostly gentle with some push. Encourage first, then a clear small ask.";
}
