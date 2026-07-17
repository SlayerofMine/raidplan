# RaidPlans

Self-hosted web app for creating and sharing animated World of Warcraft
raid/arena plans — drag predefined icons onto a map, arrange them, and animate
them PowerPoint-style across steps. Deployed at **https://raidplans.mamzer.dev**.

See [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) for the full design and
phase plan, [`deploy/README.md`](./deploy/README.md) for the deploy runbook, and
[`docs/BUILD_LOG.md`](./docs/BUILD_LOG.md) for the build log & decision record
(per-phase decisions and the traps hit along the way).

## Monorepo layout

```
apps/web        React + Vite SPA (editor & viewer)
apps/api        Hono HTTP server (tRPC + public routes)
packages/shared Plan zod schema, enums, pure state-resolution helpers
deploy/         systemd unit, Caddyfile, env + runbook (Oracle Linux / ARM)
```

## Dependency notes

- **zod 4 across the workspace.** `shared`, `api` and `web` all resolve one zod
  major. Keep it that way: the Plan schema in `packages/shared` is the contract
  `web` and `api` compile against, so a split-major would mean two
  incompatible `z.infer` types with identical names — a genuinely confusing
  class of error. This is also what lets `better-auth` track its current
  release (it requires zod 4); no dependency overrides are needed.
- **`better-sqlite3` is native**: build it on the target machine. Never copy
  `node_modules` from an x64 dev box to the aarch64 server (plan §14).

## Requirements

- **Linux or WSL2** (Ubuntu recommended)
- Node 20/22 LTS + `corepack` (pnpm)

## Commands

```bash
pnpm install        # install workspace deps
pnpm dev            # run web + api in parallel (api :4000, web :5173)
pnpm typecheck      # tsc across all packages
pnpm lint           # eslint across the repo
pnpm test           # vitest unit/component suites
pnpm build          # build web (static) + api (dist/server.js)
```

`pnpm dev` starts both servers in parallel, so if the **API** fails the web app
still comes up and every request answers with an empty 500 from the Vite proxy
(which surfaces as a JSON parse error in the console). Check the terminal for
`raidplans-api listening on :4000`. The usual cause is a previous dev server
that didn't exit — `pkill -f "tsx watch"` clears it.

End-to-end tests (Playwright) run separately and need browser binaries:

```bash
pnpm --filter @raidplan/web exec playwright install
pnpm --filter @raidplan/web test:e2e
```
