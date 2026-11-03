#!/usr/bin/env bash
# Deploy committed code to the Misogi EC2 host (see infra/README.md).
#
# Usage:
#   scripts/deploy.sh             deploy HEAD
#   scripts/deploy.sh <git-ref>   deploy another commit, branch or tag (also how you roll back)
#
# Only committed code ships: the release is built from `git archive <ref>`, so uncommitted
# changes are ignored (you get a warning).
#
# Settings (env vars; the defaults match infra/README.md):
#   MISOGI_HOST           server address     (default 35.171.183.237)
#   MISOGI_DOMAIN         public hostname    (default misogi.<ip-with-dashes>.sslip.io)
#   MISOGI_SSH_KEY        SSH private key    (default ~/.ssh/misogi-hackathon.pem)
#   MISOGI_SSH_USER       SSH user           (default ubuntu)
#   MISOGI_KEEP_RELEASES  releases to keep   (default 5)
#
# What it does:
#   1. uploads `git archive <ref>` to /srv/misogi/releases/<UTC time>-<sha> on the server
#   2. runs `bun install --frozen-lockfile` and `bun run build` there as the misogi user, with the
#      service's environment (/etc/misogi/env). A failed build never touches the live release.
#   3. atomically points the /srv/misogi/app symlink at the new release, restarts misogi.service
#   4. health-checks the app on the server, then https://<host>/ (and /api/health if the commit
#      has one) from here, with retries
#   5. if anything fails after the switch, points the symlink back at the previous release and
#      restarts it
#   6. keeps the newest MISOGI_KEEP_RELEASES releases
set -euo pipefail

