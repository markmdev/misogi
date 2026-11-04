// Writes the brief for a new challenge's own app: Muse Spark imagines the page, Muse Wonder builds it.

import type { ChallengeRow } from "../domain/challenges";
import { AppError } from "../util";
import { outputText, respond, type CallOptions } from "./client";

const GUIDE = `You design the app for a year-long challenge on Misogi. Another model builds it as one small web page from your brief and
the challenge's live data. The page is the challenge's shared page, so it has: the title and the measure (name, unit, each person's own
target, how it's counted); every member's name, total, progress toward their target, rank and streak; and their logs, newest first, each
with who, date, value, an optional short label the person typed and a short note. It has no photos, no real maps and no camps.
You don't know what people put in the label: call it the label, never a book's title, a place or a dish unless the challenge makes that
certain (a reading challenge's label is the book).

Write the brief in 4 to 6 sentences:
- Pick one world that belongs to this challenge and make the whole page that world, like a bookshelf for books, a trail climbing a
  mountain for summits, a jar filling with coins for savings, a dinner table for family dinners. Make it specific and a little surprising,
  never a generic dashboard, never a progress bar as the main idea.
- Make the main picture grow with the data: each log adds something to the world (a book on the shelf, a coin in the jar, a plate on
  the table, a flag on a peak), so the page looks fuller every week.
- The page sits under the challenge's own header, which already shows its title and a leaderboard of everyone. So don't put the title
  on the page and don't list the members again: open with the world and one number for the whole group (the combined total when the
  measure adds up, or the group's best when it's counted as a person's latest or best: a time, a weight, a score), and show each
  person's progress toward their own target inside the world itself (their own rope, row of the shelf, seat at the table).
- Show the newest logs and their notes in a form that fits the world (index cards, receipts, postcards), and give one small thing to tap
  that reveals more (who read that book, the note behind a coin).
- Say the feel in a few words: materials and mood. Plain words, no jargon, nothing the data doesn't have.
Answer with only the brief.

Examples:
Read 25 books -> A cozy bookshelf. Draw each finished book as a spine on wooden shelves, colored by reader, with the title on the spine; tapping a spine shows who read it and their note. Above the shelves: the total books read together and who finished one most recently. Below: the newest notes as little index cards.
Visit all 50 states -> A road-trip scrapbook. Draw a simple tile map of the 50 US states (an inline SVG grid, one rounded square per state with its postal code) and fill in every state anyone has visited, colored by who got there first. Show how many states the group has visited together, and the newest trip notes as postcards.`;

/** The brief for this challenge's first page, from what it measures and the world it lives in. */
export async function writeAppBrief(
  c: Pick<ChallengeRow, "title" | "tagline" | "description_md" | "category" | "metric_name" | "metric_unit" | "metric_target" | "metric_aggregation" | "metric_direction">,
  camps: string[],
  opts: CallOptions,
): Promise<string> {
  const challenge = {
    title: c.title,
    tagline: c.tagline,
    description: c.description_md,
    category: c.category,
    measure: { name: c.metric_name, unit: c.metric_unit, target_per_person: c.metric_target, counted_as: c.metric_aggregation, direction: c.metric_direction },
    the_creators_camps: camps,
  };
  const r = await respond("draft", { instructions: GUIDE, input: JSON.stringify(challenge), max_output_tokens: 2000 }, opts);
  const brief = outputText(r).trim().replace(/^.*->\s*/, "");
  if (brief.length < 40) throw new AppError("resting", "No brief came back.");
  return brief.slice(0, 1800);
}
