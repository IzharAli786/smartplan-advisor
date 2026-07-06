-- Quotes / proposals with e-signature (advisor "interested → won" close flow).
CREATE TYPE quote_status AS ENUM ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired');
CREATE SEQUENCE quote_number_seq START 1001;

-- Optional default price per product (used to pre-fill quote line items).
ALTER TABLE products ADD COLUMN default_price numeric(12,2);

CREATE TABLE quotes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  advisor_id     uuid NOT NULL REFERENCES users(id),
  quote_number   text NOT NULL,
  title          text NOT NULL,
  contact_name   text,
  contact_email  text,
  status         quote_status NOT NULL DEFAULT 'draft',
  currency       text NOT NULL DEFAULT 'USD',
  subtotal       numeric(12,2) NOT NULL DEFAULT 0,
  discount       numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate       numeric(5,2)  NOT NULL DEFAULT 0,
  tax_amount     numeric(12,2) NOT NULL DEFAULT 0,
  total          numeric(12,2) NOT NULL DEFAULT 0,
  notes          text,                       -- terms / cover message
  valid_until    date,
  public_token   text UNIQUE,                -- unguessable token for the customer link
  sent_at        timestamptz,
  viewed_at      timestamptz,
  signed_at      timestamptz,
  declined_at    timestamptz,
  signer_name    text,
  signer_ip      text,
  signature      text,                        -- typed-name e-signature
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotes_advisor_idx ON quotes (advisor_id);
CREATE INDEX quotes_opp_idx ON quotes (opportunity_id);
CREATE INDEX quotes_token_idx ON quotes (public_token);

CREATE TABLE quote_line_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product     text,
  description text,
  quantity    numeric(12,2) NOT NULL DEFAULT 1,
  unit_price  numeric(12,2) NOT NULL DEFAULT 0,
  amount      numeric(12,2) NOT NULL DEFAULT 0,
  sort_order  integer NOT NULL DEFAULT 0
);
CREATE INDEX quote_line_items_quote_idx ON quote_line_items (quote_id);
