# Populating the WoW icon catalog

How to fill and refresh the searchable WoW icon library the palette's **WoW**
tab reads from (plan §11.1 / §4.9), and which values land in
`/etc/raidplans/env`. The catalog starts **empty** — nothing appears under the
WoW tab until you run a sync.

**You do not need a game client.** The sync reads which icons exist from a public
text file (the community listfile) and pulls the images from a source you pick;
neither needs WoW installed.

## 1. How it works (the 30-second version)

One job, run on demand or by a weekly timer, does this:

```
detect current WoW build (wago.tools)
  └─ unchanged since last good run, and not forced?  → stop (no-op)
fetch the listfile → keep only interface/icons/*.blp   → the "index"
diff the index against the catalog
  └─ for each NEW icon: fetch image → WebP @56 + @112 (sharp) → store → upsert row
mark icons that vanished from the index as deprecated (kept, never deleted)
record the run in icon_sync_runs
```

Two things are worth knowing up front:

- **The index and the image are separate sources.** _Which_ icons exist always
  comes from the listfile; the image _bytes_ come from the source you choose in
  §2. That's what lets you swap image sources later without touching plan data.
- **Plans store a stable icon id, never a URL** (e.g. `spell_fire_fireball02`).
  Stored files are content-hashed and immutable, and removed icons are retained
  and flagged — so re-syncing, or an icon leaving the game, never breaks an
  existing plan.

## 2. Choose an image source — `ICON_SYNC_SOURCE`

This is the one real decision. The index is the same either way; this only
chooses where the **pictures** come from.

| Value                  | What it is                                                                                    | Needs                            | Use it when                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| **`pack`** _(default)_ | Reads `<ICON_DIR>/pack/<name>.<ext>` files you supply (`png`/`jpg`/`jpeg`/`webp`).            | No network. You provide the art. | You have a curated pack, or want a fully reproducible, no-third-party setup. |
| **`wowhead`**          | Fetches `wow.zamimg.com/images/wow/icons/large/<name>.jpg` and **caches it into your store**. | Outbound HTTPS.                  | You want the full library with zero manual art wrangling.                    |

> **Not yet implemented** (the code is built to accept them as drop-in adapters —
> see §11.1): **Battle.net API + Media** (the cleanest licensing path, keyed by
> entity), and **TACT/CASC** extraction from Blizzard's CDN (the fully-automatic,
> authoritative-per-patch upgrade). `ICON_SYNC_SOURCE` currently accepts `pack`
> and `wowhead` only.

### ⚠️ Licensing (read before choosing `wowhead`)

WoW icons are **Blizzard's IP**. `wowhead` caches a third party's images, which
is community-standard datamining but still redistributes Blizzard's assets. If
you use it: keep the tool **private / guild-gated**, let the sync **cache into
your own store** (it never hotlinks at runtime), and **don't publicly
redistribute the icon pack**. The official Battle.net API is the cleanest path
where it covers what you need. `pack` sidesteps all of this — you decide what art
ships.

## 3. Config — the env vars

Add these to `/etc/raidplans/env` in production (`chmod 600`), or
`apps/api/.env` for local development. All three are optional and have working
defaults.

| Env var               | Default        | What it does                                                                                                               |
| --------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ICON_DIR`            | `./data/icons` | Where synced WebP icons are written and served from. Content-hashed, immutable. In production: `/var/lib/raidplans/icons`. |
| `ICON_SYNC_SOURCE`    | `pack`         | The image source from §2 — `pack` or `wowhead`.                                                                            |
| `ICON_ADMIN_USER_IDS` | _(empty)_      | Comma-separated Discord ids allowed to trigger a sync **over HTTP**. Empty = nobody over HTTP (the timer/CLI still work).  |

There are no env knobs for the listfile URL or the build-detection endpoint —
those are built in (`github.com/wowdev/wow-listfile` and `wago.tools`) and only
matter to the sync job, not to a running server.

```
# Example production block for /etc/raidplans/env
ICON_DIR=/var/lib/raidplans/icons
ICON_SYNC_SOURCE=wowhead
# Your own Discord id, so you can trigger a sync from the browser/curl:
ICON_ADMIN_USER_IDS=123456789012345678
```

## 4. If you chose `pack`: lay out the files

Drop image files named exactly after the icon (its listfile name) into
`<ICON_DIR>/pack`:

```
/var/lib/raidplans/icons/pack/
  spell_fire_fireball02.png
  inv_sword_04.jpg
  ability_rogue_ambush.webp
  ...
```

Accepted extensions, in preference order: `png`, `jpg`, `jpeg`, `webp`. The sync
looks up each index name in this directory; any name with no matching file is
simply **skipped** (not an error), so you can ship a partial pack and grow it.
The files are converted to WebP at 56 and 112 px for you — source size and format
don't matter beyond being a real image.

## 5. Run the first sync

The catalog only fills when a sync runs. Pick whichever trigger fits — they all
do the same job.

### a. Command line (best for the first run and for local dev)

Local development:

```bash
pnpm --filter @raidplan/api icons:sync
# force a full re-fetch, or override the source for one run:
pnpm --filter @raidplan/api icons:sync -- --force
pnpm --filter @raidplan/api icons:sync -- --source=wowhead
```

Production (uses the built bundle and `/etc/raidplans/env`):

```bash
sudo -u raidplans NODE_ENV=production \
  node /srv/raidplans/apps/api/dist/jobs/syncIconsCli.js
# with flags:
sudo -u raidplans NODE_ENV=production \
  node /srv/raidplans/apps/api/dist/jobs/syncIconsCli.js --force --source=wowhead
