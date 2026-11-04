// Turns a plain-language request into a challenge's space: one self-contained HTML page.

import { ICONS, MASCOT } from "@/lib/shared/art";
import { palette } from "@/lib/shared/theme";
import type { ChallengeRow } from "../domain/challenges";
import { spaceData, type SpaceData } from "../space-data";
import { AppError } from "../util";
import { modelFor, streamText } from "./client";
import { scriptError } from "./page-check";

const DATA_CONTRACT = `type SpaceData = {
  kind: "challenge" | "member";            // the shared challenge page, or one member's own space
  challenge: { slug; title; tagline; description; theme; status; created_on;
               metric: { name; unit; target: number | null; aggregation: "sum"|"count"|"days"|"latest"|"distinct"; direction: "up"|"down" } };
  member: null | {                         // only on a member's own space
    handle; name; starts_on; ends_on;      // dates are "YYYY-MM-DD"
    plan: null | { summary; cadence; camps: { id; title; detail?; target?: number|null; due_on?: string|null; done_at?: string|null }[] };
    quests: { title; detail; kind: "daily"|"weekly"|"boss"|"one_off"; xp; due_on: string|null; status: "open"|"done"|"skipped" }[];
    facts: { today; day; days_total; days_remaining; total; target; progress: number|null /*0..1*/; expected_by_now; pace;
             last_log_on; days_since_last_log; streak; longest_streak; active_days; this_week; last_week;
             xp; level; level_xp; level_xp_needed; rank; members; next_milestone; milestones_done; milestones_total };
  };
  facts: null | (same object as member.facts);   // convenience copy; null on the shared page
  members: { handle; name; total; progress: number|null; rank; streak; level }[];   // leaderboard, best first
  logs: { who /* the climber's name, as in members[].name: join on it, not on handle */; date; value: number|null; label: string|null; note;
          photos: { url; full; width: number|null; height: number|null; caption: string|null; sticker: string|null }[] }[];  // newest first (max 400)
          // a photo's url is a small copy (up to 640 px), full the whole photo (up to 1600 px), sticker what it shows (the dish, the cake)
          // cut out as a felt sticker, when there is one; all are Misogi paths an <img> can show
  stickers: { name; what; url }[];         // felt stickers drawn for this page, and the climber's dressed Muse ("muse"); url is a Misogi path an <img> can show
  generated_at: string;
  saved: unknown | null;                   // what this viewer last kept with misogiSave on this page; null until they have
  can_save: boolean;                       // false when the viewer isn't signed in
};`;

