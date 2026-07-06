-- 1) Multi-product opportunities: each line is a product + a technician count.
--    Deal value = Σ(unit_price × technicians), where unit_price snapshots the product price.
CREATE TABLE opportunity_products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  product        text NOT NULL,
  technicians    integer NOT NULL DEFAULT 1,
  unit_price     numeric(12,2) NOT NULL DEFAULT 0,
  amount         numeric(12,2) NOT NULL DEFAULT 0,
  sort_order     integer NOT NULL DEFAULT 0
);
CREATE INDEX opportunity_products_opp_idx ON opportunity_products (opportunity_id);

-- 2) Next review date + notes, on both opportunities and address-book contacts.
ALTER TABLE opportunities ADD COLUMN next_review_at timestamptz;
ALTER TABLE opportunities ADD COLUMN review_notes  text;
ALTER TABLE contacts      ADD COLUMN next_review_at timestamptz;
ALTER TABLE contacts      ADD COLUMN review_notes  text;

-- 3) Communications log: every quote / email sent (e.g. via Resend), kept by date & time.
CREATE TYPE communication_kind AS ENUM ('quote', 'email', 'invite', 'reset', 'other');
CREATE TABLE communications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id      uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  advisor_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  to_email            text NOT NULL,
  subject             text NOT NULL,
  kind                communication_kind NOT NULL DEFAULT 'email',
  provider            text NOT NULL DEFAULT 'dev',
  provider_message_id text,
  status              text NOT NULL DEFAULT 'sent',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX communications_email_idx ON communications (lower(to_email), created_at DESC);
CREATE INDEX communications_opp_idx ON communications (opportunity_id);
CREATE INDEX communications_advisor_idx ON communications (advisor_id);
