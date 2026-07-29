-- 0027_rename_won_to_subscribed.sql
-- Product rename: the conversion stage reads "Subscribed" instead of "Won"
-- (deals convert into SmartPlan subscriptions, so "Subscribed" is the truth).
-- Only the display label changes — the stage KEY stays 'won', which is what
-- opportunities.status stores, so no data references move.
-- Guarded on label = 'Won' so an org that deliberately customized its label
-- is untouched. Idempotent. Keep in step: apps/api/src/services/provision.ts
-- and db/src/seed.ts DEFAULT_STAGES (both now say "Subscribed").
UPDATE status_stages SET label = 'Subscribed' WHERE key = 'won' AND label = 'Won';
