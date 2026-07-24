-- 0024_takeover_rework.sql
-- Takeover requests (§5.1) reworked in three parts:
--   1. opportunities.company_key  — exact, punctuation-insensitive territory key
--   2. transactions.voided_at     — pins commission to whoever actually earned it
--   3. claim_requests             — one pending request per advisor per account


-- ── 1. Exact territory-match key ──────────────────────────────────────────────
-- Duplicate detection used pg_trgm similarity >= 0.6 over company_name_normalized,
-- a key that DELETES noise tokens (inc, llc, hvac, heating, services, the...). That
-- false-blocked "Acme HVAC" against "Acme Plumbing" and stopped an advisor working a
-- genuinely different company until a manager intervened.
--
-- company_key keeps every token and only strips case + punctuation, so:
--   "Acme, Inc." = "acme inc"      → same account, blocks
--   "Acme Inc"  != "Acme LLC"      → different accounts, no block
-- Mirrors normalizeCompanyKey() in packages/shared/src/normalize.ts — keep the two
-- in step. company_name_normalized and its GIN index are UNCHANGED: leads, imports
-- and every SmartPlan/Stripe lookup still depend on the tolerant key.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS company_key text;

-- normalize(text, NFKD) requires PostgreSQL 13+ (verified 18.3 on this deployment;
-- re-check with SELECT current_setting('server_version_num') before a new target).
-- COALESCE mirrors the TS fallback: a name that cleans to "" (non-Latin or
-- punctuation-only) falls back to the raw lowercased name, so distinct companies
-- never collapse onto one empty key.
UPDATE opportunities
   SET company_key = COALESCE(
         NULLIF(btrim(regexp_replace(lower(normalize(contractor_company_name, NFKD)),
                                     '[^a-z0-9]+', ' ', 'g')), ''),
         lower(btrim(contractor_company_name)))
 WHERE company_key IS NULL;

ALTER TABLE opportunities ALTER COLUMN company_key SET NOT NULL;

-- Every territory check is org-scoped then key-equal, so lead with org_id.
CREATE INDEX IF NOT EXISTS opportunities_company_key_idx ON opportunities (org_id, company_key);


-- ── 2. Pin the commission earner ──────────────────────────────────────────────
-- removeConversion() used to HARD DELETE the transaction row and ensureConversion()
-- re-inserted it reading the opportunity's CURRENT owner. After a takeover that let
-- the new owner toggle a deal out of Won and back to silently move the previous
-- advisor's commission — and even without a takeover, one mis-click on the status
-- dropdown permanently destroyed a financial record.
--
-- Voiding instead of deleting makes the money row immutable: a re-Won restores the
-- ORIGINAL advisor, deal value, converted_at and rate snapshot verbatim.
-- Every reader must filter `voided_at IS NULL` — see the reader list in
-- apps/api/src/services/convert.ts.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voided_at timestamptz;

CREATE INDEX IF NOT EXISTS transactions_live_idx
  ON transactions (org_id, converted_at) WHERE voided_at IS NULL;

-- One money row per opportunity, forever — the invariant ensureConversion() relies on
-- for idempotency. Verified no duplicates exist before adding this
-- (SELECT opportunity_id, count(*) FROM transactions GROUP BY 1 HAVING count(*) > 1),
-- so no destructive dedupe is shipped: if this index ever fails to build, investigate
-- the duplicates rather than deleting financial rows.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_opportunity_uniq ON transactions (opportunity_id);


-- ── 3. Claim request context + no duplicate pending requests ──────────────────
-- Which signal actually blocked the save (company name / contact email / contact
-- phone). Persisted at raise time rather than recomputed at read time: recomputing
-- would re-run the matcher against data that has since changed and could disagree
-- with what the advisor was actually told.
ALTER TABLE claim_requests ADD COLUMN IF NOT EXISTS matched_on text;

-- Nothing stopped an advisor re-submitting the same company and piling up identical
-- pending rows in the manager's queue. Collapse existing duplicates (keep the NEWEST
-- — it carries the most recent draft), then enforce it.
DELETE FROM claim_requests a
 USING claim_requests b
 WHERE a.status = 'pending'
   AND b.status = 'pending'
   AND a.org_id = b.org_id
   AND a.requesting_advisor_id = b.requesting_advisor_id
   AND a.matched_opportunity_id = b.matched_opportunity_id
   AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));

CREATE UNIQUE INDEX IF NOT EXISTS claim_requests_pending_uniq
  ON claim_requests (org_id, requesting_advisor_id, matched_opportunity_id)
  WHERE status = 'pending';
