-- SmartPlan Advisor CRM — initial schema (build spec §5).
-- All v1 tables PLUS tables reserved for v1.1/v2 (leads, field_definitions, apollo_usage)
-- so later phases are additive, never a migration (build plan §3).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ── Enums ──────────────────────────────────────────────────
CREATE TYPE user_role          AS ENUM ('super_admin','manager','advisor');
CREATE TYPE token_purpose      AS ENUM ('invite','reset');
CREATE TYPE opportunity_source AS ENUM ('typed','voice','enriched','lead');
CREATE TYPE collateral_type    AS ENUM ('pdf','slides','image','video','link');
CREATE TYPE claim_status       AS ENUM ('pending','approved','rejected');
CREATE TYPE notification_type  AS ENUM ('claim_request','claim_decision','account_reassigned','follow_up','next_step');
CREATE TYPE lead_status        AS ENUM ('new','claimed','converted','dismissed');
CREATE TYPE field_entity       AS ENUM ('opportunity','lead');
CREATE TYPE field_data_type    AS ENUM ('text','long_text','number','currency','date','datetime','boolean','single_select','multi_select','email','phone','url');
CREATE TYPE apollo_action      AS ENUM ('org_enrich','people_enrich','phone_reveal','email_reveal','waterfall');

-- ── users (§5) ─────────────────────────────────────────────
CREATE TABLE users (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role                            user_role NOT NULL,
  full_name                       text NOT NULL,
  email                           text NOT NULL,
  phone                           text,
  password_hash                   text,                 -- null until invite accepted
  session_version                 integer NOT NULL DEFAULT 0, -- bump to revoke sessions
  states_covered                  text[] NOT NULL DEFAULT '{}',
  current_commission_rate         numeric(5,2),         -- manager-readable only (§11.1)
  apollo_credit_allowance_monthly integer,
  active                          boolean NOT NULL DEFAULT true,
  invited_at                      timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- ── user_tokens (invite / reset — §3.1) ────────────────────
CREATE TABLE user_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,                 -- sha256 of the emailed token
  purpose    token_purpose NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_tokens_hash_idx ON user_tokens (token_hash);

-- ── settings: status stages (§3.3a, §5.2) ──────────────────
CREATE TABLE status_stages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE,       -- STABLE key; rename label freely
  label         text NOT NULL,
  sort_order    integer NOT NULL,
  is_conversion boolean NOT NULL DEFAULT false, -- "won" trigger by flag, not name
  is_terminal   boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── settings: products (§3.3a) ─────────────────────────────
CREATE TABLE products (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  sort_order integer NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── opportunities (§5) ─────────────────────────────────────
CREATE TABLE opportunities (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id               uuid NOT NULL REFERENCES users(id),
  contractor_company_name  text NOT NULL,
  company_name_normalized  text NOT NULL,            -- for dup matching (§5.1)
  contact_name             text,
  contact_email            text,
  contact_email_normalized text,
  contact_cell             text,
  contact_cell_e164        text,                     -- E.164 for matching
  num_technicians          integer,
  product                  text,                     -- from products list (§3.3a)
  opportunity_value        numeric(12,2),
  status                   text NOT NULL REFERENCES status_stages(key),
  status_changed_at        timestamptz NOT NULL DEFAULT now(),
  state                    text NOT NULL,            -- 2-letter
  address                  text,
  website                  text,
  follow_up_at             timestamptz,
  next_step                text,
  next_step_due            timestamptz,
  notes                    text,
  custom_fields            jsonb NOT NULL DEFAULT '{}'::jsonb, -- reserved (§3.3)
  source                   opportunity_source NOT NULL DEFAULT 'typed',
  apollo_org_id            text,
  enriched_at              timestamptz,
  enrichment_verified      boolean NOT NULL DEFAULT false,
  last_activity_at         timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opportunities_advisor_idx       ON opportunities (advisor_id);
CREATE INDEX opportunities_status_idx        ON opportunities (status);
CREATE INDEX opportunities_state_idx         ON opportunities (state);
CREATE INDEX opportunities_email_idx         ON opportunities (contact_email_normalized);
CREATE INDEX opportunities_cell_idx          ON opportunities (contact_cell_e164);
-- pg_trgm GIN index powering fuzzy company-name dedupe (§5.1):
CREATE INDEX opportunities_company_trgm_idx  ON opportunities USING gin (company_name_normalized gin_trgm_ops);

-- ── key_personnel (§5) ─────────────────────────────────────
CREATE TABLE key_personnel (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  name            text NOT NULL,
  title           text,
  email           text,
  phone           text,
  apollo_person_id text,
  email_status    text,        -- verified / unverified / guessed (Apollo)
  source          text NOT NULL DEFAULT 'manual',
  verified        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX key_personnel_opp_idx ON key_personnel (opportunity_id);

-- ── collateral (§7) ────────────────────────────────────────
CREATE TABLE collateral (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product       text NOT NULL,
  type          collateral_type NOT NULL,
  title         text NOT NULL,
  description   text,
  storage_key   text,          -- object-storage key (signed on read, §11.5)
  file_url      text,          -- resolved/signed url (transient) or external file
  external_url  text,          -- YouTube/Vimeo for video, or link assets
  thumbnail_url text,
  sort_order    integer NOT NULL DEFAULT 0,
  uploaded_by   uuid REFERENCES users(id),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collateral_product_idx ON collateral (product);

-- ── claim_requests (takeover requests — §5.1) ──────────────
CREATE TABLE claim_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matched_opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  matched_company_name  text NOT NULL,
  requesting_advisor_id uuid NOT NULL REFERENCES users(id),
  current_owner_id      uuid NOT NULL REFERENCES users(id),
  draft                 jsonb NOT NULL,      -- requester's captured data
  status                claim_status NOT NULL DEFAULT 'pending',
  decided_by            uuid REFERENCES users(id),
  decided_at            timestamptz,
  decision_note         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_requests_status_idx ON claim_requests (status);

-- ── notifications (in-app centre — §5) ─────────────────────
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  message    text NOT NULL,
  related_id uuid,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read);

-- ── transactions (converted customers — the money record §5,§10) ──
CREATE TABLE transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id          uuid NOT NULL REFERENCES opportunities(id),
  advisor_id              uuid NOT NULL REFERENCES users(id),
  converted_at            timestamptz NOT NULL DEFAULT now(),
  deal_value              numeric(12,2) NOT NULL,
  commission_rate_snapshot numeric(5,2) NOT NULL,  -- copied at conversion, read forever
  commission_amount       numeric(12,2) NOT NULL,
  commission_tier_label   text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transactions_advisor_idx ON transactions (advisor_id);
CREATE INDEX transactions_converted_idx ON transactions (converted_at);

-- ══ Reserved for v1.1 / v2 (created now; populated later) ══
CREATE TABLE leads (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name            text NOT NULL,
  company_name_normalized text NOT NULL,
  location                text,
  address                 text,
  phone                   text,
  website                 text,
  apollo_org_id           text,
  num_technicians_est     integer,
  source                  text NOT NULL DEFAULT 'apollo',
  source_confidence       numeric,
  status                  lead_status NOT NULL DEFAULT 'new',
  claimed_by              uuid REFERENCES users(id),
  enriched                boolean NOT NULL DEFAULT false,
  custom_fields           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_company_trgm_idx ON leads USING gin (company_name_normalized gin_trgm_ops);

CREATE TABLE field_definitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity            field_entity NOT NULL,
  key               text NOT NULL,
  label             text NOT NULL,
  data_type         field_data_type NOT NULL,
  options           jsonb,
  required          boolean NOT NULL DEFAULT false,
  visible_to_advisor boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity, key)
);

CREATE TABLE apollo_usage (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id  uuid NOT NULL REFERENCES users(id),
  action      apollo_action NOT NULL,
  credits     numeric NOT NULL DEFAULT 0,
  entity_type field_entity NOT NULL,
  entity_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX apollo_usage_advisor_idx ON apollo_usage (advisor_id, created_at);
