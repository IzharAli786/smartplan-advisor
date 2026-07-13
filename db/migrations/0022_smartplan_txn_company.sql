-- Requirement C: the super admin must see WHICH referred customer subscribed under
-- each advisor, and count DISTINCT subscribers. smartplan_transactions previously
-- carried only advisor + amount + product, with no link to the paying customer.
-- Add the company/customer name (raw + normalized). Nullable: legacy rows predate
-- it, and SmartPlan stamps company_name on every new /ingest push going forward.
ALTER TABLE smartplan_transactions ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE smartplan_transactions ADD COLUMN IF NOT EXISTS company_name_normalized text;

-- Speeds the per-advisor distinct-customer count in the referral reports.
CREATE INDEX IF NOT EXISTS smartplan_transactions_company_idx
  ON smartplan_transactions (advisor_id, company_name_normalized);
