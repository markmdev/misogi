# Misogi — project brief

Misogi helps a person complete one hard challenge in a year. The person's own Muse is the coach, and Misogi is the place where the challenge lives: its plan, its progress, its public page and the people doing it together.

> Your assistant already knows you. Now it's also your coach.

This brief describes the product vision. It says what the product must do and why, and leaves the how to the plan.

## The job to be done

Every January, millions of people commit to something hard: run 365 miles, learn a language, read 25 books, write every day, ship a side project. Most of them stop by February. The goal is rarely the problem. The problem is the eleven months after the decision, when nobody adjusts the plan to the life the person actually has, nobody notices when they go quiet, and nobody else is doing it with them.

The job is: **help me actually finish the hard thing I chose this year, in a way I'll be glad I did.**

The person hiring Misogi wants a plan that fits them, a coach who knows their life and adapts as it changes, other people who see the effort, and at the end a record of what they did.

## Where the idea comes from

From 2009 to 2019, Mark Zuckerberg set himself one personal challenge each year: wear a tie every day, learn Mandarin, run 365 miles, read a book every two weeks, build an AI assistant for his home, write code every day. In 2016 he invited anyone to join "A Year of Running", and thousands of people ran their own 365 miles with him. The modern word for this kind of annual challenge is a *misogi*, from Jesse Itzler and Marcus Elliott: one hard thing a year that changes what you think you can do.

Misogi makes that practice available to anyone, and gives every person a coach good enough for it.

## The core idea

**The agent lives with the user, not on our site.** In 2026 people have personal agents that already know their schedule, their habits and how they like to be spoken to. Muse is one of them. It runs continuously, remembers things across conversations, and can message the user on its own initiative. Misogi doesn't build another chatbot. It gives the user's own Muse what it needs to coach a year-long challenge, and it gives the challenge a public home.

The division of work is strict:

- **Muse does all the thinking and all the talking.** It runs the intake, builds the plan, chooses the check-in cadence and the evidence of progress, coaches, re-plans when life interferes, and sends every nudge through its own recurring tasks. The one-to-one conversation always happens between the user and their Muse, and never on Misogi.
- **Misogi holds the challenge.** It stores the plan, the progress log and the history. It reports facts about the challenge, such as "no progress logged in 9 days". It builds and hosts the public page, and it connects the people who do the same challenge. Misogi has no chat, no scheduler and no notification system of its own.

Muse connects to Misogi through MCP (Model Context Protocol, an open standard that lets an agent call tools on an external service). Through it Muse can read the challenge, log progress, change the plan, change the page and complete the challenge. We design for Muse first and only. Other agents could connect through the same protocol, but that isn't a goal.

## Why Misogi has to exist

A user can tell Muse "coach me to run 365 miles this year" with no Misogi at all. Misogi must be clearly better than that, in five ways.

1. **The challenge lives outside any one conversation.** Without Misogi, the plan, the log and the history are spread across a year of messages, so coaching drifts and the agent loses track of where the person really is. With Misogi, Muse reads one complete, current record every time it checks in, and that record survives any conversation.
2. **The commitment is public.** Every challenge has a public page that shows the goal, the plan and the progress. Other people can see it, and a public commitment is harder to quietly drop than a private chat.
3. **You do it with other people.** Anyone can join a challenge. Members share one goal and one leaderboard, and each member's own Muse coaches them toward it. You can see who is ahead of you and who started after you. A one-to-one conversation can't give a person this, and it's the strongest reason Misogi exists.
4. **Muse becomes a real coach.** Misogi gives Muse a short coaching playbook drawn from research on skill acquisition and behaviour change: keep the challenge matched to current skill so it's neither boring nor crushing, use deliberate practice on specific weaknesses, increase load gradually, plan for lapses before they happen, and adapt the tone to the person's chosen motivation style. These are principles, not rules. Muse reasons about how to apply them to this person.
5. **The year ends with something to keep.** When the challenge ends, Muse writes a year-in-review and the page stays as a permanent public record of what the person did.

## Product principles

