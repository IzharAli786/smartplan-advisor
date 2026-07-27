# Deploying advise.smartplan.software (Windows + IIS + PM2)

This mirrors the existing SmartPlan deploy (GitHub Actions → SSH/SCP → PM2, fronted
by IIS + win-acme TLS), adapted for this **pnpm monorepo** and its **decoupled**
architecture:

- **Web** — a static PWA (`apps/web/dist`, built by Vite) that **IIS serves directly**.
- **API** — a Fastify server (`apps/api`) run from TypeScript source by **tsx** under
  **PM2** on `localhost:5052`. IIS reverse-proxies `/api/*` and `/files/*` to it.
- Everything is **same-origin** at `https://advise.smartplan.software`, so the
  httpOnly session cookie and `COOKIE_SECURE=true` just work.

| Thing | Value |
|---|---|
| Box folder | `C:\smartplan-advisor` |
| PM2 process | `smartplan-advisor` |
| API port | `5052` (must match `API_PORT` in `.env` **and** `web.config`) |
| IIS site physical path | `C:\smartplan-advisor\apps\web\dist` |
| DB | your separate DB (fill `DATABASE_URL` on the box) |

The three files that drive it are already in this repo:
`.github/workflows/deploy-advisor.yml`, `ecosystem.config.cjs`,
`apps/web/public/web.config` (Vite copies it into `dist/` on every build), and the
env template `.env.production.example`.

---

## Part A — One-time GitHub setup (on your Mac)

The advisor folder is **not a git repo** yet. From `/Users/mac/Downloads/smartplan-advisor`:

```bash
git init
git add .
git commit -m "SmartPlan Advisor CRM + Windows deploy"
git branch -M main
# Create a PRIVATE repo on GitHub (e.g. deffinity/smartplan-advisor), then:
git remote add origin git@github.com:<you>/smartplan-advisor.git
# Do NOT push yet — add the secrets below first (a push triggers the deploy, and
# with no secrets set the first run just fails red on the SSH step).
```

> `.env` and `node_modules` are git-ignored, so the real OpenAI key in your local
> `.env` is **not** committed. (It's a live key — consider rotating it.)

Add the repo secrets (GitHub → Settings → Secrets and variables → Actions). These
are the **same four** the SmartPlan workflows use, so copy the values from that repo:

- `SSH_HOST` · `SSH_USER` · `SSH_PRIVATE_KEY` · `SSH_PORT`

The web build needs no build-time secrets, so that's all. Now push (this fires the
first deploy — but do the **Part B** server setup first so the box is ready):

```bash
git push -u origin main
```

---

## Part B — One-time server setup (on the Windows box)

### B1. Prerequisites (skip any already present from SmartPlan)

```powershell
node --version          # must be >= 20.6  (needed for `node --import tsx`)
npm  install -g pnpm@9  # or: corepack enable && corepack prepare pnpm@9.12.0 --activate
pm2  --version          # already installed for SmartPlan
```

IIS must have **URL Rewrite** and **Application Request Routing (ARR)** with
server-level **"Enable proxy" = ON** (already true — the dev1 site uses it).

### B2. Create the database

On your DB server, create the database + a user, and note the connection string.
The first migration runs `CREATE EXTENSION` for **both `pg_trgm` and `pgcrypto`**
(the latter powers `gen_random_uuid()`), so the user must be able to create
extensions — be the DB owner/superuser, or have an admin pre-create **both**:

```sql
CREATE DATABASE smartcrm_advisor;
-- CREATE USER advisor WITH PASSWORD '...';  GRANT ALL ON DATABASE smartcrm_advisor TO advisor;
-- as a superuser, once, connected to the app DB (\c smartcrm_advisor):
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### B3. Create the folder + `.env`

```powershell
New-Item -ItemType Directory -Force -Path 'C:\smartplan-advisor'
```

Create `C:\smartplan-advisor\.env` from [`.env.production.example`](../.env.production.example)
and fill in:

- `DATABASE_URL` — your DB from B2
- `AUTH_SECRET` — a long random string:
  `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))`
- keep `API_PORT=5052`, `WEB_ORIGIN=https://advise.smartplan.software`, `COOKIE_SECURE=true`
- `OPENAI_API_KEY` — optional (enables voice capture)