HOST=${MISOGI_HOST:-35.171.183.237}
DOMAIN=${MISOGI_DOMAIN:-misogi.${HOST//./-}.sslip.io}
SSH_KEY=${MISOGI_SSH_KEY:-$HOME/.ssh/misogi-hackathon.pem}
SSH_USER=${MISOGI_SSH_USER:-ubuntu}
KEEP=${MISOGI_KEEP_RELEASES:-5}
REF=${1:-HEAD}

START=$SECONDS
step() { printf '\n==> [%3ss] %s\n' "$((SECONDS - START))" "$*"; }
info() { printf '    %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# ----------------------------------------------------------------------------------------------
# Functions that run on the server as root (shipped over SSH with `declare -f`)
# ----------------------------------------------------------------------------------------------

remote_build() { # <release dir> <previous release dir or ""> <bun version from package.json>
	local rdir=$1 prev=$2 want_bun=$3 line
	exec 9>/srv/misogi/.deploy.lock
	flock -n 9 || { echo "ERROR: another deploy is already running on the server" >&2; return 1; }
	cd "$rdir"
	echo "    server: node $(node --version), bun $(bun --version)"
	if [[ -n $want_bun && $(bun --version) != "$want_bun" ]]; then
		echo "    WARNING: package.json wants bun $want_bun; re-run infra/provision.sh to match"
	fi
	if [[ -f bun.lock ]]; then
		if [[ -n $prev && -f $prev/bun.lock ]] && cmp -s bun.lock "$prev/bun.lock"; then
			echo "    bun.lock unchanged since the live release (packages come from the bun cache)"
		else
			echo "    bun.lock changed (or first deploy)"
		fi
		runuser -u misogi -- bun install --frozen-lockfile
	else
		echo "    WARNING: this commit has no bun.lock; running a plain bun install"
		runuser -u misogi -- bun install
	fi
	# Build with the environment the service runs with. Values are taken literally, like systemd
	# does, and go through the environment rather than the command line.
	while IFS= read -r line || [[ -n $line ]]; do
		if [[ $line =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then export "${line%%=*}=${line#*=}"; fi
	done </etc/misogi/env
	export NEXT_TELEMETRY_DISABLED=1
	runuser -u misogi -- bun run build
}

remote_activate() { # <release dir>
	local rdir=$1 app=/srv/misogi/app
	# A real directory here would block the atomic rename; only an empty one is removed.
	if [[ -d $app && ! -L $app ]]; then rmdir "$app"; fi
	runuser -u misogi -- ln -sfn "$rdir" "$app.new"
	runuser -u misogi -- mv -Tf "$app.new" "$app" # rename(2): atomic
	systemctl restart misogi.service
	echo "    /srv/misogi/app -> $rdir; misogi.service restarted"
}

remote_local_health() { # <release dir>
	local rdir=$1 code="" pid cwd errors=0
	# While Next starts, connections are refused (000): wait up to ~60s. HTTP errors from a running
	# server rarely fix themselves: give up after 5 in a row.
	for _ in $(seq 1 40); do
		code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' http://127.0.0.1:3000/ || true)
		if [[ $code =~ ^[23][0-9][0-9]$ ]]; then break; fi
		if [[ $code != 000 ]]; then
			errors=$((errors + 1))
			((errors < 5)) || break
		fi
		sleep 1.5
	done
	pid=$(systemctl show -p MainPID --value misogi.service)
	cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
	echo "    on server: 127.0.0.1:3000/ -> HTTP $code (pid $pid running from ${cwd:-?})"
	[[ $code =~ ^[23][0-9][0-9]$ && $cwd == "$rdir" ]]
}

remote_rollback() { # <previous release dir or ""> <failed release dir>
	local prev=$1 failed=$2 app=/srv/misogi/app
	echo "    last log lines of the failed release:"
	journalctl -u misogi.service -n 25 --no-pager -o cat | sed 's/^/      | /' || true
	if [[ -n $prev && -d $prev ]]; then
		runuser -u misogi -- ln -sfn "$prev" "$app.new"
		runuser -u misogi -- mv -Tf "$app.new" "$app"
		systemctl restart misogi.service
		echo "    /srv/misogi/app -> $prev; misogi.service restarted"
	else
		rm -f "$app"
		systemctl stop misogi.service || true
		echo "    no previous release to go back to; misogi.service stopped"
	fi
	echo "    the failed release stays for inspection: $failed"
}

remote_prune() { # <number of releases to keep>
	local keep=$1 live n=0 r
	live=$(readlink -e /srv/misogi/app || true)
	while IFS= read -r r; do
		n=$((n + 1))
		if ((n <= keep)) || [[ /srv/misogi/releases/$r == "$live" ]]; then continue; fi
		rm -rf -- "/srv/misogi/releases/$r"
		echo "    removed old release $r"
	done < <(ls -1 /srv/misogi/releases | grep -E '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]+$' | sort -r)
	echo "    releases on server: $(ls -1 /srv/misogi/releases | wc -l)"
}

# ----------------------------------------------------------------------------------------------
# Local side
# ----------------------------------------------------------------------------------------------

cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
[[ -r $SSH_KEY ]] || die "SSH key not found: $SSH_KEY (set MISOGI_SSH_KEY)"
SHA=$(git rev-parse --verify --quiet "$REF^{commit}") || die "not a commit: $REF"
SHORT=${SHA:0:12}
RDIR=/srv/misogi/releases/$(date -u +%Y%m%dT%H%M%SZ)-$SHORT
PREV=""
PHASE=prepare

CTL_DIR=$(mktemp -d /tmp/misogi-ssh.XXXXXX)
SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10
	-o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new
	-o ControlMaster=auto -o "ControlPath=$CTL_DIR/%C" -o ControlPersist=300)
remote_sh() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" "$@"; }
# Run one of the remote_* functions above on the server as root. Arguments are quoted into the
# script itself; stdin of the function is /dev/null.
remote_fn() {
	local fn=$1
	shift
	{
		declare -f "$fn"
		printf 'set -euo pipefail\n%s' "$fn"
		printf ' %q' "$@"
		printf ' </dev/null\n'
	} | remote_sh 'sudo bash -s'
}

public_health() { # <url> <regex for acceptable status>
	local url=$1 want=$2 code=""
	for _ in $(seq 1 20); do
		code=$(curl -sS -o /dev/null --max-time 10 -w '%{http_code}' "$url" 2>/dev/null || true)
		if [[ $code =~ $want ]]; then
			info "$url -> HTTP $code"
			return 0
		fi
		sleep 3
	done
	info "$url -> HTTP ${code:-000} after 20 tries"
	return 1
}

on_exit() {
	local rc=$?
	trap - EXIT INT TERM
	if ((rc != 0)); then
		case $PHASE in
		build)
			step "Build failed; the live release was not touched"
			remote_sh "sudo rm -rf -- $(printf %q "$RDIR")" && info "removed $RDIR" || true
			;;
		live)
			step "Deploy failed after the switch: rolling back"
			remote_fn remote_rollback "$PREV" "$RDIR" || true
			if [[ -n $PREV ]]; then
				if public_health "https://$DOMAIN/" '^[23][0-9][0-9]$'; then
					info "rolled back to $(basename "$PREV")"
				else
					info "WARNING: the site is still unhealthy after the rollback"
				fi
			fi
			;;
		esac
		printf '\nDEPLOY FAILED: %s was not deployed (exit %s)\n' "$SHORT" "$rc" >&2
	fi
	ssh -o "ControlPath=$CTL_DIR/%C" -O exit "$SSH_USER@$HOST" >/dev/null 2>&1 || true
	rm -rf "$CTL_DIR"
	exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

step "Deploying $(git log -1 --format='%h %s' "$SHA") to https://$DOMAIN"
if [[ -n $(git status --porcelain) ]]; then
	info "NOTE: your working tree has uncommitted changes; they are NOT deployed"
fi
HEALTH_PATH=""
for f in app/api/health/route.{ts,js,tsx,jsx,mjs} src/app/api/health/route.{ts,js,tsx,jsx,mjs} \
	pages/api/health.{ts,js} src/pages/api/health.{ts,js}; do
	if git cat-file -e "$SHA:$f" 2>/dev/null; then HEALTH_PATH=/api/health && break; fi
done
WANT_BUN=$(git show "$SHA:package.json" | sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"bun@\([^"]*\)".*/\1/p')

remote_sh 'test -d /srv/misogi/releases && test -x /usr/local/bin/bun && systemctl cat misogi.service >/dev/null 2>&1' ||
	die "$HOST isn't provisioned (or unreachable); run infra/provision.sh first"
PREV=$(remote_sh 'if [ -L /srv/misogi/app ]; then readlink -e /srv/misogi/app || true; fi')
info "live release: ${PREV:-none (first deploy)}"
info "new release:  $RDIR"

PHASE=build
step "Uploading committed tree ($SHORT)"
git archive --format=tar.gz "$SHA" | remote_sh "sudo -u misogi mkdir -- $(printf %q "$RDIR") &&
	sudo -u misogi tar -xzf - -C $(printf %q "$RDIR") &&
	echo $SHA | sudo -u misogi tee $(printf %q "$RDIR/REVISION") >/dev/null"
info "$(remote_sh "du -sh $(printf %q "$RDIR") | cut -f1") uploaded"

step "bun install --frozen-lockfile && bun run build (on server)"
remote_fn remote_build "$RDIR" "$PREV" "$WANT_BUN"

PHASE=live
step "Switching /srv/misogi/app and restarting misogi.service"
remote_fn remote_activate "$RDIR"

step "Health checks"
remote_fn remote_local_health "$RDIR" || die "the app isn't answering on the server"
public_health "https://$DOMAIN/" '^[23][0-9][0-9]$' || die "https://$DOMAIN/ isn't healthy"
if [[ -n $HEALTH_PATH ]]; then
	public_health "https://$DOMAIN$HEALTH_PATH" '^200$' || die "$HEALTH_PATH isn't healthy"
else
	info "(no /api/health route in this commit; skipped)"
fi
PHASE=done

step "Pruning old releases (keeping $KEEP)"
remote_fn remote_prune "$KEEP" || info "WARNING: pruning failed (deploy itself succeeded)"

step "Deployed $SHORT to https://$DOMAIN/ in $((SECONDS - START))s"
if [[ -n $PREV ]]; then
	info "previous release: $(basename "$PREV") (roll back: scripts/deploy.sh <its sha>)"
fi
