-- Smart Plan (Stripe) transactions per advisor: fed automatically from Stripe or added
-- manually. Distinct from the commission `transactions` table (opportunity conversions).
CREATE TABLE smartplan_transactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  advisor_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_transaction_id text,
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  amount                numeric(14,2) NOT NULL DEFAULT 0,
  product               text,
  status                text NOT NULL DEFAULT 'active',   -- instance status: active / inactive
  source                text NOT NULL DEFAULT 'manual',   -- stripe / manual
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX smartplan_txn_advisor_idx ON smartplan_transactions (advisor_id, occurred_at DESC);
CREATE INDEX smartplan_txn_org_idx ON smartplan_transactions (org_id);
-- Prevent duplicate Stripe events from creating duplicate rows.
CREATE UNIQUE INDEX smartplan_txn_stripe_idx ON smartplan_transactions (org_id, stripe_transaction_id) WHERE stripe_transaction_id IS NOT NULL;
