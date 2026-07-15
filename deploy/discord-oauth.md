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

> **Terminology:** Discord's UI says "server"; its API says "guild". They are
> the same thing. `DISCORD_GUILD_ID` is your **server** id. Nothing here relates
> to a WoW guild — that name collision is Discord's fault, not ours.

The app requests only:

- **`identify`** — the Discord user id, username and avatar. Exactly what the
  `users` table stores.
- **`guilds.members.read`** — the user's membership **of one named server**.

We use `guilds.members.read` rather than the broader `guilds`, which would hand
us a list of _every_ server the user is in. We only ever need one question
answered — "is this person on our server?" — so we ask Discord exactly that, via
`GET /users/@me/guilds/{DISCORD_GUILD_ID}/member`: a member object if they are,
`404` if they aren't. Nothing about the rest of their Discord life is exposed.

It also returns their **role ids** on that server, which is what lets Discord
roles drive RaidPlans' owner/editor/viewer without a second lookup.

We deliberately **don't** request `email`: nothing in the schema stores one, and
every extra scope is another consent prompt and another thing to leak.

There's nothing to select in the portal — the app requests these at login. (The
portal's _URL Generator_ is only a convenience for hand-testing.) And still **no
bot**: this endpoint answers on the user's own token.

## 5. Your server id → `DISCORD_GUILD_ID`

1. Discord (the app) → **Settings → Advanced → Developer Mode: on**.
2. Right-click your server in the sidebar → **Copy Server ID**.

This is the gate: an account that isn't on this server is refused at login.

### Optional: mapping Discord roles → RaidPlans roles

Because `guilds.members.read` returns role ids, you can promote officers
automatically. Both are optional; without them every member of the server gets
the default role.

```
# Right-click a role → Copy Role ID (Developer Mode must be on).
# DISCORD_OWNER_ROLE_IDS=1234,5678     # → RaidPlans "owner"
# DISCORD_EDITOR_ROLE_IDS=9012         # → RaidPlans "editor"
# DISCORD_DEFAULT_ROLE=viewer          # everyone else on the server
```

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

| Symptom                              | Cause                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `invalid_redirect_uri`               | The redirect URI doesn't match a portal entry exactly (check scheme/port/trailing slash).                       |
| Login loops back to the landing page | Cookie rejected: in production `BASE_URL` must be `https://…` so the `Secure` cookie is accepted.               |
| `invalid_client`                     | Wrong `DISCORD_CLIENT_SECRET`, or it was reset in the portal after you copied it.                               |
| Signed in but "not a member"         | `DISCORD_GUILD_ID` is wrong, or the account isn't on that server (the member lookup 404s).                      |
| Everyone lands as `viewer`           | No role ids mapped — set `DISCORD_OWNER_ROLE_IDS` / `DISCORD_EDITOR_ROLE_IDS`, or raise `DISCORD_DEFAULT_ROLE`. |
