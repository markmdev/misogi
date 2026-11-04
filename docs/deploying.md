# Deploying Misogi

Production is one EC2 instance running `next start` behind Caddy, which handles HTTPS, with SQLite on the instance's disk. One script builds and ships a commit, and rolls back on its own if the new release is unhealthy.

- **Live:** https://getmisogi.com (the earlier https://misogi.35-171-183-237.sslip.io still serves, for agents that saved it)
- **Health:** `/api/health` returns `{"ok":true,"challenges":…}`.
- **Resource IDs, costs, server layout, teardown:** [`infra/README.md`](../infra/README.md)

## Before your first deploy

1. **The SSH key.** See `infra/README.md` for which key to use; save it as `~/.ssh/misogi-hackathon.pem` with `chmod 600`. It never goes in git, chat logs or an agent transcript you share.
2. **Your IP on the allowlist.** Port 22 only accepts listed IPs. Find yours with `curl -4 ifconfig.me`; the command to add it is under "SSH from a new network" in `infra/README.md`.
3. **Check access:**
   ```sh
   ssh -i ~/.ssh/misogi-hackathon.pem ubuntu@35.171.183.237 'cat /srv/misogi/app/REVISION'
   ```
   It prints the commit that's live.

You also need git, ssh and curl locally. Nothing is built on your machine.

## Deploy

```sh
git switch main && git pull
scripts/deploy.sh              # ships the committed HEAD
```

What happens:

1. `git archive` of the commit is uploaded to a new release folder. Uncommitted changes never ship; the script warns if you have any.
2. The server runs `bun install --frozen-lockfile` and `bun run build`. If either fails, the live site isn't touched.
3. The `/srv/misogi/app` symlink switches to the new release and the service restarts.
4. The script checks the app on the server, then `https://<host>/` and `/api/health` from your machine. If a check fails, it switches back to the previous release.

It takes about 20 seconds when `bun.lock` hasn't changed and a minute or two when it has. The last 5 releases are kept.

Ground rules:

- Deploy from `main` after your change is merged, and say so in the team chat.
- One deploy at a time. A lock on the server refuses a second deploy that starts while one is running.
- Run `bun run typecheck && bun run lint && bun test` locally first ([running-locally.md](running-locally.md)).

**Roll back** to any earlier commit, for example the "previous release" a deploy prints:

```sh
scripts/deploy.sh <sha>
```

## Admin calls against production

`bun run seed` and `bun run ai-check` work against production when you point them at it. Keep the admin key in your shell; don't paste it anywhere:

```sh
export BASE_URL=https://getmisogi.com
export ADMIN_KEY=$(ssh -i ~/.ssh/misogi-hackathon.pem ubuntu@35.171.183.237 'sudo sed -n "s/^ADMIN_KEY=//p" /etc/misogi/env')

bun run ai-check --image       # checks every model job on the live key
bun run seed --force           # dates the demo history to today; real accounts, pages and covers stay
```

Run both before recording the demo or sending the link to judges. Never run `bun test` against production: it creates accounts. It refuses unless you force it.

## Models

Every model call goes to Meta. The key lives in `/etc/misogi/env`:

1. SSH in and edit the environment:
   ```sh
   ssh -i ~/.ssh/misogi-hackathon.pem ubuntu@35.171.183.237
   sudo nano /etc/misogi/env
   ```
   Add `META_API_KEY=…` (calls `api.meta.ai` directly). Add `META_BASE_URL=…` too only if you run a proxy that speaks the same API. Write values without quotes.
2. `sudo systemctl restart misogi`
3. Run `bun run ai-check --image` (see above). Every check should be ok. If a model name was wrong, add `AI_MODEL_<JOB>=<model>` to the env file (jobs: `AGENT`, `DRAFT`, `CODEGEN`, `FAST`, `IMAGE`) and restart.

Lines you add by hand survive `infra/provision.sh` re-runs.

