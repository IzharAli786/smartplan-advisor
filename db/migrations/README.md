# Database migrations

Plain SQL files, numbered, applied **in filename order** by the runner
(`db/src/migrate.ts`). Each database records what it has run in its own
`_migrations` table.

Same process as the SmartPlan repo (`script/migrate.ts` + `migrations/README.md`)
— keep the two in step. The one deliberate difference is the tracking table
name: it is `_migrations` here (not `schema_migrations`), because both boxes
already carry rows in it from the original minimal runner.

## Commands

| Command                     | What it does |
|-----------------------------|--------------|
| `pnpm db:migrate`           | Apply every migration not yet recorded, each in its own transaction. |
| `pnpm db:migrate:status`    | Read-only: recorded vs unrecorded files. |
| `pnpm db:migrate:doctor`    | Read-only: verify the live schema has the marker objects recent migrations create. |
| `pnpm db:migrate:baseline`  | One-time: record all current files as applied **without running them** (for a DB whose schema was built before the runner existed). |

Run any of them on a box without SSH via the **DB Migrate — Status / Doctor /
Baseline** GitHub Action.

Deploys run the migration **before** the app bundle is swapped and PM2 reloads
(via `deploy/db-deploy.ps1`), so a failed migration leaves the old version
running and the workflow red.

## Rules

1. **Never edit a migration that has been applied anywhere.** Add a new file.
   (The runner stores checksums and warns on drift. The 24 files that predate
   checksum tracking have `checksum IS NULL` and are exempt.)
2. **Additive + idempotent** where possible: `ADD COLUMN IF NOT EXISTS`,
   nullable first → backfill → `SET NOT NULL`.
3. **Destructive statements** (`DROP TABLE/COLUMN`, `TRUNCATE`) are refused by
   the runner unless explicitly allowed (`--allow-destructive`, or the
   `allow_destructive` input on the prod deploy). Deliberate act only.
   `DELETE FROM` is *not* flagged — data migrations legitimately delete rows.
4. A file using `CONCURRENTLY` must contain **exactly one statement**.
5. `ALTER TYPE ... ADD VALUE` goes in its **own file**, and nothing may use the
   new value until a later file (see 0020 → 0021, 0023 → 0024): each file is one
   transaction, and the value isn't usable inside the transaction that adds it.
6. Ship the migration and the matching `db/src/schema.ts` change in the same commit.
7. When a migration creates something easily checkable, add a marker to
   `DOCTOR_MARKERS` in `db/src/migrate.ts`.

## Existing box that predates the runner (one-time)

`doctor` → hand-apply anything missing (psql) → `doctor` again → `baseline`
→ re-run the deploy. Until baselined, `up` aborts (exit 3) rather than replay
history — and the deploy fails **before** PM2 reloads.

Both current boxes are already tracked (24 rows in `_migrations`), so this only
applies to a box built by hand or restored from a dump.

## Brand-new environment

Restore a `pg_dump` of an existing environment, then `doctor` → `baseline`.
Replaying from `0001` is only safe on a genuinely empty database.
