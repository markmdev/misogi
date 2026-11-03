# How Misogi looks

Misogi should feel like a warm, handmade place to climb one hard thing for a year: cream paper, soft pastel mountains, a felt mascot, chunky rounded shapes. Calm, never loud; playful, never childish. Read this before you change a screen.

## Building blocks

- **Tokens** live in `app/globals.css` (`@theme`): cream backgrounds, three inks for text (`ink`, `ink-2`, `ink-3`), two line colors, and coral for the main action. Moss means done or connected, gold means XP and medals, flame means streaks. Use the tokens, not new hex values.
- **Type:** Fredoka (`font-display`) for headings, numbers and buttons; Nunito for everything else. Small caps-style labels use `.label`.
- **Shapes:** cards are `.card` (white, 22px corners, soft shadow), buttons are `.btn` with a solid edge under them, small tags are `Pill`. Corners stay round everywhere; nothing square.
- **Icons** are the 3D pictures in `public/art/icons` through `Icon` and `IconTile`. Never emoji, never a line-icon set.
- **The mascot** (`Mascot`, poses in `public/art/mascot`) shows up where a person waits or finishes something: drafting, empty states, the connect step.
- **Each challenge has a palette** (`lib/shared/theme.ts`: tint, accent, deep, sky) and a matching mountain scene in `public/art/scenes`. A challenge's pages take its tint as the background and its accent for progress; the scene fades into the tint at the bottom.

## Motion

Motion says what just happened, once, then stops.

- Things arrive with `animate-rise` (lift and fade in) or `animate-pop` (for small round things such as a camp or a check).
- When the drafted year appears, it builds in order: the measure, then the camps one by one up the trail, then this week's quests (`CampPath`'s `revealAt`).
- On a live page, what an AI just changed rises in and glows once in the challenge's accent (`Fresh` in `components/client/live.tsx`). Nothing glows on first load.
- The home page's wheel (`components/client/start-box.tsx`) is the one longer motion, and it runs only when someone taps "Spin the wheel": a short pull back, a push up to speed, a long slow-down while the pin ticks over the pegs, then the slice it stops on lifts, confetti falls once, and the pick types itself into the box. Light on the wheel stays put while it turns.
- Everything respects reduced motion (the rule at the end of `globals.css`; the wheel checks it itself and lands at once).

## Words

- Use the climber's words: challenge, climb, camps, summit, quests, log, guide. Never a programmer's word on screen ("v2", "space", "agent kind", "null").
- Labels say what a person needs: "Built by Muse Wonder · 2h ago", not a version number.
- A key never shows in full: on screen it's `msk_••••` and its last four; Copy gives the full text.

## States

Every part has a design for empty, loading, slow and failed, and a failure never looks like an empty list. Empty states use `EmptyState` with the mascot and one line on what to do next. Loading placeholders use `.skel` with the same shape as what's coming.

## Layout

Pages are designed at 390 and 1440 wide and must hold at both, with the longest real titles (a challenge title can be 60 characters, a camp title 40). Lay a part out by the room it's given, not the window. Check the night theme too: it's the darkest scene.

## Generated pages

A challenge's or member's own page is made by AI and shown in a sandboxed frame. The frame is see-through so a page with a transparent background sits on the challenge's tint.

## Share images

The weekly card (`lib/server/cards.tsx`) and link previews (`opengraph-image.tsx`) are drawn with `next/og`, which only lays out with flexbox: every element with more than one child needs `display: flex`, and `gap` between text spans can collapse, so give each stat its own box. Check them with a real member, a member with no streak and a challenge with no target.
