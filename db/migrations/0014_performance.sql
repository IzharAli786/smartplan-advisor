-- ── Performance epic: advisor setup, activity sales/non-sales, badges, high-fives ──
CREATE TYPE activity_category AS ENUM ('sales', 'non_sales');

-- Per-advisor sales plan (user-definable). Drives the required $/hour + projection.
CREATE TABLE advisor_sales_setup (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  advisor_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  days_to_sell       integer NOT NULL DEFAULT 250,
  hours_per_day      numeric(6,2) NOT NULL DEFAULT 6,
  annual_objective   numeric(14,2) NOT NULL DEFAULT 0,
  close_rate         numeric(6,2) NOT NULL DEFAULT 0,
  avg_sale_size      numeric(14,2) NOT NULL DEFAULT 0,
  personal_objective numeric(14,2) NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX advisor_sales_setup_advisor_idx ON advisor_sales_setup (advisor_id);

-- Configurable activity types, categorised sales vs non-sales (managed in Settings).
CREATE TABLE activity_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label      text NOT NULL,
  category   activity_category NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_types_org_idx ON activity_types (org_id);

-- Time an advisor logs against an activity (hours). Non-sales hours reduce the projection.
CREATE TABLE activity_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  advisor_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type_id uuid REFERENCES activity_types(id) ON DELETE SET NULL,
  category         activity_category NOT NULL,
  label            text NOT NULL,
  hours            numeric(7,2) NOT NULL DEFAULT 0,
  occurred_on      date NOT NULL DEFAULT current_date,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_entries_advisor_idx ON activity_entries (advisor_id, occurred_on);

-- Ego badge tiers (label + min % of objective attained). Thresholds set by the manager.
CREATE TABLE badge_tiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label       text NOT NULL,
  min_percent numeric(6,2) NOT NULL DEFAULT 0,
  color       text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX badge_tiers_org_idx ON badge_tiers (org_id);

-- High-fives a manager sends to an advisor (animated on receipt).
CREATE TABLE high_fives (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  from_name     text,
  to_advisor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message       text,
  seen          boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX high_fives_to_idx ON high_fives (to_advisor_id, seen);

-- Seed defaults for the existing default organization.
INSERT INTO activity_types (org_id, label, category, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Intel Collection', 'sales', 1),
  ('00000000-0000-0000-0000-000000000001', 'Prospecting', 'sales', 2),
  ('00000000-0000-0000-0000-000000000001', 'Phone Calls', 'sales', 3),
  ('00000000-0000-0000-0000-000000000001', 'Emails', 'sales', 4),
  ('00000000-0000-0000-0000-000000000001', 'Survey', 'non_sales', 5),
  ('00000000-0000-0000-0000-000000000001', 'Estimating', 'non_sales', 6),
  ('00000000-0000-0000-0000-000000000001', 'Proposal Prep', 'non_sales', 7),
  ('00000000-0000-0000-0000-000000000001', 'Company Meetings', 'non_sales', 8),
  ('00000000-0000-0000-0000-000000000001', 'Social Events', 'non_sales', 9);

INSERT INTO badge_tiers (org_id, label, min_percent, color, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Bronze', 25, '#cd7f32', 1),
  ('00000000-0000-0000-0000-000000000001', 'Silver', 50, '#9aa4b2', 2),
  ('00000000-0000-0000-0000-000000000001', 'Gold', 75, '#f5b301', 3),
  ('00000000-0000-0000-0000-000000000001', 'Platinum', 100, '#29a9f2', 4),
  ('00000000-0000-0000-0000-000000000001', 'Diamond', 125, '#8b5cf6', 5);
