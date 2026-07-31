-- 0030_org_heard_about.sql
-- "How did you hear about us?" — free-text source captured at business
-- registration, stored on the organization. Nullable because existing orgs
-- predate the question; the /register route requires it for new signups.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS heard_about text;
