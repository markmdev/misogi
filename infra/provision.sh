#!/usr/bin/env bash
# Provision (or re-provision) the Misogi EC2 host. Idempotent: safe to re-run any time.
#
# Usage, from the operator's Mac:
#   infra/provision.sh
#
# Settings (env vars; the defaults match infra/README.md):
#   MISOGI_HOST       server public IPv4              (default 35.171.183.237)
#   MISOGI_DOMAIN     public hostname                 (default getmisogi.com)
#   MISOGI_SSH_KEY    SSH private key                 (default ~/.ssh/misogi-hackathon.pem)
#   MISOGI_SSH_USER   SSH user                        (default ubuntu)
#   GROK_KEY_API_DIR  folder with `url` and `password` (default ~/.config/grok-key-api)
#   BUN_VERSION       bun version to install          (default: packageManager in package.json)
#   MISOGI_REBOOT     auto | never: reboot if a kernel/libc update needs it (default auto)
#
# Secrets never appear in this file, on a command line or in the output. The Grok key API URL
# and password are read from GROK_KEY_API_DIR on the operator's machine and streamed to the
# server over SSH stdin. SESSION_SECRET and ADMIN_KEY are generated on the server the first time
# and kept on re-runs, so re-provisioning doesn't log everyone out. Lines added to /etc/misogi/env
# by hand (AI_PROVIDER=meta, Meta keys, model overrides) survive re-runs too.
#
# How it works: the script copies itself, Caddyfile and misogi.service to the server, then runs
# itself there as root with --remote.
set -euo pipefail

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# True if a site block in the Caddyfile lists the domain, alone or with others ("a.com, b.com {").
serves_domain() { # <Caddyfile> <domain>
	grep -E '^[^#[:space:]{][^#]*\{[[:space:]]*$' "$1" | tr -s ', \t{' '\n' | grep -qxF "$2"
}

# ----------------------------------------------------------------------------------------------
# Server side (runs as root on the instance)
# ----------------------------------------------------------------------------------------------

apt_get() {
	apt-get -y -q -o DPkg::Lock::Timeout=300 \
		-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}

# Prints the service environment. The first block is rewritten on every run. SESSION_SECRET and
# ADMIN_KEY are generated once and kept; AI_PROVIDER keeps its current value (the last one wins,
# as in systemd). Any other line added by hand (Meta keys, AI_MODEL_* overrides) is kept as is.
render_env() { # <current env file, may not exist> <domain> <grok url> <grok password>
	local env=$1 domain=$2 grok_url=$3 grok_password=$4
	local session_secret="" admin_key="" ai_provider=""
	local managed='^(NODE_ENV|PORT|HOSTNAME|DATABASE_PATH|DATA_DIR|PUBLIC_URL|SESSION_SECRET|ADMIN_KEY|AI_PROVIDER|GROK_KEY_API_URL|GROK_KEY_API_PASSWORD)='
	if [[ -f $env ]]; then
		session_secret=$(sed -n 's/^SESSION_SECRET=//p' "$env" | tail -n 1)
		admin_key=$(sed -n 's/^ADMIN_KEY=//p' "$env" | tail -n 1)
		ai_provider=$(sed -n 's/^AI_PROVIDER=//p' "$env" | tail -n 1)
	fi
	if [[ -z $session_secret ]]; then
		session_secret=$(openssl rand -base64 48 | tr -d '\n')
		echo "generated a new SESSION_SECRET" >&2
	fi
	if [[ -z $admin_key ]]; then
		admin_key=$(openssl rand -hex 24)
		echo "generated a new ADMIN_KEY (read it with: sudo grep ADMIN_KEY /etc/misogi/env)" >&2
	fi
	echo "NODE_ENV=production"
	echo "PORT=3000"
	echo "HOSTNAME=127.0.0.1"
	echo "DATABASE_PATH=/var/lib/misogi/misogi.db"
	echo "DATA_DIR=/var/lib/misogi"
	echo "PUBLIC_URL=https://$domain"
	printf 'SESSION_SECRET=%s\n' "$session_secret"
	printf 'ADMIN_KEY=%s\n' "$admin_key"
	printf 'AI_PROVIDER=%s\n' "${ai_provider:-xai}"
	printf 'GROK_KEY_API_URL=%s\n' "$grok_url"
	printf 'GROK_KEY_API_PASSWORD=%s\n' "$grok_password"
	if [[ -f $env ]]; then
		grep -vE "$managed" "$env" | grep -vE '^[[:space:]]*$' || true
	fi
}