```

It logs `[icon-sync]` progress and exits 0 on success, 1 on failure. A first full
`wowhead` pull fetches tens of thousands of icons and can take minutes; `pack`
runs are as fast as your disk.

### b. systemd oneshot (production, no shell math)

If you installed the units (`deploy/README.md` §5):

```bash
sudo systemctl start raidplans-icon-sync.service
journalctl -u raidplans-icon-sync -f          # watch progress + the summary
```

### c. HTTP, as an allowlisted admin

Requires your Discord id in `ICON_ADMIN_USER_IDS` and an authenticated session
cookie (sign in first, then reuse the browser's cookie):

```bash
# Returns 202 { "runId": "..." }
curl -X POST https://raidplans.mamzer.dev/api/admin/icons/sync \
  -H 'content-type: application/json' \
  --cookie 'better-auth.session_token=<your session cookie>' \
  -d '{ "force": false }'          # optional: { "force": true, "source": "wowhead" }

# Poll the run:
curl --cookie '...' https://raidplans.mamzer.dev/api/admin/icons/sync/<runId>
```

Anonymous callers get `401`; a signed-in non-admin gets `403`.

## 6. Keep it current — the weekly timer

`raidplans-icon-sync.timer` runs the oneshot job weekly (Mondays, ~04:07, with a
catch-up if the box was off). Enable it once:

```bash
sudo systemctl enable --now raidplans-icon-sync.timer
systemctl list-timers raidplans-icon-sync.timer     # confirm the next run
```

Refreshes are cheap: the job **no-ops when the WoW build is unchanged**, and when
it has changed the diff is incremental — only the handful of icons a patch adds
or changes get fetched. Use `--force` only to re-pull everything, e.g. after
switching `ICON_SYNC_SOURCE`.

## 7. All the knobs, in one place

**Sync options** (CLI flag / HTTP body field):

| Option                  | CLI                | HTTP body              | Effect                                                                   |
| ----------------------- | ------------------ | ---------------------- | ------------------------------------------------------------------------ |
| Force full re-fetch     | `--force`          | `{"force":true}`       | Ignore the "build unchanged" short-circuit; re-check every icon's bytes. |
| Override source for run | `--source=wowhead` | `{"source":"wowhead"}` | Use this source instead of `ICON_SYNC_SOURCE` for this run only.         |

**Endpoints** (served by the API; Caddy proxies `/api/*` and `/icons/*`):

| Route                                     | Auth            | Purpose                                                           |
| ----------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `POST /api/admin/icons/sync`              | admin allowlist | Start a sync → `202 { runId }`.                                   |
| `GET /api/admin/icons/sync/:id`           | admin allowlist | Run status: `added` / `updated` / `removed` / `status` / `error`. |
| `GET /api/icons?query=&category=&cursor=` | signed-in       | The palette's paginated search feed (60/page).                    |
| `GET /api/icons/resolve?ids=a,b`          | open            | Stable ids → current URLs (includes deprecated, so plans render). |
| `GET /icons/<hash>_<size>.webp`           | open            | Serve a stored icon (immutable, `nosniff`).                       |

**Search categories** (the `category=` filter values, derived automatically from
each icon's name — no manual tagging):

```
spell  ability  item  class  spec  achievement  trade  ui  misc
```

**Sizes stored per icon:** 56 px (palette tiles + canvas tokens) and 112 px.

## Checks

- **Run summary** — the CLI's last line and the `icon_sync_runs` row both report
  `+added ~changed -deprecated (build …)`. `status: "ok"` means it finished.
- **The feed returns icons** (needs a signed-in session):
  `curl --cookie '…' 'https://raidplans.mamzer.dev/api/icons?query=fireball'`
  → a JSON page with `items[]`. An empty `items` on a fresh catalog means the
  sync hasn't populated it yet (or, for `pack`, no matching files were found).
- **An image serves** — take a `url` from that feed and open it; it must return
  `image/webp`, not `text/html`. A `200 text/html` means `/icons/*` isn't routed
  to the API (check the Vite proxy in dev / the Caddyfile in prod).
- **The palette shows them** — in the editor, the **WoW** tab lists results and
  filters as you type. "Sign in to browse WoW icons" there means you're not
  authenticated; "Couldn't load icons" means the catalog is empty or unreachable.

## Troubleshooting

| Symptom                                                  | Cause                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync finishes with `+0 added`                            | Build unchanged since the last good run (expected — pass `--force`), or `pack` source with no matching files in `<ICON_DIR>/pack`.                        |
| `pack` run adds nothing at all                           | Files aren't named after the listfile icon name, or the extension isn't `png`/`jpg`/`jpeg`/`webp`, or they're in the wrong directory (`<ICON_DIR>/pack`). |
| `POST /api/admin/icons/sync` → `403`                     | Your Discord id isn't in `ICON_ADMIN_USER_IDS` (empty allowlist admits no one over HTTP — use the CLI/timer instead).                                     |
| `POST …/sync` → `401`                                    | No session — sign in first and send the session cookie.                                                                                                   |
| WoW tab says "Couldn't load icons"                       | The catalog is empty (run a sync) or `/api/icons` is unreachable.                                                                                         |
| Icons 404 or come back as HTML                           | `/icons/*` not proxied to the API — add it to `apps/web/vite.config.ts` (dev) and `deploy/caddy/Caddyfile` (prod).                                        |
| A synced token is blank on the canvas after a DB restore | `ICON_DIR` wasn't restored alongside the DB — run a sync to regenerate, or back the directory up too.                                                     |
| `wowhead` run fails on many icons                        | Rate-limiting or transient network errors; per-icon failures are skipped and the run still completes — re-run to fill gaps.                               |