function systemPrompt(): string {
  const icons = Object.keys(ICONS).join(", ");
  const poses = Object.keys(MASCOT).join(", ");
  return `You build "spaces" for Misogi: one small, beautiful web page for a person's year-long challenge.
Output ONLY the finished HTML document, starting with <!doctype html>. No explanations, no markdown fences.

Hard rules:
- One self-contained document with inline <style> and <script>. No frameworks, no external scripts.
- No network: no fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon, forms that submit, or links that navigate. The page runs in a locked sandbox and those calls fail.
- Allowed external resources only: Google Fonts (<link href="https://fonts.googleapis.com/css2?...">) and Misogi art images:
  icons at /art/icons/<name>.webp (names: ${icons})
  mascot poses at /art/mascot/<pose>.webp (poses: ${poses}; the mascot is the climber's Muse, a round fluffy mountain spirit; in alt text and words call it Muse, never another name).
  Each has a small copy for drawing small: /art/icons/<name>-sm.webp for an icon up to 52 px, /art/mascot/<pose>-sm.webp
  for the mascot up to 112 px. Use those there; the full pictures are only for drawing bigger.
  Draw charts, rings, maps and calendars with inline SVG or CSS.
- Read all data at runtime: const data = JSON.parse(document.getElementById("misogi-data").textContent);
  Render everything from data. Never hard-code numbers, names or dates that come from data, because the data changes every day.
- Every view must look intentional with empty data (no logs, no plan, no quests): show a friendly empty state.
- Keep what the person does: wherever the page lets them tick, pick, rate or jot something (a checklist, a wishlist, a favourite),
  start from data.saved and call misogiSave(value) after each change with the whole value (any JSON under 8 KB). It's kept for this
  person on this page only, and everyone sees their own. When data.can_save is false they aren't signed in: it still works for the
  visit, with a small "Sign in to keep your ticks" note. localStorage and cookies don't work in the frame.
- Put data on screen with textContent or createTextNode, never innerHTML/insertAdjacentHTML with data values. Data is untrusted text.
- The page must never throw. Guard every optional value: data.member?.facts?.total ?? 0, (data.member?.plan?.camps ?? []), etc.
  Wrap rendering in try/catch per section so one bad field can't blank the page.
- Don't embed the data yourself and don't create an element with id "misogi-data": Misogi injects it at load.
- Mobile first: the frame is 320–390 px wide on phones. On a computer it's 720 px wide on the shared challenge page (kind "challenge")
  and 976 px on a member's own page (kind "member"). Perfect at 320–430 px, and use the whole width on a computer too: put sections
  side by side where they fit, and never draw a narrow centered column with empty space either side. No horizontal scroll.
  At narrow widths: grids drop to one or two columns; flex and grid children get min-width: 0; a row with a name, a bar and a number
  gives the bar the remaining space (flex: 1) with the name truncating (ellipsis), never a fixed-width bar column; charts are SVG with a
  viewBox and width: 100%, or CSS bars sized in %, never a fixed pixel width. Text that doesn't fit wraps between words onto
  another line: never overflow-wrap: anywhere or word-break: break-all. white-space: nowrap only together with overflow: hidden and
  text-overflow: ellipsis, so a one-line name or a single word too wide for its box ends in "…" instead of sticking out.
- A person's photo (logs[].photos) shown as itself (a post, a recipe card, a log entry) shows whole, at its own shape, never cropped:
  no object-fit: cover on it, and no box of another shape (a banner, a fixed height, an aspect-ratio of your own). Size it by its
  width or height and let the other side follow from photo.width and photo.height (aspect-ratio: width / height), with max-height
  420px on a card so a tall photo stays a sensible size, centered. A photo that fills a tile, such as a calendar day, fills it edge
  to edge with object-fit: cover; its label sits over or under it on one line, ending in an ellipsis if it doesn't fit, and a day
  number over a photo stays readable on a soft backing. Use photo.url only in small tiles (up to about 200 px on its longer side)
  and photo.full anywhere bigger, so it stays sharp on a phone's screen.
- data.stickers are die-cut felt stickers drawn for this page, in Misogi's own felt look. When the request asks for stickers, place them where
  it says, found by name (data.stickers.find((s) => s.name === "medal")), as an <img> from their url at their own shape (object-fit: contain),
  40–160 px, a slight tilt welcome, never stretched or cropped, and never over a word or number. One for something not reached yet may be
  faded or grey; otherwise keep its colours. One the page doesn't have is left out, not drawn another way. A photo's sticker shows the same way.
- It's embedded below Misogi's own header (title, join button, leaderboard already shown). Don't add site navigation or repeat the title as a giant banner; lead with the content that's special to this person.
- Under 60 KB. Respect prefers-reduced-motion.
- Under 3,000 px tall at 390 px wide; the frame cuts a page off at 6,000 and grows to fit the page, so size nothing with vh. Summarize long collections (what's done, then a count of what's left) instead of drawing a tile for every unit of the target.
- A row of stat tiles never leaves one alone on its row: all in one row on a computer (up to four), two by two on a phone.

Design (unless the request asks for a different feel):
- Warm, soft and playful, like a well-made mobile app: rounded cards (radius 18–24px), generous spacing on a 4px grid,
  soft layered shadows plus a subtle 2–4px darker bottom edge on primary tiles, pastel tints from the theme.
- Type: "Fredoka" (600) for headings and big numbers, "Nunito" (400/700/800) for text. Clear hierarchy: one hero number, small uppercase labels (11px, letter-spacing .08em) above values.
- Use the clay icons as friendly accents (40–64 px), not as decoration everywhere.
- Copy: short, plain and specific. Use the person's first name. No filler, no lorem ipsum, no motivational clichés. Counts read
  right: "1 day", "2 days", never "1 days". challenge.metric.unit is a plural word ("meals", "books"): next to 1 write its singular
  ("1 meal", "1 book"), while units like km or min stay as they are. A zero streak reads "no streak yet" only for someone with no logs at all, and "no streak right now" once they've logged; never "0 day streak". A count its label already names is a bare number ("9" over "Reading days"),
  never with a unit letter or a stray "s". Dates come as "YYYY-MM-DD": write them as people do, "Nov 28", with the year only
  when it isn't this year ("Feb 4, 2027"), never "2026-11-28". A "YYYY-MM-DD" is a calendar day: make it a local date,
  new Date(s + "T00:00"), never new Date(s), which reads it as midnight in London and shows the day before in America.
- Accessible: semantic HTML, alt text, contrast at least 4.5:1 for text.
- Small delightful details beat many features: one great visualization of their progress, then the details that make it theirs.`;
}