remote() {
	local domain=$1 public_ip=$2 bun_version=$3
	local src
	src=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

	# Secrets arrive on stdin: line 1 = Grok key API URL, line 2 = its password. Read them first,
	# then detach stdin so apt/dpkg can't swallow or block on it.
	local grok_url="" grok_password=""
	IFS= read -r grok_url || true
	IFS= read -r grok_password || true
	exec </dev/null
	[[ $EUID -eq 0 ]] || die "--remote must run as root"
	[[ -n $grok_url && -n $grok_password ]] || die "expected the Grok key API URL and password on stdin"
	local v
	for v in "$grok_url" "$grok_password"; do
		# Keep values safe to use unquoted in a systemd EnvironmentFile.
		[[ $v =~ ^[A-Za-z0-9_.~+/=:@%-]+$ ]] ||
			die "a Grok key API value has characters that would need quoting in /etc/misogi/env"
	done

	export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

	step "Waiting for cloud-init to finish"
	# Exit code 2 means "done, degraded" (IPv6 metadata endpoint unreachable), which is harmless.
	cloud-init status --wait >/dev/null 2>&1 || true

	step "apt update + upgrade"
	apt-get update -q -o DPkg::Lock::Timeout=300
	apt_get upgrade

	step "Base packages"
	apt_get install unattended-upgrades build-essential python3 sqlite3 git rsync curl \
		ca-certificates gnupg unzip openssl dnsutils

	step "Unattended security upgrades"
	cat >/etc/apt/apt.conf.d/20auto-upgrades <<-'EOF'
		APT::Periodic::Update-Package-Lists "1";
		APT::Periodic::Unattended-Upgrade "1";
	EOF
	systemctl enable --now unattended-upgrades.service >/dev/null 2>&1

	step "2 GB swapfile"
	if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
		if [[ ! -f /swapfile ]]; then
			fallocate -l 2G /swapfile
			chmod 600 /swapfile
			mkswap /swapfile >/dev/null
		fi
		swapon /swapfile
	fi
	grep -qE '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
	echo 'vm.swappiness=10' >/etc/sysctl.d/99-misogi-swap.conf
	sysctl -q -p /etc/sysctl.d/99-misogi-swap.conf

	step "apt repos: NodeSource (Node.js 24) and Caddy"
	install -d -m 755 /etc/apt/keyrings
	if [[ ! -s /etc/apt/keyrings/nodesource.gpg ]]; then
		curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
			gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
	fi
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
		>/etc/apt/sources.list.d/nodesource.list
	cat >/etc/apt/preferences.d/nodejs <<-'EOF'
		Package: nodejs
		Pin: origin deb.nodesource.com
		Pin-Priority: 600
	EOF
	# Official Caddy instructions: https://caddyserver.com/docs/install#debian-ubuntu-raspbian
	if [[ ! -s /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]]; then
		curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
			gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	fi
	if [[ ! -s /etc/apt/sources.list.d/caddy-stable.list ]]; then
		curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
			>/etc/apt/sources.list.d/caddy-stable.list
	fi
	chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
	apt-get update -q -o DPkg::Lock::Timeout=300
	apt_get install nodejs caddy
	[[ $(node --version) == v24.* ]] || die "expected Node.js 24, got $(node --version)"

	step "bun $bun_version (system-wide, /usr/local/bin/bun)"
	if [[ $(/usr/local/bin/bun --version 2>/dev/null || true) != "$bun_version" ]]; then
		curl -fsSL https://bun.sh/install -o "$src/bun-install.sh"
		# SHELL=/bin/sh stops the installer from editing root's shell rc files.
		BUN_INSTALL=/usr/local/bun SHELL=/bin/sh bash "$src/bun-install.sh" "bun-v$bun_version" >/dev/null
		ln -sfn /usr/local/bun/bin/bun /usr/local/bin/bun
		ln -sfn /usr/local/bun/bin/bun /usr/local/bin/bunx
	fi
	[[ $(/usr/local/bin/bun --version) == "$bun_version" ]] || die "bun install failed"

	step "User misogi and directories"
	if ! id misogi >/dev/null 2>&1; then
		useradd --system --user-group --home-dir /srv/misogi --no-create-home \
			--shell /usr/sbin/nologin misogi
	fi
	install -d -o misogi -g misogi -m 755 /srv/misogi /srv/misogi/releases
	install -d -o misogi -g misogi -m 750 /var/lib/misogi /var/lib/misogi/backups
	install -d -o root -g misogi -m 750 /etc/misogi
	# /srv/misogi/app is a symlink to the live release; scripts/deploy.sh creates and switches it.

	step "/etc/misogi/env"
	local env=/etc/misogi/env tmp env_changed=0
	tmp=$(mktemp /etc/misogi/.env.XXXXXX)
	chown root:misogi "$tmp"
	chmod 640 "$tmp"
	render_env "$env" "$domain" "$grok_url" "$grok_password" >"$tmp"
	if [[ -f $env ]] && cmp -s "$tmp" "$env"; then
		rm -f "$tmp"
		echo "unchanged"
	else
		mv -f "$tmp" "$env"
		env_changed=1
		echo "written (root:misogi 640)"
	fi
	unset grok_url grok_password

	step "systemd unit misogi.service"
	local unit_changed=0
	if ! cmp -s "$src/misogi.service" /etc/systemd/system/misogi.service; then
		install -m 644 "$src/misogi.service" /etc/systemd/system/misogi.service
		systemctl daemon-reload
		unit_changed=1
	fi
	systemd-analyze verify /etc/systemd/system/misogi.service
	systemctl enable misogi.service >/dev/null 2>&1
	if [[ -e /srv/misogi/app/package.json ]] && ((unit_changed || env_changed)); then
		systemctl restart misogi.service
		echo "restarted (config changed)"
	elif [[ ! -e /srv/misogi/app/package.json ]]; then
		echo "enabled; it starts after the first scripts/deploy.sh"
	fi

	step "Caddy"
	serves_domain "$src/Caddyfile" "$domain" || die "Caddyfile doesn't serve $domain"
	# Validate as the caddy user, from a copy it can read (the upload dir is private).
	local check
	check=$(mktemp /tmp/Caddyfile.XXXXXX)
	install -m 644 "$src/Caddyfile" "$check"
	if ! runuser -u caddy -- caddy validate --adapter caddyfile --config "$check" >/dev/null 2>&1; then
		runuser -u caddy -- caddy validate --adapter caddyfile --config "$check" || true
		rm -f "$check"
		die "invalid Caddyfile"
	fi
	rm -f "$check"
	systemctl enable --now caddy.service >/dev/null 2>&1
	if ! cmp -s "$src/Caddyfile" /etc/caddy/Caddyfile; then
		install -m 644 "$src/Caddyfile" /etc/caddy/Caddyfile
		systemctl reload caddy.service
		echo "Caddyfile installed and reloaded"
	else
		echo "Caddyfile unchanged"
	fi

	step "Daily SQLite backup (cron, keeps 14)"
	cat >/usr/local/sbin/misogi-backup <<-'EOF'
		#!/bin/sh
		# Daily online backup of the Misogi SQLite database; keeps the newest 14.
		# Managed by infra/provision.sh. Runs from /etc/cron.d/misogi-backup as misogi.
		set -eu
		umask 027
		db=${MISOGI_DB:-/var/lib/misogi/misogi.db}
		dir=${MISOGI_BACKUP_DIR:-/var/lib/misogi/backups}
		[ -f "$db" ] || exit 0
		out="$dir/misogi-$(date +%F).db"
		rm -f "$out.tmp"
		sqlite3 "$db" ".backup '$out.tmp'"
		mv -f "$out.tmp" "$out"
		ls -1 "$dir"/misogi-*.db | sort -r | tail -n +15 | while IFS= read -r f; do rm -f -- "$f"; done
	EOF
	chmod 755 /usr/local/sbin/misogi-backup
	cat >/etc/cron.d/misogi-backup <<-'EOF'
		# Daily SQLite backup of the Misogi database (keeps 14). Managed by infra/provision.sh.
		SHELL=/bin/sh
		PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
		30 3 * * * misogi /usr/local/sbin/misogi-backup
	EOF
	chmod 644 /etc/cron.d/misogi-backup

	step "Installed"
	printf '  %-9s %s\n' \
		ubuntu "$(lsb_release -ds)" \
		node "$(node --version)" \
		npm "$(npm --version)" \
		bun "$(bun --version)" \
		caddy "$(caddy version | cut -d' ' -f1)" \
		sqlite3 "$(sqlite3 --version | cut -d' ' -f1)" \
		python3 "$(python3 --version | cut -d' ' -f2)" \
		git "$(git --version | cut -d' ' -f3)" \
		swap "$(swapon --show=SIZE --noheadings | head -n 1 | tr -d ' ')"
	if [[ -f /var/run/reboot-required ]]; then echo "  (reboot required)"; fi
}

