# SmartPlan Advisor CRM — v1 Build Plan

**Scope:** v1 (MVP) only, per the build spec §0 phase table. Greenfield (no SmartPlan codebase to match; neutral theme placeholder, swappable later). Single deploy, one-dev maintainable.

**Out of this plan (deferred, but schema-reserved now):** custom-fields *engine*, Apollo enrichment & lead-gen, voice capture, web push/offline queue (v1.1); rev-share tier engine (v2).

---

## 1. Architecture & stack (greenfield defaults from §1)

**Monorepo, single deployable unit** — pnpm workspaces, one repo, one deploy to `crm.smartplan.software`.

```
smart-crm/
├─ apps/
│  ├─ web/         # React + Vite PWA (vite-plugin-pwa), mobile-first
│  └─ api/         # Node + Fastify REST API
├─ packages/
│  └─ shared/      # TS types + Zod schemas shared by web & api
│                  #   ← the OpportunityDraft contract lives here (§6)
├─ db/             # Drizzle schema + SQL migrations + seed scripts
└─ docs/
```

| Concern | Choice | Why |
|---|---|---|
| Frontend | React + Vite, `vite-plugin-pwa` | Spec §1/§13. Mobile-first. |
| Backend | Node + Fastify (TS) | Lighter than Express, schema-validated routes. |
| DB | PostgreSQL + `pg_trgm` | Fuzzy dup matching (§5.1); JSONB for custom fields. |
| ORM/migrations | Drizzle ORM | TS-native types, but lets us write raw SQL for `pg_trgm` GIN indexes and JSONB. |
| Validation | Zod (shared pkg) | One schema source for client + server + the capture contract. |
| Auth | httpOnly signed-cookie session, server-side session store | Standalone (§3.1). Simple revocation, small user set. JWT is a fine alt; cookie session is less footgun. |
| File storage | S3-compatible (R2 or S3) + signed URLs | §7, §11.5. Never app-server disk. |
| Email (invites/reset) | Transactional provider (Resend/SES) behind one `mailer` interface | Invite + forgot-password (§3.1). |

**Key cross-cutting decision — role-based serialization.** Build a server-side response serializer keyed on `currentUser.role` (§11.1). Commission fields (`current_commission_rate`, `commission_rate_snapshot`, `commission_amount`) are *stripped before the JSON ever leaves the server* for advisor requests — not hidden in the UI. This is a P0 risk; bake it into the response layer, not into each handler.

---

## 2. The capture contract (do this early — it gates everything downstream)

Per §6, the typed form writes a structured `OpportunityDraft`. Voice (v1.1) and Apollo enrichment (v1.1) must emit the *same object*. Define it once in `packages/shared` as a Zod schema in v1, even though only the typed path uses it now:

```
OpportunityDraft = {
  contractor_company_name, contact_name, contact_email, contact_cell,
  num_technicians, product, opportunity_value, state, notes,
  custom_fields: {}   // reserved; empty in v1
  source: 'typed'     // 'voice' | 'enriched' | 'lead' added in v1.1
}
```

Capture interface: `captureViaTyped() → OpportunityDraft`. v1.1 adds `captureViaVoice()` / `captureViaApollo()` behind the same return type — additive, no rewrite. **This single decision is what keeps v1.1 from being a migration.**

---

## 3. Data layer (build first — §5)

All tables from §5 are created in v1, even those only populated later, so v1.1/v2 are additive (no runtime `ALTER TABLE`, no migration scare):

- **v1-active:** `users`, `opportunities`, `key_personnel` (manual add only in v1), `collateral`, `claim_requests`, `notifications`, `transactions`.
- **Reserved/created-now, populated-later:** `leads`, `field_definitions`, `apollo_usage`; `opportunities.custom_fields` + `leads.custom_fields` JSONB; Apollo columns on `opportunities`.

**Migration order:** `users` → option-list/settings tables → `opportunities` (+ `pg_trgm` GIN index on `company_name_normalized`) → `key_personnel` → `claim_requests` → `notifications` → `transactions` → `collateral` → reserved tables.

**Normalization helpers (shared pkg, used at write time):**
- `company_name_normalized` — lowercase, strip punctuation + `inc/llc/hvac` tokens.
- `contact_cell` — store E.164-normalized alongside raw, for matching.

**`won` conversion trigger** tied to a **stage flag** on the status-stage settings row, *not* the literal name "won" (§5.2) — so Tom renaming it doesn't break conversions.

**Seed script (§3.1, §3.3a):**
- First Super Admin = Tom, seeded by email, then sent the standard set-password invite. **⚠ OPEN: confirm Tom's login email before deploy** — on record `tomw@smarthvac.solutions`.
- Product list: Smart Plan Survey, Propose, Quote, Perform; Equipment Only Survey, Equipment Only Perform.
- Status stages: new → contacted → demo_scheduled → proposal → won → lost (won flagged as conversion).

---

## 4. Build sequence (gated — do not reorder)

Each milestone is independently demoable.

