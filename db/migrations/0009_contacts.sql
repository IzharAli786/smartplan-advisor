-- Address Book: an advisor's contacts (customers, leads, partners, …).
-- Advisors see their own; managers see everyone's.
CREATE TYPE contact_type AS ENUM ('customer', 'lead', 'partner', 'other');

CREATE TABLE contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       contact_type NOT NULL DEFAULT 'lead',
  name       text NOT NULL,
  company    text,
  title      text,
  email      text,
  phone      text,
  phone2     text,
  address    text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_owner_idx ON contacts (owner_id);
CREATE INDEX contacts_name_idx ON contacts (lower(name));
