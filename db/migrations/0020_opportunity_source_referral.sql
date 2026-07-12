-- 0020_opportunity_source_referral.sql
-- Add 'referral' to the opportunity_source enum. SmartPlan pushes a referral
-- "activation" event (POST /api/smartplan-transactions/activation) when a
-- referred customer activates; the API creates a pipeline opportunity for the
-- referring advisor tagged with source = 'referral'.
--
-- PG12+ allows ADD VALUE inside a transaction as long as the new value is not
-- USED in the same transaction (it isn't here), so this is safe under the
-- transaction-wrapped migration runner.
ALTER TYPE opportunity_source ADD VALUE IF NOT EXISTS 'referral';