### B4. First deploy (populates the folder)

Run the **Deploy Advisor (Windows)** workflow — GitHub → Actions → select it →
**Run workflow**. (Not by pushing to `main`: that workflow is `workflow_dispatch`
only, and a push deploys *dev*.) It builds, ships, `pnpm install`, backs up the DB,
runs `pnpm db:migrate`, and starts the API via `deploy\pm2-roll.ps1`.

Verify the API is up on localhost (before wiring IIS/DNS):

```powershell
pm2 list                                  # smartplan-advisor should be "online"
curl http://localhost:5052/api/health     # -> {"ok":true,...}
pm2 logs smartplan-advisor --lines 50     # check for startup errors
```

> **Where the logs actually are, in cluster mode.** `ecosystem.config.cjs` does
> **not** set `merge_logs`, so PM2 writes one file per worker —
> `~/.pm2/logs/smartplan-advisor-out-<pm_id>.log`, not `...-out.log`. The
> unsuffixed file is a leftover from fork mode and **nothing writes to it any
> more**; reading it and finding nothing is not evidence that the app is quiet.
> `pm2 logs` tails all of them, so the command above is still correct — this only
> bites when you open a file directly.

### B5. Seed the first Super Admin (once)

```powershell
Set-Location 'C:\smartplan-advisor'
pnpm db:seed
```

This prints a **set-password invite link** for Tom to the **console only** (the seed
uses `console.log`, it does **not** send mail, so nothing lands in `outbox.log`) —
**copy it from that run's output and keep it.** The link points at
`https://advise.smartplan.software/set-password?token=...` and only works once DNS +
TLS are live (next steps). If you lose it, re-running `pnpm db:seed` will **not**
reprint it (it sees the admin already exists) — use the app's forgot-password flow
once the site is live instead.

### B6. DNS (do this before requesting the TLS cert)

Point `advise.smartplan.software` at the box (an **A** record to the same public IP
your other `*.smartplan.software` sites use — check how `dev1.smartplan.software` is
set at your DNS provider and copy it). Then confirm from the box:

```powershell
nslookup advise.smartplan.software       # must resolve to the box's public IP
```

Wait for it to resolve before B8 — win-acme's HTTP-01 validation needs the hostname
pointing at this server or issuance fails.

### B7. Create the IIS site

- **Sites → Add Website**
  - Site name: `smartplan-advisor`
  - Physical path: `C:\smartplan-advisor\apps\web\dist`  *(exists after B4)*
  - Binding: **http**, port 80, **Host name** `advise.smartplan.software`
- The `web.config` is already in that folder (Vite emitted it), so the reverse
  proxy + SPA fallback are live immediately.

Sanity check over HTTP first: browse `http://advise.smartplan.software` — the app
shell should load and `/api/health` should return JSON.

### B8. TLS with win-acme

Run `wacs.exe`, choose the `advise.smartplan.software` site, let it issue + bind the
Let's Encrypt cert (HTTP-01) and set up auto-renewal — exactly as you did for the
other sites. This adds the **https:443** binding.

### B9. Verify end-to-end

```powershell
curl https://advise.smartplan.software/api/health   # {"ok":true,...}
```

Open `https://advise.smartplan.software`, then use Tom's invite link (B5) to set a
password and sign in. Finally persist the PM2 process across reboots:

```powershell
pm2 save
# one-time, if not already configured for the other apps:
# pm2-startup install   (or pm2-installer) so pm2 resurrects on boot
```

> **Backups:** uploaded collateral, org logos, and avatars are stored **in Postgres**
> (the `file_blobs` table), **not** on disk — so they survive redeploys, and your
> **database backup is the only thing that protects them.** Back up the DB, not
> `C:\smartplan-advisor`.

---

## Ongoing deploys

