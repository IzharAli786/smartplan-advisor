-- 0021_referral_opportunity_dedupe.sql
-- Backstop for the POST /api/smartplan-transactions/activation dedupe race:
-- SmartPlan fires the activation push from BOTH checkout.session.completed and
-- customer.subscription.updated, which Stripe delivers near-simultaneously, so
-- two concurrent requests can both pass the SELECT-then-INSERT check. This
-- partial unique index makes the second insert conflict (the route uses
-- ON CONFLICT DO NOTHING + re-select). Partial on source = 'referral' so
-- manually-entered duplicate company names are unaffected.
--
-- Runs after 0020 committed the 'referral' enum value (each migration file is
-- its own transaction), so using the value here is safe.
CREATE UNIQUE INDEX IF NOT EXISTS opportunities_referral_dedupe_idx
  ON opportunities (advisor_id, company_name_normalized)
  WHERE source = 'referral';
