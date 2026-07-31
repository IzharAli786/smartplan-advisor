-- 0029_advisor_profiles_own_resources.sql
-- Advisor profiles + personal resources + manager feedback.
--
-- 1) users.bio / users.capabilities — written by the advisor themselves,
--    shown to every signed-in user on the Team page. Management notes reuse
--    the existing users.notes column (already managerial-only in serializeUser).
-- 2) collateral.owner_id — NULL means the row is the org library published by
--    a super admin (advisors can view but never modify). Non-null marks an
--    advisor's personal resource: visible to that advisor (and admins) only,
--    and deletable by its owner.
-- 3) advisor_feedback — feedback a super admin writes FOR an advisor. The
--    advisor can read entries addressed to them; other advisors cannot.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS capabilities text;

ALTER TABLE collateral ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS advisor_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  advisor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advisor_feedback_advisor_idx ON advisor_feedback (advisor_id, created_at DESC);