## Production settings

They live in `/etc/misogi/env` (`root:misogi`, mode 640). After any change, run `sudo systemctl restart misogi`.

| Variable | What |
|---|---|
| `META_API_KEY` | Meta Model API key, added by hand |
| `META_BASE_URL` | Optional proxy that speaks the same API, added by hand |
| `AI_MODEL_<JOB>` | Optional model overrides |
| `ADMIN_KEY` | Protects `/api/admin/*`. Generated once. |
| `SESSION_SECRET` | Signs login cookies. Generated once; changing it logs everyone out. |
| `PUBLIC_URL` | Public origin used in links and the agent guide. It comes from `MISOGI_DOMAIN` in `infra/provision.sh`. |
| `NODE_ENV`, `PORT`, `HOSTNAME`, `DATABASE_PATH`, `DATA_DIR` | Fixed by `infra/provision.sh` |

## Moving to a real domain

This is how the site moved from its `sslip.io` name to getmisogi.com. The old name keeps serving, so agents that saved it keep working.

1. Point an `A` record for the new name (say `misogi.example.com`) at `35.171.183.237`. Wait until `dig +short misogi.example.com` prints that IP.
2. In `infra/Caddyfile`, serve both names so agents already using the old address keep working, and send bare-IP visits to the new name:
   ```
   misogi.example.com, misogi.35-171-183-237.sslip.io {
   	…unchanged…
   }

   http://35.171.183.237 {
   	redir https://misogi.example.com{uri} permanent
   }
   ```
3. In `infra/provision.sh` and `scripts/deploy.sh`, change the default after `DOMAIN=${MISOGI_DOMAIN:-` to `misogi.example.com`. Otherwise the next plain run puts the old address back in `PUBLIC_URL`. Commit and merge.
4. Run `MISOGI_REBOOT=never infra/provision.sh`. Caddy gets the new certificate, `PUBLIC_URL` is updated and the app restarts.
5. In Muse, send the connect message from the "Your AI" section again so Muse saves the new address, then choose "Always allow this site".

## Running your own copy

Any Ubuntu 24.04 server with ports 80 and 443 open, a DNS name pointing at it, and SSH access as a sudo user will work.

1. Add a site block for your hostname to `infra/Caddyfile`, copying the existing one.
2. Provision. It installs Node 24, bun, Caddy, the service, a swapfile and daily backups, and it's safe to re-run:
   ```sh
   MISOGI_HOST=<ip> MISOGI_DOMAIN=<name> MISOGI_SSH_KEY=<key> MISOGI_SSH_USER=<user> infra/provision.sh
   ```
3. Add your Meta key to `/etc/misogi/env` on the server (see "Models" above) and restart: `sudo systemctl restart misogi`.
4. Deploy with the same variables: `MISOGI_HOST=… MISOGI_DOMAIN=… MISOGI_SSH_KEY=… scripts/deploy.sh`
5. Seed it: `BASE_URL=https://<name> ADMIN_KEY=<from its /etc/misogi/env> bun run seed`

## When something's wrong

```sh
ssh -i ~/.ssh/misogi-hackathon.pem ubuntu@35.171.183.237
journalctl -u misogi -f                      # app logs
sudo systemctl restart misogi                # restart the app
sudo tail -f /var/log/caddy/misogi-access.log
journalctl -u caddy                          # HTTPS or proxy problems
```

- **The site is down after a deploy:** the script should already have rolled back. If not, run `scripts/deploy.sh <last good sha>`.
- **Model calls fail:** run `bun run ai-check --image` against production (see above). If a check keeps failing, check `META_API_KEY` in `/etc/misogi/env`.
- **Restore the database:** the server keeps a backup every day at 03:30 UTC, 14 days back. The steps are in `infra/README.md`, under "Restore a backup".
- **Don't stop the instance.** It has no fixed IP, so a stop and start changes the address and the hostname. Rebooting is fine.