if [[ ${1:-} == --remote ]]; then
	shift
	remote "$@"
	exit 0
fi

# ----------------------------------------------------------------------------------------------
# Operator side (runs on the Mac)
# ----------------------------------------------------------------------------------------------

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
HOST=${MISOGI_HOST:-35.171.183.237}
DOMAIN=${MISOGI_DOMAIN:-getmisogi.com}
SSH_KEY=${MISOGI_SSH_KEY:-$HOME/.ssh/misogi-hackathon.pem}
SSH_USER=${MISOGI_SSH_USER:-ubuntu}
GROK_DIR=${GROK_KEY_API_DIR:-$HOME/.config/grok-key-api}
REBOOT=${MISOGI_REBOOT:-auto}
BUN_VERSION=${BUN_VERSION:-$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"bun@\([^"]*\)".*/\1/p' "$REPO/package.json")}

[[ -n $BUN_VERSION ]] || die "couldn't read the bun version from package.json; set BUN_VERSION"
[[ -r $SSH_KEY ]] || die "SSH key not found: $SSH_KEY"
[[ -s $GROK_DIR/url && -s $GROK_DIR/password ]] || die "missing $GROK_DIR/url or $GROK_DIR/password"
serves_domain "$REPO/infra/Caddyfile" "$DOMAIN" || die "infra/Caddyfile doesn't serve $DOMAIN; update it first"

