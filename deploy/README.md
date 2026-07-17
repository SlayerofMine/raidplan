# Deploy runbook — Oracle Linux 10 / ARM (no Docker)

Reproducible, low-ops deploy for **https://raidplans.mamzer.dev**. See
`IMPLEMENTATION_PLAN.md` §14 for the rationale. Everything runs natively: a
**systemd**-managed Node process behind **Caddy** (auto-TLS), with **SQLite**
as a single file on disk.

> The Node native module `better-sqlite3` (Phase 4) is built per-platform.
> Always run `pnpm install`/`pnpm build` **on the aarch64 server** — never copy
> `node_modules` from an x64 dev box.

## 1. One-time host setup

```bash
# Node 20/22 LTS + pnpm
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
sudo corepack enable

# Build tools so better-sqlite3 can compile if no aarch64 prebuilt matches
sudo dnf group install -y "Development Tools"
sudo dnf install -y python3

# Caddy (official RPM repo → aarch64 binary + systemd unit)
sudo dnf install -y 'dnf-command(copr)'
sudo dnf copr enable -y @caddy/caddy
sudo dnf install -y caddy

# Service account + directories
sudo useradd --system --home /srv/raidplans --shell /sbin/nologin raidplans || true
sudo mkdir -p /srv/raidplans /srv/web /var/lib/raidplans /etc/raidplans
sudo chown -R raidplans:raidplans /srv/raidplans /var/lib/raidplans
```

## 2. Networking — two layers (classic Oracle gotcha)

Open TCP **80 and 443** in BOTH places or ACME/TLS fails:

1. **OCI VCN security list / NSG** (Cloud console) — ingress 80 & 443 from `0.0.0.0/0`.
2. **Instance firewalld**:
   ```bash
   sudo firewall-cmd --permanent --add-service=http --add-service=https
   sudo firewall-cmd --reload
   ```

Point `raidplans.mamzer.dev` A/AAAA records at the VM's public IP before starting Caddy.

## 3. SELinux (stays enforcing)

```bash
sudo semanage fcontext -a -t httpd_sys_content_t "/srv/web(/.*)?"
sudo restorecon -R /srv/web
# If the Caddy→API proxy is denied:
sudo setsebool -P httpd_can_network_connect on
# Diagnose denials:
sudo ausearch -m avc -ts recent
```

## 4. App install / update

```bash
cd /srv/raidplans
git pull                 # or clone on first deploy
pnpm install --frozen-lockfile   # rebuilds aarch64 native modules
pnpm build                        # builds web (static) + api (dist/server.js)
sudo rsync -a --delete apps/web/dist/ /srv/web/
sudo restorecon -R /srv/web
sudo systemctl restart raidplans-api
sudo systemctl reload caddy       # only if the Caddyfile changed
```

## 5. Install the service + proxy configs

```bash
sudo cp deploy/systemd/raidplans-api.service /etc/systemd/system/
# WoW icon sync (plan §11.1): a oneshot job + a weekly timer.
sudo cp deploy/systemd/raidplans-icon-sync.service /etc/systemd/system/
sudo cp deploy/systemd/raidplans-icon-sync.timer /etc/systemd/system/
# Daily backup (plan §5.6): a oneshot job + a daily timer.
sudo cp deploy/systemd/raidplans-backup.service /etc/systemd/system/
sudo cp deploy/systemd/raidplans-backup.timer /etc/systemd/system/
sudo cp deploy/env.example /etc/raidplans/env   # then edit + chmod 600
sudo chmod 600 /etc/raidplans/env
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile

sudo systemctl daemon-reload
sudo systemctl enable --now raidplans-api
sudo systemctl enable --now caddy
sudo systemctl enable --now raidplans-icon-sync.timer   # weekly refresh
```

### WoW icon catalog (plan §11.1)

Full walkthrough — source options, the `pack` layout, every trigger and knob:
**`deploy/populate-icons.md`**. The essentials:

The catalog starts empty. Populate it with a first sync — run the oneshot job
directly rather than waiting for the timer (a first full pull can take minutes):

```bash
sudo systemctl start raidplans-icon-sync.service
journalctl -u raidplans-icon-sync -f            # [icon-sync] progress + summary
```

The weekly timer keeps it current; it no-ops when the WoW build is unchanged, so
it's cheap. To force a full re-fetch (e.g. after switching `ICON_SYNC_SOURCE`),
run the CLI with `--force`:

```bash
sudo -u raidplans NODE_ENV=production node \
  /srv/raidplans/apps/api/dist/jobs/syncIconsCli.js --force
```

An admin (a Discord id listed in `ICON_ADMIN_USER_IDS`) can also trigger a sync
from the browser/curl: `POST /api/admin/icons/sync` → `{ runId }`, then poll
`GET /api/admin/icons/sync/:runId`. Icons are served from `ICON_DIR` at
`/icons/*` (Caddy proxies it, same as `/uploads/*`).

Verify:

```bash
curl -fsS http://localhost:4000/healthz          # {"status":"ok",...}
curl -fsS https://raidplans.mamzer.dev/           # served SPA over TLS
journalctl -u raidplans-api -f                    # logs (pino → journald)
```

## 6. Backups — local block storage (plan §5.6)

Backups stay **on the VM's own block volume** (no object storage). A daily timer
runs `deploy/backup.sh`, which takes a WAL-safe SQLite snapshot (`.backup`, not a
plain `cp`) plus a tarball of the uploads directory, and prunes anything past the
retention window.

Needs the sqlite CLI:

```bash
sudo dnf install -y sqlite
```

Enable the daily backup (the units were copied in §5):

```bash
sudo systemctl enable --now raidplans-backup.timer
sudo systemctl start raidplans-backup.service   # take one now
ls -lh /var/lib/raidplans/backups               # app-*.db.gz, uploads-*.tar.gz
```

Tune via `/etc/raidplans/env`: `BACKUP_DIR` (default
`/var/lib/raidplans/backups`) and `BACKUP_RETENTION_DAYS` (default 14). Point
`BACKUP_DIR` at a second block volume if you attach one — still no object store.

**What's backed up, and what isn't.** The DB and `UPLOAD_DIR` are — uploaded
maps are user data the DB only references by path, so a DB-only restore leaves
every custom map broken. `ICON_DIR` (synced WoW icons) is **not**: a sync
regenerates it, so re-run the icon sync after a restore rather than paying to
store tens of thousands of regenerable files.

**Restore:**

```bash
sudo systemctl stop raidplans-api
gunzip -c /var/lib/raidplans/backups/app-YYYYmmdd-HHMMSS.db.gz \
  > /var/lib/raidplans/app.db
# Drop stale WAL/SHM so SQLite reopens the restored file cleanly.
sudo rm -f /var/lib/raidplans/app.db-wal /var/lib/raidplans/app.db-shm
tar -xzf /var/lib/raidplans/backups/uploads-YYYYmmdd-HHMMSS.tar.gz \
  -C /var/lib/raidplans
sudo chown -R raidplans:raidplans /var/lib/raidplans
sudo systemctl start raidplans-api
sudo systemctl start raidplans-icon-sync.service   # rebuild synced icons
```

**Test the restore before go-live** — an untested backup isn't one.

> Want continuous, point-in-time recovery without an object store? Run
> **litestream** with a `file://` replica on the block volume (`db → replica`
> both local). It's a single arm64 binary. Off-box replication (litestream →
> S3-compatible) remains available if you ever change your mind about object
> storage, but nothing here requires it.

> Phase 0 scope: this repo ships the configs, scripts and this runbook. Actual
> VM provisioning happens on the Oracle host and is not exercised by CI.
