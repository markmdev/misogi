# Misogi v1 — implementation plan

This plan turns [the brief](../ideas/misogi-brief.md) into a working v1 that a team of coding agents builds in parallel. It fixes the contracts between the parts first, so that four workstreams can then build at the same time without editing the same files.

**Finish line:** a user can start a challenge on the site, connect their Muse with one pasted message, and have Muse run the intake, write the plan and generate the first page. After that, Muse logs progress, re-plans and edits the page through MCP, a second user can join the challenge and appear on its leaderboard, and Muse can complete the challenge with a year-in-review. All of this runs on the deployed Worker, and the end-to-end suite passes against `bun run preview`.

**Deadline:** submissions close **Wed Nov 4, 9:00 PM ET**. The schedule below leaves Nov 4 afternoon as buffer.

## Blocked on Oscar (and Mark) before the build

The first two items can each stop the build, so we clear them first.

1. **A US Muse account, to prove the connector path (highest risk).** Nobody has yet confirmed that Muse's custom connector accepts an MCP server URL with a bearer header. In milestone 0 we deploy a one-tool MCP endpoint to a preview URL. Someone with a US Muse account then asks Muse to create a custom connector to it and call the tool. If that fails, the fallback is the `muse-sim` client (workstream 4) acting as the user's Muse in the demo, and we need to know that by tonight.
2. **A D1 database on the Cloudflare account.** The Worker lives on Mark's account. Someone with access runs `wrangler d1 create misogi` and adds the binding (below), or gives us Wrangler access.
3. **Dependencies (approved by Oscar on Nov 2):**
   - `@modelcontextprotocol/sdk` is the official MCP server SDK. If it won't run in Workers, we hand-roll the JSON-RPC handler instead.
   - `zod` is required by the SDK for tool schemas.
   We don't add the `openai` client that the README example uses. `lib/meta.ts` calls the gateway's `/v1/responses` endpoint with `fetch`, because one endpoint doesn't need a client library. We add no ORM and no auth library either.
4. **The gateway visitor ID for MCP calls (ask Mark).** The README hashes the visitor's IP. Muse calls arrive from Muse's VMs, so an IP hash would merge users. The plan hashes the Misogi user ID instead, and Mark should confirm the gateway budgets per `x-visitor` value however it's derived.
5. **Two secrets: `SESSION_SECRET`** (HMAC key for cookies and sign-in links) **and `DEMO_KEY`** (guards the demo clock). We add both to the Worker with `wrangler secret put`.

## Architecture

