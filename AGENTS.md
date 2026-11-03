<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Misogi

- **Start here:** [`docs/running-locally.md`](docs/running-locally.md) to run it, [`docs/deploying.md`](docs/deploying.md) to ship it, [`README.md`](README.md) for the product and architecture.
- **Secrets** live only in `.env.local` (git-ignored) and `/etc/misogi/env` on the server. Never write a key, password or token into code, docs, commits, logs or chat.
- **Before you call a change done:** `bun run typecheck && bun run lint && bun test`, with `bun dev` running on :3000.
- **Database work runs inside the Next server.** better-sqlite3 doesn't load under Bun, so scripts are HTTP calls to admin routes in `app/api/admin/`, and `bun test` only talks HTTP.
- **One tool registry** (`lib/server/tools.ts`) drives the HTTP API, MCP and Virgil. Change agent abilities there so all three stay the same.
- **Ship only merged `main`** with `scripts/deploy.sh`.