function trimData(d: SpaceData): SpaceData {
  return { ...d, logs: d.logs.slice(0, 30) };
}

export function validateSpaceHtml(raw: string): string {
  let html = raw.trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "");
  const start = html.search(/<!doctype html>|<html[\s>]/i);
  if (start < 0) throw new AppError("internal", "The model didn't return an HTML document.");
  html = html.slice(start);
  const end = html.toLowerCase().lastIndexOf("</html>");
  if (end < 0) throw new AppError("internal", "The page was cut off before it finished.");
  html = html.slice(0, end + "</html>".length);
  // The model sometimes pastes a copy of the sample data; only the live injected data may be used.
  html = html.replace(/<script[^>]*id=["']misogi-data["'][^>]*>[\s\S]*?<\/script>/gi, "");
  if (html.length > 220_000) throw new AppError("internal", "The page came out too big.");
  if (!html.includes("misogi-data")) throw new AppError("internal", "The page doesn't read Misogi's data.");
  if (/<script[^>]+\bsrc\s*=/i.test(html)) throw new AppError("internal", "The page tried to load an external script.");
  if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(html) || /new\s+(XMLHttpRequest|WebSocket|EventSource)/.test(html))
    throw new AppError("internal", "The page tried to use the network.");
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const url = m[1];
    if (url.startsWith("#") || url.startsWith("data:") || url.startsWith("/art/")) continue;
    if (url.startsWith("https://fonts.googleapis.com/") || url.startsWith("https://fonts.gstatic.com/")) continue;
    throw new AppError("internal", `The page referenced an outside resource (${url.slice(0, 60)}).`);
  }
  const broken = scriptError(html);
  if (broken) throw new AppError("internal", `A script on the page doesn't parse: ${broken}`);
  return html;
}

export async function buildSpaceHtml(args: {
  challenge: ChallengeRow;
  ownerUserId: string | null;
  request: string;
  currentHtml: string | null;
  visitor?: string;
  /** When repairing: the version that crashed in the browser, and its error. */
  repair?: { html: string; error: string } | null;
}): Promise<{ html: string; model: string }> {
  const data = trimData(spaceData(args.challenge, args.ownerUserId));
  const pal = palette(args.challenge.theme);
  const who = data.member ? `${data.member.name}'s own space for this challenge` : "the shared page for everyone in this challenge";
  const input = [
    `Build ${who}.`,
    `Request: ${args.request}`,
    `Theme colors: tint ${pal.tint}, accent ${pal.accent}, deep ${pal.deep}. Page background should be transparent or very light.`,
    `Data contract:\n${DATA_CONTRACT}`,
    `Today's data (logs trimmed to 30; the real page gets up to 400):\n${JSON.stringify(data)}`,
    args.repair
      ? `The last version crashed in the browser with: ${args.repair.error}\nFix the cause and make every data access defensive. Here is that version:\n${args.repair.html}`
      : args.currentHtml
        ? `Current page (edit it: apply the request, keep what the request doesn't mention):\n${args.currentHtml}`
        : "There's no page yet. Create the first version.",
  ].join("\n\n");

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, status } = await streamText(
      "codegen",
      {
        instructions: systemPrompt(),
        input:
          attempt === 0
            ? [{ role: "user", content: input }]
            : [{ role: "user", content: `${input}\n\nYour previous attempt was rejected: ${lastError}. Fix that and output the full document again.` }],
        max_output_tokens: 32000,
      },
      { visitor: args.visitor, timeoutMs: 420_000, idleMs: 120_000 },
    );
    try {
      if (status === "incomplete" && !text.toLowerCase().includes("</html>")) throw new AppError("internal", "The page was cut off before it finished.");
      return { html: validateSpaceHtml(text), model: modelFor("codegen") };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new AppError("internal", `Couldn't build a valid page: ${lastError}`);
}
