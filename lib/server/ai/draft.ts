// First drafts for the start flow: one line in, a whole year's challenge out.

import { z } from "zod";
import { CATEGORY_ICON, ICONS } from "@/lib/shared/art";
import { AGGREGATIONS, THEMES } from "@/lib/shared/types";
import { CATEGORIES } from "../domain/challenges";
import { addDays, addYear } from "../util";
import { structured } from "./client";

export const DraftSchema = z.object({
  title: z.string().describe("Short, vivid challenge title, max 48 chars, e.g. 'Hold a 20-minute conversation in Mandarin'"),
  tagline: z.string().describe("One plain sentence on why it matters to them, max 110 chars"),
  category: z.enum(CATEGORIES),
  icon: z.string().describe("One icon name from the allowed list"),
  theme: z.enum(THEMES),
  metric: z.object({
    name: z.string().describe("What's counted, lower case, e.g. 'miles run', 'books read', 'days practiced', 'HSK level'"),
    unit: z.string().describe("Unit for values, e.g. 'mi', 'books', 'days', 'level'; empty if none"),
    target: z.number().nullable().describe("Number to reach by the end of the year, or null if not numeric"),
    aggregation: z.enum(AGGREGATIONS),
    direction: z.enum(["up", "down"]),
  }),
  camps: z
    .array(
      z.object({
        title: z.string().describe("Camp name, max 40 chars"),
        detail: z.string().describe("What being here means, one short sentence"),
        target: z.number().nullable().describe("Metric value that marks this camp, or null"),
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
Write like a sharp friend: short, specific, no clichés, no exclamation marks.
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

/** Keeps model output inside what the product supports. */
export function normalizeDraft(d: Draft, today: string): Draft {
  const end = addYear(today);
  const icon = (name: string, fallback: string) => (name in ICONS ? name : fallback);
  const fallbackIcon = CATEGORY_ICON[d.category as keyof typeof CATEGORY_ICON] ?? "summit";
  const camps = d.camps.slice(0, 6).map((c, i, arr) => {
    let due = /^\d{4}-\d{2}-\d{2}$/.test(c.due_on) ? c.due_on : addDays(today, Math.round(((i + 1) * 365) / arr.length));
    if (due <= today) due = addDays(today, 14 + i * 30);
    if (due > end) due = end;
    return { ...c, title: c.title.slice(0, 40), icon: icon(c.icon, i === arr.length - 1 ? "summit" : "camp"), due_on: due };
  });
  camps.sort((a, b) => a.due_on.localeCompare(b.due_on));
  return {
    ...d,
    title: d.title.slice(0, 60),
    tagline: d.tagline.slice(0, 120),
    icon: icon(d.icon, fallbackIcon),
    camps,
    first_quests: d.first_quests.slice(0, 4).map((q) => ({ ...q, xp: Math.min(Math.max(Math.round(q.xp) || 20, 10), 80) })),
  };
}

export const StylePairsSchema = z.object({
  pairs: z
    .array(
      z.object({
        gentle: z.string().describe("A check-in message in a gentler style"),
        firm: z.string().describe("The same situation in a firmer, more direct style"),
        situation: z.string().describe("2–4 word label, e.g. 'Missed three days'"),
      }),
    )
    .describe("Exactly 3 pairs, each about a different situation in this challenge"),
});

export async function stylePairs(title: string, visitor?: string) {
  const r = await structured(
    "fast",
    {
      name: "style_pairs",
      system: `Write example check-in messages a guide might send someone doing this year-long challenge. Each pair shows the same situation
in two styles so the person can pick what motivates them. Messages: 1–2 sentences, specific to the challenge, natural, no emoji, no clichés.
Situations: one where they're behind, one where they did well, one before a hard session.`,
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
    situation: "Missed a few days",
    gentle: "Busy week? No problem. Want to do a short session today to get back in?",
    firm: "Three days off. Ten minutes today, no excuses. Go.",
  },
  {
    situation: "Had a great week",
    gentle: "That was a lovely week. You should be proud of how steady you've been.",
    firm: "Strong week. Now do it again. Consistency is the whole game.",
  },
  {
    situation: "Before a hard session",
    gentle: "Today's a big one. Take it at your own pace; finishing is what counts.",
    firm: "Hard session today. You planned for this. Show up and get it done.",
  },
];

export function styleFromChoices(choices: ("gentle" | "firm")[]): string {
  const firm = choices.filter((c) => c === "firm").length;
  if (firm === 0) return "Gentle and encouraging. Celebrate small wins, never guilt. Suggest, don't push.";
  if (firm === choices.length) return "Direct and demanding. Short sentences, clear asks, call out slacking. Respect, no coddling.";
  if (firm > choices.length / 2) return "Mostly direct with warmth. Clear asks and honest feedback, plus real credit for good work.";
  return "Mostly gentle with some push. Encourage first, then a clear small ask.";
}
