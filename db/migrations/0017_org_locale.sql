-- Per-organization locale preferences, captured at registration.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS currency    text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'MM/DD/YYYY';