```
 User ⇄ Muse (Muse app / WhatsApp)              Visitor ⇄ browser
          │  custom connector                            │
          │  MCP over HTTPS + Bearer key                 │  HTTPS
          ▼                                              ▼
 ┌────────────────────── Next.js on Cloudflare Workers (OpenNext) ─────────────────────┐
 │  /api/mcp  ── tools ──► domain (lib/domain/*) ◄── server components & route handlers  │
 │                              │        │                                              │
 │                              │        └─► facts (pure functions over logs + plan)    │
 │                              ▼                                                       │
 │                         D1 (SQLite)            codegen (lib/codegen) ──► Meta gateway │
 │                                                    Muse Wonder (Full)                │
 │  /p/[versionId] ── generated HTML + inlined data, sandboxed iframe, CSP: no network   │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

Every action goes through one domain layer, `lib/domain`, whether it comes from Muse over MCP or from a person on the site. MCP tools and site routes are thin adapters over it. This keeps the permission rules and the facts in one place, and the E2E tests can drive the same behaviour that Muse drives.

## Decisions

Each decision below lists the alternative we rejected, so a worker who finds new evidence knows what to reopen.

1. **One MCP connector per user, not one per challenge.** The endpoint is `/api/mcp` with a personal bearer key, and every tool takes a `challenge` slug. A connector per challenge would make the user paste a new connector for every challenge they start or join. It would also make "start a challenge from Muse" impossible, because Muse has no connector until the site issues one. With one per user, the first connection happens on the site and everything after it can happen inside Muse.
2. **Misogi generates the page code, using Muse Wonder Full through the gateway.** Muse sends an intent ("show my miles as a route map"), and Misogi's own codegen call turns it into HTML. The alternative was for Muse to write the HTML and send it in a tool call. We rejected that because tool arguments of 30–60 KB are fragile, the quality would depend on a prompt we don't control, and it would put Meta's model outside our product rather than inside it.
3. **A generated page is one self-contained HTML document that reads inlined data.** The frame route serves the stored HTML with the current challenge data inlined as `<script id="misogi-data" type="application/json">`. The page runs in a `sandbox="allow-scripts"` iframe on a route whose CSP blocks all network access. New progress therefore shows up when the frame reloads, with no regeneration, and a generated page can't make requests or reach the shell. We rejected a postMessage data channel because it adds a protocol and gains nothing over a reload.
4. **Render failures come back to Muse.** A bootstrap script injected into every frame catches errors and sends them to the shell with `postMessage`, because the frame's CSP blocks its own network requests. The shell accepts messages only from its own iframe's window and reports them to `/api/pages/[versionId]/error`. When that happens, the shell switches to the last good version, the failed version is marked `failed`, and `get_challenge` reports it to Muse, which can retry. A broken page is never silently shown.
5. **Identity has no passwords and no email.** Creating a challenge or joining on the site creates an account, sets a signed session cookie and issues the MCP key. To sign in on another device, the user asks Muse, and the `get_sign_in_link` tool returns a one-time link. This keeps Muse as the holder of the user's identity and adds no auth dependency.
6. **D1 with plain prepared statements.** The schema is small and relational: members, logs, versions. An ORM would add a dependency and CPU for no gain at this size.
7. **Meta's Muse Wonder models do every model call, chosen by job.** Muse Wonder Full handles the work where quality decides the result: page generation and `muse-sim`. Muse Wonder handles the short, latency-sensitive call in the start flow. The model IDs live in one place in `lib/meta.ts`, so moving a job to the other model is a one-line change. The exact ID strings must be confirmed against the gateway in M0, because the README names only `muse-spark-1.3`.
8. **Leaderboard metrics are data, not code.** A challenge's shared metric is `{ name, unit, target, aggregation }`. The aggregation is one of `sum` (miles run), `days` (days with a log, for "wear a tie every day"), `count` (books read) or `latest` (current HSK level). That covers every Zuck challenge, and the creator's Muse picks the aggregation. Everything else about how progress is understood stays with Muse.

## Contracts (milestone 0, owned by the General)

These are fixed before parallel work starts. A worker who needs to change one stops and asks.

### Data model (`migrations/0001_init.sql`)

| Table | Columns (main ones) |
|---|---|
| `users` | `id`, `handle` (unique), `display_name`, `motivation_style` (text written from the picker, editable by Muse), `is_judge`, `created_at` |
| `api_keys` | `id`, `user_id`, `key_hash`, `last_used_at`, `revoked_at` |
| `sign_in_tokens` | `token_hash`, `user_id`, `expires_at`, `used_at` |
| `challenges` | `id`, `slug` (unique), `creator_id`, `title`, `one_liner`, `goal_md`, `metric_name`, `metric_unit`, `metric_target`, `metric_aggregation`, `starts_on`, `ends_on`, `status` (`draft`, `active`, `completed`, `template`), `template_label`, `clock_offset_days`, `created_at` |
| `memberships` | `challenge_id`, `user_id`, `role` (`creator`, `member`), `joined_at`, `completed_at`, `review_md`, `helpful` (bool), `helpful_note` |
| `plans` | `id`, `challenge_id`, `user_id`, `version`, `body_md`, `milestones_json` (`[{title, due, target}]`), `cadence`, `reason`, `created_at` |
| `logs` | `id`, `challenge_id`, `user_id`, `logged_for` (date), `value` (nullable), `note`, `evidence_url`, `created_at`, `deleted_at` |
| `page_versions` | `id`, `challenge_id`, `owner_user_id` (null = shared challenge page), `version`, `intent`, `html`, `status` (`ok`, `failed`), `error`, `created_at` |
| `pages` | `challenge_id`, `owner_user_id`, `current_version_id` |

Every change creates a new row and keeps the old one. Plans and pages are versioned, and logs are soft-deleted, so undo and history need no extra mechanism.

### MCP tools (`lib/mcp/tools.ts`)

The tools work at the level of intent, so Muse never manipulates rows. Every tool that takes `challenge` checks that the caller is a member, and the tools that change shared state check that the caller is the creator.

| Tool | Who | What it does |
|---|---|---|
| `list_my_challenges` | any | The user's challenges, each with its status and headline facts. |
| `browse_challenges(query?)` | any | Active public challenges and templates, for joining or inspiration. |
| `create_challenge(title, goal_md, metric, starts_on?, ends_on?)` | any | Starts a challenge from inside Muse. The caller becomes the creator. |
| `update_challenge(challenge, …)` | creator | Sets or changes the goal and metric, and moves a site-created `draft` to `active`. The metric locks once a second member joins. |
| `get_challenge(challenge)` | member | The challenge, the caller's current plan, the last 30 logs, facts, the leaderboard, page status (including render failures), the caller's motivation style and the coaching playbook. |
| `log_progress(challenge, value?, note?, date?, evidence_url?)` | member | Adds a log entry (backdating allowed) and returns the updated facts. |
| `remove_log(challenge, log_id)` | member, own logs | Corrects a mistake. |
| `update_plan(challenge, body_md, milestones, cadence, reason)` | member, own plan | Saves a new plan version. |
| `update_page(challenge, target: "challenge" \| "dashboard", request)` | creator for `challenge`, member for `dashboard` | Generates a new page version from the request and returns its URL and status. |
| `undo_page(challenge, target)` | same as above | Points the page back to the previous `ok` version. |
| `join_challenge(challenge)` | any | Joins as a member. |
| `set_preferences(motivation_style?, display_name?)` | any | Updates the user's profile. |
| `complete_challenge(challenge, review_md, helpful, helpful_note?)` | member | Records the year-in-review and the success verdict, and marks the member complete. |
| `get_sign_in_link()` | any | Returns a one-time sign-in URL that expires in 15 minutes. |

The coaching playbook (`lib/playbook.md`) goes in the MCP `instructions` field and also in every `get_challenge` response, because we don't know whether Muse's custom connectors show server instructions. It tells Muse:

- how to run the intake;
- the coaching principles from the brief;
- to set up its own recurring check-ins at the plan's cadence;
- how to use the motivation style;
- when to call which tool;
- to ask, in the year-in-review, whether Misogi genuinely helped.

The General writes the playbook, because it's product voice.

### Facts (`lib/domain/facts.ts`)

These are pure functions from `(challenge, plan, logs, members, now)` to plain numbers and dates: days elapsed and remaining, total against target, expected-by-now (from the plan's milestones if there are any, otherwise linear), pace ratio, days since the last log, current and longest streak, rank, gap to the next member, member count, and the latest render failure. `now` is the real time plus `clock_offset_days`, and that offset is the only way demo time jumps change behaviour. Facts are data for Muse to reason over. They carry no advice text.

### Page data contract (`lib/contracts.ts`)

```ts
type MisogiPageData = {
  viewer: "public";                 // pages are public; no viewer-specific data
  challenge: { slug; title; goal_md; metric: { name; unit; target; aggregation }; starts_on; ends_on; status };
  subject?: { handle; display_name; plan: { body_md; milestones; cadence }; review_md? }; // dashboards only
  logs: { logged_for; value; note }[];        // the subject's logs, or all members' for the challenge page
  members: { handle; display_name; total; rank }[];
  facts: Facts;
  generated_at: string;
};
```

Codegen gets this type and a sample instance in its prompt. Generated pages read it with `JSON.parse(document.getElementById("misogi-data").textContent)` and must render something sensible when `logs` is empty.

## Workstreams

After milestone 0, four workers run in parallel. Each runs in its own git worktree on its own `oh-` branch and owns the files listed for it. Anything outside those files is read-only for that worker.

### W1 — MCP server and domain (`worker`)

**Owns:** `app/api/mcp/**`, `lib/mcp/**`, `lib/domain/**` (except `facts.ts` stubs already agreed), `lib/auth/**`.

1. **Implement the domain layer:** challenges, memberships, plans, logs, permissions and facts, all over D1.
2. **Wire the MCP endpoint:** stateless streamable HTTP, bearer-key auth (keys are hashed, `last_used_at` is updated), and the tools from the contract with zod schemas whose descriptions are written for a model to read.
3. **Add sessions and sign-in links:** HMAC-signed cookies, one-time tokens, and a `/signin/[token]` route.

**Done when:** each tool has an E2E test that calls `/api/mcp` over HTTP against `bun run preview` with a local D1, and permission failures return clear MCP errors. Examples: a non-member calling `log_progress`, or a member calling `update_page` with `target: "challenge"`.

### W2 — Codegen and page runtime (`worker`)

**Owns:** `lib/codegen/**`, `lib/meta.ts`, `app/p/**`, `app/api/pages/**`.

1. **Write the gateway client:** `lib/meta.ts`, a plain `fetch` to `/v1/responses` that follows the README's rules. It never retries (a retry is a second billed call), sets `max_output_tokens`, picks the model per job (decision 7), sends `x-visitor` as sha256 of the user ID, uses the judges' key when `users.is_judge` is set, and maps `429 gateway_resting` to a typed `Resting` result.
2. **Write the codegen call:** the system prompt carries the design rules (one HTML file with inline CSS and JS, no network, mobile-first, no join button or leaderboard because the shell owns those, under 200 KB), the data contract with a sample, the current HTML for edits and the user's request. Output is validated: extract the HTML, check its size, reject external `src` and `href`, and require that it reads `misogi-data`. A validation failure goes back to Muse as a tool error that includes the reason.
3. **Build the frame route:** `/p/[versionId]` serves the HTML with fresh data and the error bootstrap injected, under `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`. Render errors go to the shell with `postMessage`, and the shell sends them to `/api/pages/[versionId]/error`.
4. **Expose `generatePage(challenge, owner, request)` and `undoPage(...)`** to W1, with the signature fixed in milestone 0.

**Done when:** three recorded generations render in the browser pane with real data: run 365 miles, learn Mandarin, and a tie every day. A deliberately broken page falls back to the previous version and shows up as failed in `get_challenge`. One live generation's latency is measured and written in the PR.

### W3 — Site and shell (`worker`, with the `frontend-design` skill)

**Owns:** `app/(site)/**`, `app/c/**`, `app/start/**`, `app/connect/**`, `app/explore/**`, `components/**`, `app/globals.css`.

1. **Home page:** "What's your misogi this year?", one input, examples inspired by Zuck, and live challenges from the gallery.
2. **Start flow:** the one-liner, then the motivation-style picker. One Muse Wonder call writes four pairs of example coaching messages about the user's own goal, from gentle to hard-hitting. If the gateway is resting, a fixed set of pairs is used. Then the display name, then creation of the user and the draft challenge, then `/connect`.
3. **Connect page:** one message to paste into Muse, with a copy button. The message tells Muse to create a custom connector called Misogi with the URL and the bearer key, then open the challenge and start the intake. The page waits until the key is first used and the first page version exists, then goes to the challenge.
4. **Challenge page `/c/[slug]`:** the fixed shell (Misogi frame, title, join button, leaderboard from facts, version history with undo for the creator), the generated page in the sandboxed iframe, and a poll every 15 seconds that reloads the frame when data changes. Before the first page exists, the page shows a "Muse is setting this up" state.
5. **Member dashboard `/c/[slug]/[handle]`:** the same shell around the member's own generated page.
6. **Join:** a visitor with a session and an MCP key joins with one click. A visitor without them gets the short account step and the connect message. Users who already have a connector are told to "tell your Muse to join `slug`".
7. **Gallery `/explore`:** active challenges and the Zuck templates. "Start this" on a template opens the start flow with the template prefilled.

**Done when:** each flow works in the built-in browser at 375 px and at desktop width against `bun run preview`, a resting gateway shows a resting state rather than an error, and the generated page can't reach the shell. To check the last point, a test page tries `parent.document` and `fetch`, and both must fail.

### W4 — Seeds, Muse simulator and E2E (`worker`)

**Owns:** `scripts/**`, `tests/**`, `migrations/seed_*.sql`, `app/api/demo/**`.

1. **Zuck templates:** eleven template challenges from 2009 to 2019, each labelled "Inspired by Mark Zuckerberg, YEAR", each with a metric and aggregation chosen to fit:
   - 2009: wear a tie every day
   - 2010: learn Mandarin
   - 2011: only eat meat from animals he killed himself
   - 2012: write code every day
   - 2013: meet someone new every day
   - 2014: write a thank-you note every day
   - 2015: read a book every two weeks
   - 2016: run 365 miles
   - 2016: build an AI for his home
   - 2017: visit every US state
   - 2019: host public discussions about technology

   The 2018 challenge is left out, because "fix Facebook" doesn't translate into a personal challenge.
2. **`scripts/muse-sim.ts`:** a tool-calling loop on Muse Wonder Full through the gateway. It connects to `/api/mcp` as a real MCP client, reads the playbook and plays the user's Muse, while scripted user turns play the user. It's the fallback demo client if the connector test fails, and it's the only test that exercises the real coaching behaviour. It costs credits, so it runs on demand and never in the default suite.
3. **Demo clock:** `POST /api/demo/clock` sets `clock_offset_days`, guarded by `DEMO_KEY`, plus a seed script that backfills a realistic history for Oscar's run-365 challenge.
4. **E2E suite (`bun test`):** it runs against `bun run preview` with local D1. Codegen uses recorded gateway answers, following the README's rule to build against recordings. It covers the full lifecycle (create, connect, intake tools, plan, page, log, time jump with facts showing a gap, re-plan, a second member joining, leaderboard order, undo, complete), plus the permission failures.

**Done when:** `bun test` passes on a fresh local database, and one `muse-sim` run completes the intake, writes a plan and generates a page for the run-365 challenge.

## Schedule

| When (ET) | Milestone | Done when |
|---|---|---|
| Mon Nov 2, evening | **M0: contracts and connector check** (General + one worker). D1 binding and migration, `lib/contracts.ts`, function signatures shared between workstreams, the playbook, an MCP spike with one tool on a preview URL, and the Muse connector test. | `curl` lists the tools on the preview URL, and we know whether a real Muse can call them. |
| Nov 2 night – Nov 3 | **M1: parallel build**, W1 to W4 in separate worktrees, each merged by its own PR. | Each workstream meets its own done-when. |
| Tue Nov 3, evening | **M2: integration.** Merge to main, run the full E2E, then do the real-Muse run on Oscar's account: intake, plan, page, logs, one time jump, re-plan. Fix what breaks. | The finish line, on the deployed Worker. |
| Wed Nov 4, morning | **M3: hero data and polish.** Seed Oscar's run-365 history, a second member, a Mandarin challenge and the gallery. Do a design pass on the shell, then a fresh-context review of the whole diff. | Every flow works on the live URL in the browser pane. |
| Nov 4, after 2 PM | Buffer, the submission write-up and the video. | Submitted before 9 PM. |

## How the agents work

- **Roles:** the General (main loop) writes the contracts and the playbook, reviews every PR diff against its workstream's done-when, and makes every call that changes a contract. Workers implement. If a worker finds that a contract is wrong, it stops and reports instead of working around it.
- **Next.js 16:** before writing route or server code, each worker reads `node_modules/next/dist/docs/`, as `AGENTS.md` requires. Cloudflare bindings come from `getCloudflareContext()` in `@opennextjs/cloudflare`.
- **CPU budget:** the free plan allows 10 ms of CPU per request. Model calls don't count, because waiting isn't CPU. Large JSON, HTML validation and MCP framing do count, so W1 and W2 each measure a typical request in `bun run preview` and report it. If we can't stay under the limit, the fix is the $5 Workers paid plan, and the decision belongs to Oscar and Mark.
- **Git:** one `oh-` branch per workstream, small commits with concise messages, everything to main by PR, and no force-pushes. `CLAUDE.md`, `AGENTS.md` and `TASKS.md` stay out of commits.
- **Gateway credits:** screens and tests use recorded answers. Live calls happen only in the codegen latency check, `muse-sim` runs and the real-Muse run.

## Risks

1. **Muse's custom connector may not accept an MCP URL.** We find out in M0. The fallback is to present `muse-sim` as "Muse" in the demo and say plainly that it's our client running Muse Wonder Full.
2. **Codegen latency may be longer than Muse's tool timeout.** A full page could take 30–60 seconds, and we don't know Muse's timeout. W2 measures it in M1. If it's too long, `update_page` returns `building` at once and the page shows a building state. That needs a Durable Object or a queue to finish the work after the response, which adds to the scope, so we only do it if the measurement forces it.
3. **Generated pages may be ugly or broken.** The design rules in the prompt, validation, automatic fallback and Muse retrying with the error reason handle broken pages. For quality, M3 covers the hero challenges, and the prompt includes one hand-made example page that sets the visual standard.
4. **Gateway credits may run out during judging.** Every model call handles `Resting`, the start flow has fixed fallback pairs, and pages render from stored HTML, so the site keeps working when the model is unavailable.
