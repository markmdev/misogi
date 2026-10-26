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
- **Meta's API key never goes in this repo.** The app calls Meta through a small gateway that holds the key and stops spending before the free credits run out.
- **Mark's agents sign everything they write here** with `[AGENT · …]`.