**Production is manual-only.** *Deploy Advisor (Windows)* has no `push:` trigger —
pushing to `main` deploys **dev** (`advisedev.smartplan.software`) and nothing
else. Production goes out when someone decides it is the right time, from the
Actions tab. Each run rebuilds the web bundle, ships the source, `pnpm install`s,
applies any **new** SQL migrations (`db/migrations/*.sql`, forward-only and
idempotent), and rolls PM2 via `deploy\pm2-roll.ps1`. No manual step needed unless
you change IIS/DNS/TLS.

### Cluster mode (prod, since 2026-07-27)

`smartplan-advisor` runs **2 cluster workers**, paired with SmartPlan's
`portal.smartplan.software` which was clustered the same day. `pm2-roll.ps1`
restarts them **one at a time by numeric `pm_id`**, so a sibling serves throughout
and a deploy costs no downtime.

It restarts rather than reloads on purpose: `pm2 reload` renames the retiring
worker's `pm_id` to the string `'_old_<id>'`, PM2 gates its graceful IPC path on
`pm_id` being a *number*, so `shutdown_with_message` is silently ignored and it
falls back to `process.kill(pid, SIGINT)` — an unconditional `TerminateProcess` on
Windows. Both paths look green in the log; only the rolling restart actually drains.

Two things that are load-bearing and easy to undo by accident:

- **`exec_mode`, `instances` and `env:` only apply on `pm2 start`.** A deploy issues
  `pm2 restart`, which reuses PM2's in-memory config — so editing
  `ecosystem.config.cjs` and deploying changes *nothing* about the process shape.
  Applying it needs `pm2 delete` + `pm2 start ecosystem.config.cjs` + `pm2 save`.
- **`pm2 save` after any such change.** PM2 dumps a cluster as one entry *per
  worker*, so `instances` survives a reboot only as the entry count in `dump.pm2`.

Verify a healthy cluster — **both** lines must be present, one per worker:

```powershell
pm2 describe smartplan-advisor            # mode: cluster, 2 instances
pm2 logs smartplan-advisor --lines 40 --nostream
#   [advise:0] smartplan link configured: true
#   [advise:1] smartplan link configured: true
```

Both `configured: true` lines matter more than they look. Each worker snapshots
`SMARTPLAN_INGEST_SECRET` and `SMARTPLAN_APP_URL` into module scope at **its own**
start, so a half-configured pair drops roughly half the commission pushes to
SmartPlan through silent `return`s — with no error, and with `/api/health` still
answering 200 on both workers.

## Troubleshooting

- **502 / 504 from IIS** — the Node API isn't up. `pm2 list`, `pm2 logs smartplan-advisor`.
- **App loads but every API call fails** — port mismatch. `API_PORT` in `.env` must
  equal the `localhost:5052` target in `apps/web/public/web.config`.
- **`pm2` won't start the `.ts` entry** — some pm2 versions mis-detect the interpreter.

  > **Do not reach for the bare `pm2 start node ...` one-liner that used to live
  > here.** Since the 2026-07-27 cutover, prod runs as a 2-worker cluster and gets
  > `wait_ready`, `kill_timeout`, `shutdown_with_message`, `DB_POOL_MAX` and
  > `PM2_APP_NAME` **exclusively from `ecosystem.config.cjs`**. Starting the app by
  > hand silently drops all of them: no graceful drain, an uncapped 10-connection
  > pool, and unlabelled rows in `pg_stat_activity`. The next `pm2 save` then makes
  > that the definition a reboot restores. It looks fine and `pm2 list` says online.

  Start it from the ecosystem file instead — that is the only supported form:

  ```powershell
  Set-Location 'C:\smartplan-advisor'
  pm2 delete smartplan-advisor
  pm2 start ecosystem.config.cjs --only smartplan-advisor
  pm2 save
  ```

  If cluster mode itself is the problem, set `const CLUSTERED = false;` in that file
  and repeat the four commands. That returns the app to a single process while
  **keeping** the drain and the capped pool — it is not "revert the deploy".
- **`permission denied to create extension`** during `db:migrate` — the DB user can't
  `CREATE EXTENSION`. Have a superuser run, in the app DB, **both**
  `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
  then re-run the deploy.
- **Invite/reset links point at localhost** — `WEB_ORIGIN` in the box `.env` is wrong;
  it must be `https://advise.smartplan.software`.
