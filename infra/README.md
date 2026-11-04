# Misogi hosting (EC2)

Misogi runs as a plain `next start` on one small EC2 instance, with Caddy in front for TLS.
Everything here was created by hand with the AWS CLI on 2026-11-03 and provisioned with
[`provision.sh`](provision.sh). Deploys go through [`../scripts/deploy.sh`](../scripts/deploy.sh).

- **Site:** https://getmisogi.com
- **SSH:** `ssh -i ~/.ssh/misogi-hackathon.pem ubuntu@35.171.183.237`
- **Deploy:** `scripts/deploy.sh` (ships the committed `HEAD`). Step-by-step guide for the team:
  [`docs/deploying.md`](../docs/deploying.md)

The AWS account (AWS_ACCOUNT_ID, us-east-1) also runs other production systems. Every Misogi
resource is tagged `Name=misogi-hackathon` and `Project=misogi-hackathon`. Don't touch anything
without that tag.

## What exists

| Resource | ID / value | Notes |
| --- | --- | --- |
| EC2 instance | `i-0fb6b64d187220ae7` | t4g.medium (2 vCPU Graviton, 4 GB), Ubuntu 24.04 arm64 (`ami-09a93d801db0bafae`), us-east-1a, IMDSv2 required |
| Root volume | `vol-06a4bba053895235f` | 30 GB gp3, encrypted (account default), deleted with the instance |
| Network interface | `eni-097670a1d68640a7a` | private IP 172.31.42.102, default subnet `subnet-0216e83186e93ed8e` of the default VPC `vpc-0ff3e4f80158d788e` |
| Public IPv4 | `35.171.183.237` | **auto-assigned, not an Elastic IP** (see below) |
| Security group | `sg-076f84021708f5a7e` (`misogi-hackathon-sg`) | in: 22/tcp from YOUR_IP/32 only; 80 and 443/tcp from 0.0.0.0/0 and ::/0. out: all |
| Key pair | `misogi-hackathon` (`key-0e01c3892c100ab26`) | ed25519; private key at `~/.ssh/misogi-hackathon.pem` on the operator's Mac (not in git) |
| Hostname | `getmisogi.com` | A records for it and `www` point at the instance; `www` redirects to it. The earlier `misogi.35-171-183-237.sslip.io` still serves: [sslip.io](https://sslip.io) resolves it to the IP inside the name |
| TLS | Let's Encrypt | Caddy gets and renews the certificate on its own |

Approximate cost: about $24/month for the instance, $2.40 for the volume and $3.65 for the public IPv4.

### No Elastic IP yet

The account is at its Elastic IP quota (5 of 5, all attached to production instances), so
`allocate-address` failed with `AddressLimitExceeded`. The instance uses its auto-assigned
public IP for now. That IP **survives reboots but changes if the instance is stopped and
started**, and the hostname changes with it. Reboot freely, but don't stop the instance.

To move to an Elastic IP later, once someone raises the quota (Service Quotas, `ec2`
`L-0263D0A3`) or frees one up:

```bash
export AWS_REGION=us-east-1
TAGS='{Key=Name,Value=misogi-hackathon},{Key=Project,Value=misogi-hackathon}'
ALLOC=$(aws ec2 allocate-address --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[$TAGS]" --query AllocationId --output text)
aws ec2 associate-address --allocation-id "$ALLOC" --instance-id i-0fb6b64d187220ae7
NEW_IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)
```

Then replace `35.171.183.237` / `35-171-183-237` with the new IP in `infra/Caddyfile`, this README,
`infra/provision.sh` and `scripts/deploy.sh` (the defaults), commit, and run
`infra/provision.sh` (it updates `PUBLIC_URL` in `/etc/misogi/env` and Caddy fetches a new
certificate) followed by `scripts/deploy.sh`. Also run `ssh-keygen -R 35.171.183.237`.

## Server layout

| Path | What | Owner / mode |
| --- | --- | --- |
| `/srv/misogi/releases/<UTC time>-<sha>/` | one directory per deploy (source, `node_modules`, `.next`, `REVISION`) | misogi |
| `/srv/misogi/app` | symlink to the live release; the service's `WorkingDirectory` | misogi |
| `/var/lib/misogi/` | `DATA_DIR`; the SQLite database is `misogi.db` here | misogi:misogi 750 |
| `/var/lib/misogi/backups/` | daily `misogi-YYYY-MM-DD.db` backups, newest 14 kept | misogi:misogi 750 |
| `/etc/misogi/env` | service environment, including secrets | root:misogi 640 |
| `/etc/systemd/system/misogi.service` | copy of [`misogi.service`](misogi.service) | root |
| `/etc/caddy/Caddyfile` | copy of [`Caddyfile`](Caddyfile) | root |
| `/etc/cron.d/misogi-backup`, `/usr/local/sbin/misogi-backup` | backup job (03:30 UTC, as misogi) | root |
| `/etc/cron.d/misogi-demo-refresh`, `/usr/local/sbin/misogi-demo-refresh` | demo climbers' stories brought up to today (15:55 UTC, as misogi) | root |

Installed: Node.js 24 (NodeSource apt repo), bun (version pinned to `packageManager` in
`package.json`, at `/usr/local/bin/bun`), Caddy (official apt repo), sqlite3, git, rsync,
build-essential, python3. Unattended security upgrades are on, and there's a 2 GB swapfile.

`/etc/misogi/env` holds `NODE_ENV`, `PORT`, `HOSTNAME`, `DATABASE_PATH`, `DATA_DIR`,
`PUBLIC_URL`, `SESSION_SECRET` and `ADMIN_KEY`, plus anything added by hand (the Meta key,
`AI_MODEL_*`). `SESSION_SECRET` and `ADMIN_KEY` are generated on the server once and kept on
re-runs. None of these values are in git. To read one, SSH in and run `sudo cat /etc/misogi/env`.

## Deploying

```bash
scripts/deploy.sh             # deploy HEAD
scripts/deploy.sh <git-ref>   # deploy another commit; also how you roll back on purpose
```

Only committed code ships, because the release is built from `git archive`. The script uploads
the tree to a new release directory, then runs `bun install --frozen-lockfile` and
`bun run build` on the server as `misogi` with the service's environment. It switches the
`/srv/misogi/app` symlink atomically, restarts `misogi.service` and health-checks
`127.0.0.1:3000` on the server, then `https://<host>/` and `/api/health` (if the commit has that
route) from your machine. If the build fails, the live release is never touched. If a check fails
after the switch, the script points the symlink back at the previous release, restarts, and
exits non-zero. It keeps the newest 5 releases. A deploy with an unchanged `bun.lock` takes about
20 seconds.

Overrides: `MISOGI_HOST`, `MISOGI_DOMAIN`, `MISOGI_SSH_KEY`, `MISOGI_SSH_USER`,
`MISOGI_KEEP_RELEASES`.

## Operating it

```bash
ssh -i ~/.ssh/misogi-hackathon.pem ubuntu@35.171.183.237
journalctl -u misogi -f                      # app logs
sudo systemctl restart misogi                # restart the app
sudo tail -f /var/log/caddy/misogi-access.log
journalctl -u caddy                          # TLS / proxy problems
```

- **Change or add an env var:** edit `/etc/misogi/env` (keep values unquoted), then
  `sudo systemctl restart misogi`. `provision.sh` rewrites its own lines on every run (keeping
  `SESSION_SECRET` and `ADMIN_KEY`) and carries every other line over unchanged.
  `PUBLIC_URL` comes from `MISOGI_DOMAIN`, so change that in the script, not in the file.
- **Re-provision** (safe at any time; restarts the app only if the unit or env changed):
  `infra/provision.sh`.
- **Restore a backup:** `sudo systemctl stop misogi`,
  `sudo -u misogi cp /var/lib/misogi/backups/misogi-<date>.db /var/lib/misogi/misogi.db`, remove
  any `misogi.db-wal` / `misogi.db-shm` next to it, then `sudo systemctl start misogi`.
- **SSH from a new network:** port 22 only accepts YOUR_IP/32. To add your current IP:
  ```bash
  aws ec2 authorize-security-group-ingress --region us-east-1 --group-id sg-076f84021708f5a7e \
    --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$(curl -4 -s ifconfig.me)/32,Description=SSH}]" \
    --tag-specifications 'ResourceType=security-group-rule,Tags=[{Key=Name,Value=misogi-hackathon},{Key=Project,Value=misogi-hackathon}]'
  ```

## How it was created

Run once from the operator's Mac with the AWS CLI (region us-east-1). They're recorded here so
the setup can be reproduced, not to be re-run as is.

```bash
TAGS='{Key=Name,Value=misogi-hackathon},{Key=Project,Value=misogi-hackathon}'

# Key pair; the private key never leaves the Mac
(umask 077; aws ec2 create-key-pair --key-name misogi-hackathon --key-type ed25519 --key-format pem \
  --tag-specifications "ResourceType=key-pair,Tags=[$TAGS]" \
  --query KeyMaterial --output text > ~/.ssh/misogi-hackathon.pem)

# Security group in the default VPC
aws ec2 create-security-group --group-name misogi-hackathon-sg --vpc-id vpc-0ff3e4f80158d788e \
  --description "Misogi hackathon web server: SSH from operator, HTTP/HTTPS public" \
  --tag-specifications "ResourceType=security-group,Tags=[$TAGS]"
aws ec2 authorize-security-group-ingress --group-id sg-076f84021708f5a7e \
  --tag-specifications "ResourceType=security-group-rule,Tags=[$TAGS]" --ip-permissions '[
    {"IpProtocol":"tcp","FromPort":22,"ToPort":22,"IpRanges":[{"CidrIp":"YOUR_IP/32"}]},
    {"IpProtocol":"tcp","FromPort":80,"ToPort":80,"IpRanges":[{"CidrIp":"0.0.0.0/0"}],"Ipv6Ranges":[{"CidrIpv6":"::/0"}]},
    {"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0"}],"Ipv6Ranges":[{"CidrIpv6":"::/0"}]}]'

# Instance
aws ec2 run-instances --count 1 --instance-type t4g.medium \
  --image-id resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id \
  --key-name misogi-hackathon --security-group-ids sg-076f84021708f5a7e \
  --subnet-id subnet-0216e83186e93ed8e --associate-public-ip-address \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
  --metadata-options 'HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1' \
  --tag-specifications "ResourceType=instance,Tags=[$TAGS]" "ResourceType=volume,Tags=[$TAGS]" \
    "ResourceType=network-interface,Tags=[$TAGS]"

# Elastic IP: failed with AddressLimitExceeded (see "No Elastic IP yet")
```

Before the first SSH login, the host key fingerprint was checked against the one cloud-init
printed to the console (`aws ec2 get-console-output --instance-id i-0fb6b64d187220ae7 --latest`):
`SHA256:xJSvH/rp1mUnYu/NntCMHnvGATVZJuPLl47+mQcNhOQ` (ED25519).

## Tearing it all down

**Not run.** These commands delete everything tagged `Project=misogi-hackathon`. Run them
one block at a time and read what each lookup prints before you delete anything.

```bash
export AWS_REGION=us-east-1
TAG='Name=tag:Project,Values=misogi-hackathon'

# 1. Instance (its root volume and network interface go with it)
IDS=$(aws ec2 describe-instances --filters "$TAG" \
  "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)
echo "instances: $IDS"   # expect i-0fb6b64d187220ae7
[ -n "$IDS" ] && aws ec2 terminate-instances --instance-ids $IDS && aws ec2 wait instance-terminated --instance-ids $IDS

# 2. Elastic IPs, if one was added later
for a in $(aws ec2 describe-addresses --filters "$TAG" --query 'Addresses[].AllocationId' --output text); do
  assoc=$(aws ec2 describe-addresses --allocation-ids "$a" --query 'Addresses[0].AssociationId' --output text)
  [ "$assoc" != None ] && aws ec2 disassociate-address --association-id "$assoc"
  aws ec2 release-address --allocation-id "$a"
done

# 3. Security group (only after the instance is terminated)
for g in $(aws ec2 describe-security-groups --filters "$TAG" --query 'SecurityGroups[].GroupId' --output text); do
  echo "security group: $g"   # expect sg-076f84021708f5a7e
  aws ec2 delete-security-group --group-id "$g"
done

# 4. Key pair
for k in $(aws ec2 describe-key-pairs --filters "$TAG" --query 'KeyPairs[].KeyPairId' --output text); do
  echo "key pair: $k"   # expect key-0e01c3892c100ab26
  aws ec2 delete-key-pair --key-pair-id "$k"
done
rm -f ~/.ssh/misogi-hackathon.pem
ssh-keygen -R 35.171.183.237

# 5. Check that nothing tagged is left (terminated instances stay listed for about an hour)
aws ec2 describe-volumes --filters "$TAG" --query 'Volumes[].VolumeId'
aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=misogi-hackathon \
  --query 'ResourceTagMappingList[].ResourceARN'
```
