# Demo video: 3 minutes

Judges score Impact 30%, use of Meta's models 25%, technical depth 20%, demo 25%. Show the product working live, and name the Meta model behind each moment on screen.

| Time | Screen | Say (short) |
|---|---|---|
| 0:00–0:15 | Home page, the mountain hero | "Every January, millions pick one hard thing. By February most have quit. Not because the goal is wrong: nobody adjusts the plan, nobody notices when they go quiet, nobody climbs with them." |
| 0:15–0:40 | Type "Hold a 20-minute conversation in Mandarin" → the drafted year appears (camps, metric, first quests) | "One line in. Muse Spark drafts the year: how we'll measure it, camps on the way up, this week's quests." |
| 0:40–0:55 | The two-style picker, then the name step | "It asks how you like to be pushed, and remembers." |
| 0:55–1:30 | Connect step: copy the message, paste into Muse. Muse reads the guide, saves the key, sets up its own weekly check-in, starts the intake | "Misogi doesn't build another chatbot. Your own Muse becomes your guide. It has its own computer, so it reads our guide, calls our API, and schedules its own check-ins." |
| 1:30–2:00 | Answer the intake in Muse ("my partner's grandmother only speaks Mandarin…"). Split screen: the Misogi page updates live: plan, quests, "Guided by Ziggy · Muse" | "Everything you tell Muse lands on your page: the plan, the quests, the log." |
| 2:00–2:20 | Ask Muse "make my page a cozy study notebook" → the space rebuilds | "Muse Wonder writes a personal page for every challenge, from a sentence. It runs in a locked sandbox with live data." |
| 2:20–2:40 | The challenge page: leaderboard, live feed, Join. A second person joins; the leaderboard moves | "It's natively multiplayer. Same summit, your own path." |
| 2:40–2:50 | Share my week → the weekly card, Post on X | "Every week becomes something worth sharing." |
| 2:50–3:00 | Zuckerberg templates row, then the logo | "From 2009 to 2019, Mark picked one hard thing a year. Now anyone can, with a guide that already knows them. What's your misogi?" |

## Before recording
- Switch `AI_PROVIDER=meta` once credits land, so every call on screen is a Meta model (see README).
- Point a real domain at the server first (Muse's vault rejects `sslip.io`), then in Muse choose "Always allow this site" so approvals don't interrupt the take.
- Seeded challenges make the gallery and leaderboards look alive; check `/explore` first.
- Refresh the demo climbers' history to today so streaks and "active this week" are current (real accounts, spaces and covers are untouched):
  `curl -s -X POST https://<host>/api/admin/seed -H "x-admin-key: $ADMIN_KEY" -d '{"force":true}'`
- Check every model job once: `curl -s -X POST https://<host>/api/admin/ai-check -H "x-admin-key: $ADMIN_KEY"`
- Record Virgil (Ask Virgil on any page) as the fallback for people without Muse.
