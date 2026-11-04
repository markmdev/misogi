# How Misogi looks

Misogi should feel like a warm, handmade place to climb one hard thing for a year: cream paper, soft pastel mountains, a felt mascot, chunky rounded shapes. Calm, never loud; playful, never childish. Read this before you change a screen.

## Building blocks

- **Tokens** live in `app/globals.css` (`@theme`): cream backgrounds, three inks for text (`ink`, `ink-2`, `ink-3`), two line colors, and coral for the main action. Moss means done or connected, gold means XP and medals, flame means streaks. Use the tokens, not new hex values.
- **Type:** Fredoka (`font-display`) for headings, numbers and buttons; Nunito for everything else. Small caps-style labels use `.label`.
- **Shapes:** cards are `.card` (white, 22px corners, soft shadow), buttons are `.btn` with a solid edge under them, small tags are `Pill`. Corners stay round everywhere; nothing square.
- **Icons** are the 3D pictures in `public/art/icons` through `Icon` and `IconTile`. Never emoji, never a line-icon set.
- **The mascot** (`Mascot`, poses in `public/art/mascot`) shows up where a person waits or finishes something: drafting, empty states, the connect step.
- **Each challenge has a palette** (`lib/shared/theme.ts`: tint, accent, deep, sky) and a matching mountain scene in `public/art/scenes`. A challenge's pages take its tint as the background and its accent for progress; the scene fades into the tint at the bottom.
- **A challenge's cover** (drawn by Muse Image when it starts) is its picture wherever it shows: the top of its card on the home page and Explore, and beside its title on its own page, over its mountain scene. It always shows whole, at its own 3:2, never cropped to a banner, and nothing zooms it on hover. On a phone the challenge page's cover sits above the title; the home page's challenges become a shelf you swipe, and Explore puts two small cards to a row (no tagline, smaller mascot). On a laptop the home page shows three across beside the feed, Explore four. A challenge whose cover isn't drawn yet shows its icon tile in that place.

## Motion

Motion says what just happened, once, then stops.

- Things arrive with `animate-rise` (lift and fade in) or `animate-pop` (for small round things such as a camp or a check).
- When the drafted year appears, it builds in order: the measure, then the camps one by one up the trail, then this week's quests (`CampPath`'s `revealAt`).
- On a live page, what an AI just changed rises in and glows once in the challenge's accent (`Fresh` in `components/client/live.tsx`). Nothing glows on first load.
- **Stickers.** When a photo's subject is what the challenge counts (a dish, a cake, a painting), SAM 3.1 cuts it out and it becomes a felt sticker, cream border and a stitch in the challenge's accent, stuck straight on the climb page under the progress bar at a slight tilt (`StickerBoard` in `components/client/media.tsx`). One that lands while the page is open plays the cut: its photo shows, the rest of the photo dims as the cut lights up in the accent, the sticker lifts off and the photo falls away, then it settles at its tilt. The photo itself stays on the wall and the log.
- The home page's wheel (`components/client/start-box.tsx`) is the one longer motion, and it runs only when someone taps "Spin the wheel": a short pull back, a push up to speed, a long slow-down while the pin ticks over the pegs, then the slice it stops on lifts, confetti falls once, and the pick types itself into the box. Light on the wheel stays put while it turns.
- **Home's challenge chips** under the box are the site's most-joined challenges whose dressed Muse has a loop, in two rows drifting opposite ways, slowly, each Muse playing its joke. They stop under a pointer or a finger, a tap drafts that challenge, and under reduced motion they hold still.
- **Living art.** The mascot (each climber's Muse), the mountain scenes and the covers of the challenges that ship with the site have short loops in `public/art/motion`, made ahead of time with Grok Imagine from the stills and keyed out where they sit on other art (`components/client/alive.tsx`). The still shows first; once it's on screen its loop fades in over it and the still is gone, so nothing shows twice. Each pose has an emote of the mascot's own (a shy hello with a blush, a lean that nearly tips it over, snow puffing off its cap when it cheers), not a generic breathe-and-blink. Each dressed mascot (`public/art/motion/virgils`) plays a little joke that fits its challenge instead: the reader's stack topples onto it, the piggy bank hiccups the coin back onto its head, the map-reader turns its map upside down. Each ends in the pose it started from, and none of them bobs. Covers move wherever they're on screen. Mascots under 48 px (the chat button, chat avatars) stay still, except in home's challenge chips, which play small copies of the dressed Muses' loops (`public/art/motion/virgils/chip`, made by `scripts/chip-loops.sh`), each only while it's in view. A redrawn cover or mascot has no loop until one is made for it, and stands still meanwhile.
- **The film** sits under the home box (`components/client/film.tsx`): its closing frame with a "Watch the film" button, and nothing loads until someone taps it; then it plays in place, with sound and the browser's own controls. It's served from the site (`public/film`), 720p, so a phone can play it.
- **Moves between pages** run on the browser's view transitions (`ViewTransition` in each page, styles at the end of `globals.css`). Things you tap continue onto the next page: a challenge's cover grows from its card into the cover on its page, and the line you chose on the home box flies into your draft's title, with the mascot walking along on a wide screen. The page you leave frosts over in the first frame and fades. The top bar holds still. Shared things travel for 380 ms on `cubic-bezier(.16,1,.3,1)`, fast out and soft in, never bouncing. Only the thing you tapped carries the shared name, since two of one name cancel the move. A card starts loading its page when the pointer rests on it or a finger touches it, so the move starts at once.
- Everything respects reduced motion (the rule at the end of `globals.css`; the wheel checks it itself and lands at once).

## Sound

Two small sounds, both made in code with Web Audio (`components/client/sounds.tsx`), so there are no sound files and nothing to license: a soft wooden tick when the mouse comes onto something you can press (a link, a button, a chip, a card), on one of five notes of a major pentatonic so a sweep across a row sounds like a toy xylophone; and a felt pop, a low note that drops, when you press it. On a phone only the pop plays, on the tap itself, so a swipe that starts on a card stays quiet. Nothing plays while the page scrolls under a still mouse, nothing before the visitor's first click, tap or key, and nothing under reduced motion. Both pass through a soft low-pass and stay quiet.

## Words

- Use the climber's words: challenge, climb, camps, summit, quests, log, guide. Never a programmer's word on screen ("v2", "space", "agent kind", "null").
- Who does what is said one way everywhere. A person's coach is **their Muse** ("Bao, your Muse"; "Helen's Muse" on someone else's page); people without Muse can **Try it without Muse**, a preview of what Muse does there, shown as "Muse" and never given a name of its own; another AI is "Claude, your AI". Meta's models are credited at the moment they make something (Muse Spark drafted this, built by Muse Wonder, drawn by Muse Image, cut out by SAM 3.1) and explained once, on the home page. Never "agent", "MCP" or "your AI" where Muse is meant.
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
