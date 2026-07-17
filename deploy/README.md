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

## 6. Backups (Phase 4+)

The DB is one file. Replicate continuously with **litestream** → OCI Object
Storage (S3-compatible), or a nightly `sqlite3 app.db '.backup backup.db'`
copied off-box. Back up `/var/lib/raidplans/uploads` too — uploaded backgrounds
live on disk, and the database only stores their paths, so a DB-only restore
leaves every custom map broken. **Test restore before go-live.**

`/var/lib/raidplans/icons` (synced WoW icons) need not be backed up: a sync
regenerates them from the source. But restoring the DB without them means every
synced-icon token is broken until the next sync runs — trigger one after a
restore, or back the directory up too.

> Phase 0 scope: this repo ships the configs and this runbook. Actual VM
> provisioning happens on the Oracle host and is not exercised by CI.