**M0 — Foundations.** Monorepo, Vite PWA shell + Fastify boot, DB connection, Drizzle migrations runner, shared Zod pkg, theme.css with CSS-variable tokens (neutral placeholder), CI/lint/format. Deploy skeleton to the box.

**M1 — Auth + RBAC + user management (§3, §11).**
- One login screen; role drives dashboard + API scope.
- Invite-based onboarding (email link → set password); forgot-password.
- httpOnly session, logout, expiry.
- Seed Tom (super admin).
- User-management screen: list all; **create = Super Admin only** (403 for managers, enforced server-side); Super Admin edits anyone; Manager edits/deactivates **advisors only**; deactivate-don't-delete.
- Server-side role guards on every endpoint + role-based serializer (commission stripping) in place from here on.

**M2 — Settings / option lists (§3.3a).** DB-backed editable lists: status stages (+ conversion flag), products, lead stages. Rename/reorder must not orphan records (reference by stable id/key, not label).

**M3 — Typed opportunity capture + my pipeline (§6.1, §12).** `captureViaTyped` → `OpportunityDraft` → validated save. Mobile, one-thumb, <30s, <12 taps (acceptance, §4). Pipeline list by status; advisor sees only own (`advisor_id = currentUser.id`, server-side).

**M4 — Duplicate detection + claim requests + notifications (§5.1, §5).**
- On save, match across **all** opportunities: `pg_trgm ≥ ~0.6` on normalized name OR same email OR same E.164 cell.
- Own match → warn/dedupe, no request.
- Other advisor's active account → **block save**, capture entered data into `claim_requests.draft`, notify requester + manager (in-app `notifications`).
- Manager queue: **one-tap approve/reject**. Approve → reassign (ownership transfers to requester per default; prior owner notified), draft becomes their opportunity. Reject → notify, discard/keep as note.
- Conservative threshold (favor missed dupes over false blocks); one-tap unblock.
- Conflict-alert visibility: requester sees owner name + account only — never deal value/commission (§3).

**M5 — Next-step engine + reminders + "Today" home (§8.1, §4, §12).**
- Deterministic config: each stage → next_step + SLA. Engine writes `next_step`/`next_step_due` from (status, follow_up_at, last activity).
- Advisor home = "What do I do today?": due/overdue follow-ups + next steps + conflict alerts, above the fold, sorted by urgency.
- In-app reminders (always reliable; push deferred to v1.1).
- No dead-end empty states (§4).

**M6 — Manager dashboards + converted-customers report + commission snapshot (§10, §12, §14).**
- Reaching `won` (by flag) creates a `transactions` row: copies `commission_rate_snapshot` from advisor's current rate, computes + stores `commission_amount`.
- Roll-up by advisor + by state (pipeline value, count, conversion rate; filter by state).
- Commission view (manager-only, editable current rate).
- **Converted-customers report:** date range → company, advisor, converted date, deal value, rate snapshot, amount + **CSV export**. Fast/clean — the report Tom lives in.
- Pipeline snapshot report.

**M7 — Collateral library (§7).**
- Browse by product → type; search by title; inline PDF preview; video via external YouTube/Vimeo embed (`external_url`, no self-hosted video); file/image in object storage with **signed expiring URLs**.
- Manager upload/edit/reorder/deactivate (any manager role); advisors read-only.
- One-tap from an open opportunity to attach/copy a shareable collateral link (§4).

**M8 — PWA polish (§13).** Manifest (name, icons, theme color), service worker caching app shell for instant/flaky-connection open, install on iOS/Android. (Offline write queue + push = v1.1.)

---

## 5. P0 risk handling (non-negotiable, §0/§11)

1. **Commission never reaches an advisor browser** — role-based server-side serializer strips fields (M1 onward). Assume advisors read network traffic.
2. **Advisor data scoping** — every advisor query filtered by `advisor_id = currentUser.id` server-side; never trust client-supplied id.
3. **Authorize every endpoint by role**, not just login. Account creation + manager-management = Super-Admin-only (403 otherwise).
4. **Signed expiring URLs** for collateral; no raw storage paths.
5. **Apollo/voice readiness** — capture contract + reserved schema mean v1.1 is additive, not a migration.

---

## 6. v1 acceptance criteria (from §4 — testable, not aspirational)

- Log an opportunity: <30s, one-thumb, <12 taps on a phone.
- Home screen answers "what do I do today?" with no navigation.
- Every list has a next-action empty state.
- Collateral reachable one tap from the opportunity being worked.
- App shell opens instantly from cache; works on flaky connection.
- No commission figure is retrievable by an advisor via any endpoint.

---

## 7. Open items to resolve with Tom before/early in build

- **Tom's login email** for the super-admin seed (record says `tomw@smarthvac.solutions` — confirm).
- Object-storage provider choice (S3 vs Cloudflare R2) + bucket.
- Transactional email provider for invites/reset.
- Theme tokens: ship neutral placeholder now; swap when SmartPlan tokens/logo are available (§2).
- Confirm default on claim approval = ownership **transfers** to requester (spec default; flagged in §5.1).