CTL_DIR=$(mktemp -d /tmp/misogi-ssh.XXXXXX)
SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10
	-o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new
	-o ControlMaster=auto -o "ControlPath=$CTL_DIR/%C" -o ControlPersist=120)
cleanup() {
	ssh -o "ControlPath=$CTL_DIR/%C" -O exit "$SSH_USER@$HOST" >/dev/null 2>&1 || true
	rm -rf "$CTL_DIR"
}
trap cleanup EXIT
remote_sh() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$HOST" "$@"; }

echo "Provisioning $SSH_USER@$HOST for https://$DOMAIN (bun $BUN_VERSION)"

step "DNS: $DOMAIN -> $HOST"
resolved=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
	resolved=$(dig +short "$DOMAIN" A | tail -n 1)
	[[ $resolved == "$HOST" ]] && break
	sleep 3
done
[[ $resolved == "$HOST" ]] || die "$DOMAIN resolves to '${resolved:-nothing}', expected $HOST"
echo "ok"

step "Uploading provisioning files"
remote_sh 'rm -rf /tmp/misogi-provision && mkdir -m 700 /tmp/misogi-provision'
scp -q "${SSH_OPTS[@]}" "$REPO/infra/provision.sh" "$REPO/infra/Caddyfile" "$REPO/infra/misogi.service" \
	"$SSH_USER@$HOST:/tmp/misogi-provision/"

# Secrets go over stdin only (never argv): line 1 = URL, line 2 = password.
{
	tr -d '\r\n' <"$GROK_DIR/url"
	echo
	tr -d '\r\n' <"$GROK_DIR/password"
	echo
} | remote_sh "sudo bash /tmp/misogi-provision/provision.sh --remote $(printf '%q %q %q' "$DOMAIN" "$HOST" "$BUN_VERSION")"
remote_sh 'rm -rf /tmp/misogi-provision'

if [[ $REBOOT == auto ]] && remote_sh 'test -f /var/run/reboot-required'; then
	step "Rebooting to finish the upgrade"
	remote_sh 'sudo systemctl reboot' >/dev/null 2>&1 || true
	ssh -o "ControlPath=$CTL_DIR/%C" -O exit "$SSH_USER@$HOST" >/dev/null 2>&1 || true
	sleep 20
	for _ in $(seq 1 40); do remote_sh true 2>/dev/null && break; sleep 5; done
	remote_sh 'systemctl is-system-running --wait >/dev/null 2>&1 || true; uptime'
fi

step "Verifying"
remote_sh 'printf "caddy: %s, misogi.service: %s/%s\n" "$(systemctl is-active caddy)" "$(systemctl is-enabled misogi)" "$(systemctl is-active misogi || true)"'
code=""
for _ in $(seq 1 30); do
	code=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$DOMAIN/" 2>/dev/null) && break
	code=""
	sleep 5
done
[[ -n $code ]] || die "no valid TLS on https://$DOMAIN/ yet (check: journalctl -u caddy)"
echo "TLS certificate valid; https://$DOMAIN/ -> HTTP $code"
if [[ $code == 502 ]]; then echo "(502 is expected until the first scripts/deploy.sh)"; fi
redirect=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$HOST/" || true)
echo "http://$HOST/ -> $redirect"
echo
echo "Done. Deploy with: scripts/deploy.sh"
