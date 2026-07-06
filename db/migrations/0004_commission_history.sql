-- Commission rate history (§10). Each row is a rate effective from a date; the rate that
-- applies to a converted deal is the latest row whose effective_from <= the conversion date.
CREATE TABLE commission_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rate           numeric(5,2) NOT NULL,
  effective_from date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commission_rates_advisor_idx ON commission_rates (advisor_id, effective_from);

-- Backfill: seed each advisor's current rate, effective from their start date (or creation).
INSERT INTO commission_rates (advisor_id, rate, effective_from)
SELECT id, current_commission_rate, COALESCE(start_date, created_at::date)
FROM users
WHERE role = 'advisor' AND current_commission_rate IS NOT NULL;
