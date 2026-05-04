# Soteria FIELD — monorepo

Single repo, multiple apps. Web ships today; iOS + Android ship from
the same codebase via shared business logic in `packages/core`
(coming in Phase 1 — see
[plan](https://github.com/devj1975/lotoviewer/blob/claude/plan-multi-tenancy-zQ9ls/docs/)).

## Layout

```
lotoviewer/
├── apps/
│   └── web/      ← Next.js 16 app (Vercel)
├── packages/     ← shared TS modules (Phase 1+)
└── package.json  ← npm workspaces root
```

## Getting started

```bash
npm install                  # installs both root + workspace deps
npm run dev                  # starts apps/web at localhost:3000
npm test                     # runs the 1078-test vitest suite
npm run build                # production build of apps/web
```

These root-level scripts forward to `apps/web` via `npm --workspace web run …`.

## Per-workspace commands

```bash
npm --workspace web run dev
npm --workspace web run lint
npm --workspace web run test
```

## Deploying

The web app deploys to Vercel from `apps/web`. After the monorepo
migration, set the Vercel project's **Root Directory** to `apps/web`
(Project Settings → General → Root Directory). The `vercel.json`
inside `apps/web` continues to define the cron schedules.
