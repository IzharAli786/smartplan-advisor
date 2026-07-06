-- ─────────────────────────────────────────────────────────────
-- Multi-tenancy: every business (organization) gets an isolated workspace.
-- Existing data is assigned to a default organization so nothing is lost.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Smart HVAC Solutions');

-- Add org_id, backfill to the default org, then enforce NOT NULL.
-- (Child tables — line items, opp products/journey, activities, key personnel — stay
--  scoped through their org-owned parent, so they don't need their own org_id.)
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'users','opportunities','contacts','quotes','claim_requests','collateral',
    'status_stages','products','journey_stages','email_templates',
    'transactions','communications','commission_rates','notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN org_id uuid REFERENCES organizations(id) ON DELETE CASCADE', t);
    EXECUTE format('UPDATE %I SET org_id = %L', t, '00000000-0000-0000-0000-000000000001');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX %I ON %I (org_id)', t || '_org_idx', t);
  END LOOP;
END $$;

-- Status-stage keys must be unique PER ORG, not globally. The opportunities.status FK
-- referenced the global unique key — drop it (status is validated per-org in the app).
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_status_fkey;
ALTER TABLE status_stages DROP CONSTRAINT IF EXISTS status_stages_key_unique;
ALTER TABLE status_stages DROP CONSTRAINT IF EXISTS status_stages_key_key;
CREATE UNIQUE INDEX status_stages_org_key_idx ON status_stages (org_id, key);
