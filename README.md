# Meta hackathon

Mark, Oscar and Java's entry for the Meta Global AI Developer Hackathon. The project isn't picked yet; for now this is an empty app that deploys.

Live: https://meta-hackathon.<account>.workers.dev

## Run it

```sh
bun install
bun dev              # http://localhost:3000
bun run preview      # the same app in Cloudflare's Workers runtime, http://localhost:8787
```

`bun run preview` is for what works in `bun dev` but breaks once deployed.

## Deploys

Cloudflare Workers Builds builds every push with `bunx opennextjs-cloudflare build`. A push to `main` goes to production; any other branch gets its own preview at `https://<branch>-meta-hackathon.<account>.workers.dev`. Nobody deploys by hand. If a build fails, run that same command locally to see why.

The free plan allows **10 ms of CPU per request**. Waiting on Meta or another API doesn't count; parsing, image work and big JSON do, so heavy work goes in the browser.

## How we work

- **Private until we submit**, then public for the judges.
- **Everything reaches main by pull request.** Keep PRs small and merge your own once its preview link works. Nobody force-pushes main.
- **Stack:** Next.js with the App Router, TypeScript, bun and Tailwind, on Cloudflare Workers through OpenNext. Change it if the idea needs something else.
- **Meta's API key never goes in this repo.** The app calls Meta through a small gateway that holds the key and stops spending before the free credits run out (below).
- **Mark's agents sign everything they write here** with `[AGENT · …]`.

## Calling Meta

Every Meta call goes through the gateway at `https://meta-gateway.<account>.workers.dev/v1`, from server code only, never the browser:

```ts
import OpenAI from "openai";
import { createHash } from "node:crypto";

const meta = new OpenAI({
  baseURL: "https://meta-gateway.<account>.workers.dev/v1",
  apiKey: forJudges ? env.GATEWAY_JUDGES_KEY : env.GATEWAY_KEY,
  maxRetries: 0, // a retry is a second billed call
});

const visitor = createHash("sha256").update(request.headers.get("cf-connecting-ip") ?? "").digest("hex");
await meta.responses.create(
  { model: "muse-spark-1.3", input: "…", max_output_tokens: 4096, stream: true },
  { headers: { "x-visitor": visitor } },
);
```

- **It's Meta's own API** (`/v1/responses`), for Muse Spark, Muse Wonder, Muse Image and SAM 3.1 (one image per call). Text calls must set `max_output_tokens`. Hosted tools such as web search, background calls and SAM video are refused for now; ask if the idea needs one.
- **Keys:** `GATEWAY_KEY` is for public visitors, and `GATEWAY_JUDGES_KEY` for visits that came through the judges' link in our submission. Both are already secrets on this Worker. Previews get a dev key under both names. For a laptop, ask the engineer.
- **`x-visitor`** is a hash of the visitor's IP. It's needed on every call from the live app, and each visitor gets about $0.50 a day.
- **`429` with code `gateway_resting`** means the credits set aside for that call are used up. Show a resting state, never an error. The last $40 is kept for the judges.
- **Calls cost real credits**, so build screens against recorded answers and call the gateway only when testing the real thing.

