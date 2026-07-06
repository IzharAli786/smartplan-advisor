# SmartPlan Advisor CRM

Internal, PWA-first sales CRM for Smart Advisors selling SmartPlan to commercial HVAC
contractors. Built to the v1 (MVP) scope in [`docs/V1_BUILD_PLAN.md`](docs/V1_BUILD_PLAN.md)
and the product spec.

> **Not** a multi-tenant SaaS. One manager + a roster of advisors. Optimised for
> speed-to-useful and data correctness.

## Stack

- **Monorepo** (pnpm workspaces), single deploy.
- **Web** — React + Vite, installable PWA (`apps/web`). Mobile-first.
- **API** — Node + Fastify REST (`apps/api`).
- **DB** — PostgreSQL + `pg_trgm` (fuzzy dup matching), Drizzle ORM (`db`).
- **Shared** — Zod schemas + the capture contract (`packages/shared`).
- **Auth** — standalone, httpOnly signed-cookie JWT session, role-based.

## Prerequisites

- Node 20+ and pnpm 9+
- PostgreSQL 14+ running and reachable via `DATABASE_URL`

## Setup

```bash
pnpm install
cp .env.example .env          # then edit values
createdb smartcrm             # or: psql -U postgres -c "CREATE DATABASE smartcrm;"
pnpm db:migrate               # applies db/migrations/*.sql (enables pg_trgm)
pnpm db:seed                  # seeds Tom (super admin), products, status stages
```

`pnpm db:seed` prints a one-time **set-password invite link** for Tom (in dev, the
"email" is logged to the console and `storage-dev/outbox.log`). Open it to set a password,
then sign in.

## Run (dev)

```bash
pnpm dev          # runs API (:4000) + web (:5173) together
# or individually:
pnpm api:dev
pnpm web:dev
```

The web dev server proxies `/api` and `/files` to the API, so the session cookie is
same-origin.

## Verify / build

```bash
pnpm typecheck    # all packages
pnpm build        # web PWA bundle + API compile
pnpm db:reset     # DANGER: drop + recreate public schema (dev only)
```

## What's built (v1)

- Login / invite onboarding / forgot-password; three roles (Super Admin / Manager /
  Advisor); user management (creation = Super Admin only, enforced server-side).
- Configurable option lists (status stages with conversion flag, products).
- Typed opportunity capture + pipeline; advisor data scoped server-side.
- Duplicate / territory detection → **block + manager-approved takeover request** with
  in-app notifications.
- Deterministic next-step engine + "Today" home + reminders.
- Manager roll-ups (by advisor / state); converted-customers report + **CSV export**;
  commission-rate **snapshot** at conversion.
- Marketing collateral & video library (object storage + signed URLs; external video).
- PWA: installable, app-shell caching.

### Security invariants (P0)

- **Commission never reaches an advisor** — stripped server-side by role in
  `apps/api/src/lib/serialize.ts`, not hidden in the UI.
- Advisors are scoped to their own data server-side; every endpoint authorizes by role;
  account creation + manager management are Super-Admin-only.
- Collateral served only via signed, expiring URLs.

## Reserved for later (schema already in place)

- v1.1 — custom-fields engine, Apollo.io enrichment + lead-gen, voice capture, web
  push + offline queue.
- v2 — automated rev-share tier engine.

See `docs/V1_BUILD_PLAN.md` §7 for open items to confirm with Tom (e.g. his login email).
```
