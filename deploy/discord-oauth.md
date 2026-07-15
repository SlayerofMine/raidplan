# Discord OAuth setup

What to create in the Discord Developer Portal, and which values land in
`/etc/raidplans/env` (plan §10). **You do not need a bot** — RaidPlans only
signs users in and checks guild membership, both of which the user's own OAuth
token can do.

## 1. Create the application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Name it (e.g. `RaidPlans`). This name is what members see on the consent
   screen, so use something they'll recognise.

## 2. Grab the credentials — `OAuth2` tab

| Portal field                       | Env var                 | Notes                                                                   |
| ---------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| **Client ID**                      | `DISCORD_CLIENT_ID`     | Public; safe to paste anywhere.                                         |
| **Client Secret** → _Reset Secret_ | `DISCORD_CLIENT_SECRET` | **Shown once.** Copy it immediately; if lost, reset and update the env. |

Leave **Requires OAuth2 Code Grant** _off_ — that setting is for bots and will
break the login flow.

## 3. Add the redirect URIs — `OAuth2` → _Redirects_

These must match **byte for byte**: scheme, host, port, path, no trailing
slash. A mismatch is the single most common cause of `invalid_redirect_uri`.

```
http://localhost:4000/api/auth/callback/discord      # local development
https://raidplans.mamzer.dev/api/auth/callback/discord   # production
```

Add both — one entry per environment you sign in from.

Why this path: the API mounts the auth handler under `/api/auth`, and Caddy
already proxies `/api/*` to the Node service (`deploy/caddy/Caddyfile`), so the
production URL resolves without extra config.

## 4. Scopes

The app requests only:

- **`identify`** — the Discord user id, username and avatar. That's exactly what
  the `users` table stores.
- **`guilds`** — the list of guilds the user belongs to, so we can check they're
  in _your_ guild before letting them in.

We deliberately **don't** request `email`: nothing in the schema stores one, and
every extra scope is another thing members must consent to and another thing to
leak. There's no scope to select in the portal — the app requests these at
login; the portal's _URL Generator_ is only a convenience for testing.

## 5. Your guild id → `DISCORD_GUILD_ID`

1. Discord (the app) → **Settings → Advanced → Developer Mode: on**.
2. Right-click your server in the sidebar → **Copy Server ID**.

This gates who may sign in: a Discord account not in this guild is refused.

## 6. Session secret → `SESSION_SECRET`

Signs session cookies. Generate a fresh one — never reuse it between
environments, and never commit it:

```bash
openssl rand -base64 32
```

Rotating it invalidates everyone's sessions (that's the point, if it ever leaks).

## 7. Fill in the env

Local development — `apps/api/.env` (git-ignored):

```
BASE_URL=http://localhost:4000
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_GUILD_ID=...
SESSION_SECRET=...
```

Production — `/etc/raidplans/env`, `chmod 600`, owned by the service user
(see `deploy/env.example` and `deploy/README.md`).

## Checks

- The API refuses to start in production unless `DISCORD_CLIENT_ID`,
  `DISCORD_CLIENT_SECRET` and `SESSION_SECRET` are all set — an API that
  silently treats everyone as anonymous is worse than one that won't boot.
- `GET /healthz` reports `authEnabled`, so you can confirm the service picked
  the config up: `curl -s localhost:4000/healthz`.

## Troubleshooting

| Symptom                              | Cause                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `invalid_redirect_uri`               | The redirect URI doesn't match a portal entry exactly (check scheme/port/trailing slash).         |
| Login loops back to the landing page | Cookie rejected: in production `BASE_URL` must be `https://…` so the `Secure` cookie is accepted. |
| `invalid_client`                     | Wrong `DISCORD_CLIENT_SECRET`, or it was reset in the portal after you copied it.                 |
| Signed in but "not a member"         | `DISCORD_GUILD_ID` is wrong, or the account isn't in that guild.                                  |
