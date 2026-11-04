# Running Misogi locally

About five minutes from clone to a working app with demo data. There's no Docker and no database server: the app creates a SQLite file on first start.

## What you need

- **bun** 1.3.6 or newer (`curl -fsSL https://bun.sh/install | bash`)
- **Node.js** 20 or newer. Next.js and SQLite run on Node; production uses 24.
- macOS or Linux
- A Meta Model API key (see step 2)

## 1. Install

```sh
git clone https://github.com/markmdev/misogi.git
cd misogi
bun install
cp .env.example .env.local
```

## 2. Add your Meta key

Put your Meta Model API key in `.env.local`:

```sh
META_API_KEY=your-key-here
```

Set `META_BASE_URL` only if you run a proxy that speaks the same API; otherwise calls go straight to `https://api.meta.ai/v1`. The key is a secret. Keep it in `.env.local`, which git ignores, and never put it in code, commits, issues, screenshots or agent transcripts you share. Restart `bun dev` after you change `.env.local`.

## 3. Run it

```sh
bun dev              # http://localhost:3000
```

In a second terminal:

```sh
bun run seed         # demo challenges, 44 demo people, a few weeks of history
bun run ai-check     # one small call per model job; every check should say "ok": true
```

Open http://localhost:3000. Use `localhost`, not `127.0.0.1`: Next.js 16 blocks dev scripts on other hostnames, so on `127.0.0.1` the page renders but never becomes interactive.

Seed options, combined as needed (`bun run seed --covers --spaces`):

- `--covers` draws a cover image for each demo challenge. It uses the image model and takes about a minute in the background.
- `--spaces` builds the AI-made page for each demo challenge. It uses the page builder and takes a few minutes in the background.
- `--force` rebuilds the demo people and dates their history to today. Your own accounts, pages and covers stay.

Without `--covers`, the demo challenges show their theme art instead of a cover.

## 4. Check your changes

```sh
bun run typecheck
bun run lint
bun test             # 15 end-to-end tests against the server on :3000
```

The tests use the HTTP API, make no model calls, and create their own accounts. They refuse to run against anything other than localhost.

## Trying the product

- **Start a challenge:** open `/start` and type one line. It drafts the year, creates your account (a browser session, no password) and opens your page.
- **Try it without Muse:** the button on any page, a preview of what Muse does there. It uses the same tools as outside agents.
- **Connect Claude Code to your local server:** make a key in the "Your AI" section of your page (or at `/connect`). The "Claude & other agents" tab shows the exact command, which looks like this:
  ```sh
  claude mcp add --transport http misogi-local http://localhost:3000/api/mcp --header "Authorization: Bearer msk_..."
  ```
- **Muse** runs in the cloud and can't reach `localhost`. Test Muse against the live site.
- **Agent guide:** http://localhost:3000/agent.md is the guide agents read. It's generated from the tool registry.

## Good to know

- **Starting over:** stop the server, delete `data/` and start again. `data/` holds the database, covers and generated media, and is not committed.
- **Another port:** `bun dev -p 3001`. Add `BASE_URL=http://localhost:3001` to `.env.local` for `bun run seed` and `bun run ai-check`. `bun test` doesn't read `.env.local`, so run it as `BASE_URL=http://localhost:3001 bun test`.
- **One dev server per checkout.** Next.js refuses to start a second one in the same folder and tells you the running one's port and PID.
- **Database scripts run inside the server.** better-sqlite3 doesn't load under Bun, so `bun run seed` and `bun run ai-check` are HTTP calls to `/api/admin/*`. Add new admin jobs as routes there. In dev they're open; in production they need `ADMIN_KEY`.
- **Next.js 16 is newer than most models' training data.** Read the guide in `node_modules/next/dist/docs/` before writing Next.js code (see `AGENTS.md`).
- **Model calls:** `AI_DEBUG=1` logs each call's job, model, time and tokens. `AI_MODEL_<JOB>` overrides one model, e.g. `AI_MODEL_CODEGEN`. The jobs and defaults are in `lib/server/ai/client.ts`.

## Where things are

| Path | What |
|---|---|
| `app/` | Pages, route handlers, server actions (`app/actions.ts`) |
| `components/` | UI. `components/client/*` are client components. |
| `lib/server/tools.ts` | The one tool registry behind the HTTP API, MCP and the preview without Muse |
| `lib/server/domain/` | Challenges, plans, logs, quests, feed (SQLite) |
| `lib/server/ai/` | Model client, drafting, the preview without Muse, page builder |
| `lib/server/spaces.ts` | Generated pages: build queue, validation, self-repair |
| `lib/server/migrations.ts` | Database schema. It applies on server start. |
| `tests/api.test.ts` | End-to-end tests |

Shipping a change: [deploying.md](deploying.md).