- **Let the model figure it out.** We don't list the challenge types Misogi supports, the integrations it needs or the widgets a page may contain. The model reasons out what a given challenge needs, the same way a capable person would. When a choice comes up between a hand-built rule and giving the model better context, choose the context.
- **Horizontal by design.** A daily habit (wear a tie every day), a skill (learn Mandarin), a quantity (read 25 books), a project (build a home AI) and a single event (run a marathon in October) are all first-class. Misogi must work very well for each of Zuck's actual past challenges, and the same core must extend to annual challenges of any shape.
- **Personal by default.** Two people doing the same challenge get different plans, cadences, tones and pages, because their Muses know different people.
- **Trust the user.** No safety rails, no lectures and no second-guessing of goals. The user knows what's best for them. Misogi never talks down to them.
- **Everything is public.** Challenges, pages, progress and leaderboards are public. Misogi has no private challenges.
- **Sensible defaults, infinite customisation.** Every challenge works well without configuration. Anything the user wants to change, such as coaching style, page design or gamification, they ask their Muse to change.

## The experience

### Starting a challenge

A user can start in two ways, and both must work.

- **From the site.** The home page asks one question: what's your misogi this year? Examples inspired by Zuck's challenges help the user start. The user types one line, then picks a motivation style by choosing between pairs of example coaching messages ("which of these would you rather get?"), from gentle to hard-hitting. Misogi creates the challenge and shows a single "Connect to your Muse" step. From there, Muse takes over.
- **From Muse.** A user who has already connected Misogi tells their Muse about a new challenge, and Muse creates it.

Either way, Muse runs the intake conversation: why this goal, where the person is starting from, what their year looks like, what has stopped them before, and how progress will be measured. Then Muse builds the plan, sets up its own check-ins at the cadence the plan needs, and creates the first version of the page.

### The plan

The plan is a curriculum for the year. It has intermediate milestones, a cadence and a clear definition of progress. It applies the coaching playbook. For example, it keeps difficulty just past the person's current ability, builds in recovery and slack, and puts the first milestone close enough to win early. The plan isn't fixed. Muse re-plans when the person gets ahead, falls behind, gets injured, travels or loses interest, and every version is kept.

### Coaching through the year

Muse checks in at the cadence the plan sets, in the user's existing Muse conversation. It asks for progress, logs it, notices patterns and adjusts. It reads the facts Misogi reports, such as streaks, gaps, pace against the plan and how the person compares with other members, and it decides what to say and when. The tone matches the motivation style the user chose and changes when the user asks.

### The page

Every challenge has a public page, and every member has a personal dashboard. Pages are generated, not assembled from a fixed set of blocks. The user tells Muse what they want ("show my miles as a map of the route I'd have run", "make it feel like a Chinese study notebook", "add a streak flame"), and Misogi builds the page from that description. A small fixed frame surrounds every page and holds the Misogi identity, the join button, the leaderboard, sign-in and version history with undo. Everything inside the frame belongs to the challenge.

The page shows live data: progress, pace, milestones and members. It updates whenever progress is logged, with no rebuild needed.

### Doing it together

Every public challenge has a join button. Joining doesn't copy the challenge. It adds the person to the same challenge, with the same goal and the same leaderboard metric, which the creator's Muse sets when the challenge is created. Each member gets their own plan, cadence, coaching and dashboard from their own Muse. Only the creator's Muse can change the shared page.

A global gallery shows challenges that are running now, so people can find one to join. It's seeded with Zuck's past challenges as clearly labelled templates ("Inspired by Mark Zuckerberg, 2016").

### Finishing

Challenges run for a year, and a person can finish early. When a challenge ends, Muse writes a year-in-review: what the person did, what changed, the hardest stretch and how they got through it. The page becomes a permanent public record. Then Muse asks what next year's misogi will be.

## Success

Success is **the number of people who complete their annual challenge and say Misogi genuinely helped them.** Completion comes from the challenge's own record. The verdict comes from the person, and Muse asks for it as part of the year-in-review.

Everything else we could measure, such as sign-ups, joins, page edits and messages, matters only when it moves that number.

## Timing

Misogi is built to launch for the New Year, when the most people choose a challenge and are most open to help with it.

## Out of scope

- Private challenges and privacy controls.
- A chat or coaching surface on Misogi itself.
- Agents other than Muse as a design target.
- Challenge lengths other than a year.
- Safety limits on what a user can choose to attempt.
