-- DB-backed file storage (moves uploads off local disk into Postgres) +
-- per-organization branding logos.

CREATE TABLE IF NOT EXISTS file_blobs (
  key          text PRIMARY KEY,
  content_type text,
  byte_size    integer NOT NULL,
  data         bytea   NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS light_logo_key text,
  ADD COLUMN IF NOT EXISTS dark_logo_key  text;

-- Retire the old platform-wide branding keys (logos are now per-org). Covers every
-- legacy branding.* key from earlier schemes (branding.logo_key, branding.login_logo_key, …).
DELETE FROM app_settings WHERE key LIKE 'branding.%';
