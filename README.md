# RaidPlans

Self-hosted web app for creating and sharing animated World of Warcraft
raid/arena plans — drag predefined icons onto a map, arrange them, and animate
them PowerPoint-style across steps. Deployed at **https://raidplans.mamzer.dev**.

See [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) for the full design and
phase plan, and [`deploy/README.md`](./deploy/README.md) for the deploy runbook.

## Monorepo layout

```
apps/web        React + Vite SPA (editor & viewer)
apps/api        Hono HTTP server (tRPC + public routes)
packages/shared Plan zod schema, enums, pure state-resolution helpers
deploy/         systemd unit, Caddyfile, env + runbook (Oracle Linux / ARM)
```

## Requirements

- **Linux or WSL2** (Ubuntu recommended)
- Node 20/22 LTS + `corepack` (pnpm)

## Commands

```bash
pnpm install        # install workspace deps
pnpm dev            # run web + api in parallel
pnpm typecheck      # tsc across all packages
pnpm lint           # eslint across the repo
pnpm test           # vitest unit/component suites
pnpm build          # build web (static) + api (dist/server.js)
```

End-to-end tests (Playwright) run separately and need browser binaries:

```bash
pnpm --filter @raidplan/web exec playwright install
pnpm --filter @raidplan/web test:e2e
```
