-- 0032_advisor_hard_delete.sql
-- Let a super admin permanently DELETE a former advisor (deactivated, leads
-- reassigned — see DELETE /api/users/:id).
--
-- Several "who did this" columns reference users(id) with the default NO ACTION,
-- so ANY history — one logged call, one Apollo lookup — would block the delete
-- forever. Retarget those actor references so history survives (or dies) sensibly:
--
--   * activities.advisor_id            → SET NULL (already "null for system events")
--   * collateral.uploaded_by           → SET NULL (the file itself stays in the library)
--   * claim_requests requester/owner   → CASCADE  (a claim is meaningless without its
--                                        parties; the matched opportunity is untouched)
--   * claim_requests.decided_by        → SET NULL (decision record survives)
--   * apollo_usage.advisor_id          → CASCADE  (per-advisor metering, worthless after)
--
-- Deliberately NOT touched — these must keep blocking a delete at the DB level:
--   * opportunities.advisor_id, quotes.advisor_id  — reassign the pipeline first
--   * transactions.advisor_id                      — commission history is forever;
--                                                    advisors with sales stay deactivated

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_advisor_id_fkey;
ALTER TABLE activities
  ADD CONSTRAINT activities_advisor_id_fkey
  FOREIGN KEY (advisor_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE collateral DROP CONSTRAINT IF EXISTS collateral_uploaded_by_fkey;
ALTER TABLE collateral
  ADD CONSTRAINT collateral_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE claim_requests DROP CONSTRAINT IF EXISTS claim_requests_requesting_advisor_id_fkey;
ALTER TABLE claim_requests
  ADD CONSTRAINT claim_requests_requesting_advisor_id_fkey
  FOREIGN KEY (requesting_advisor_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE claim_requests DROP CONSTRAINT IF EXISTS claim_requests_current_owner_id_fkey;
ALTER TABLE claim_requests
  ADD CONSTRAINT claim_requests_current_owner_id_fkey
  FOREIGN KEY (current_owner_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE claim_requests DROP CONSTRAINT IF EXISTS claim_requests_decided_by_fkey;
ALTER TABLE claim_requests
  ADD CONSTRAINT claim_requests_decided_by_fkey
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE apollo_usage DROP CONSTRAINT IF EXISTS apollo_usage_advisor_id_fkey;
ALTER TABLE apollo_usage
  ADD CONSTRAINT apollo_usage_advisor_id_fkey
  FOREIGN KEY (advisor_id) REFERENCES users(id) ON DELETE CASCADE;
