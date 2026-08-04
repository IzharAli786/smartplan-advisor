-- 0033_trials_stage.sql
-- "Trials" pipeline stage + trial window on opportunities.
--
-- SmartPlan now reports the referred customer's 14-day trial with each
-- activation push (trial_started_at / trial_ends_at, the EFFECTIVE end
-- including eco-admin extensions). The pipeline gains a "Trials" stage just
-- BEFORE Proposal so an advisor sees exactly which referred clients are
-- mid-trial; the stored end date lets the UI say "trial ended" the moment it
-- passes — no scheduled job needed on either side.
--
-- The stage insert is per-org (stages are org-scoped rows, possibly
-- customized): shift every stage at Proposal's slot and later up by one, then
-- insert trials into the gap. Orgs without a 'proposal' stage fall back to
-- slotting before their conversion stage, and failing that, to the end.
-- Idempotent per org via the key check.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS trial_ends_at   timestamptz;

DO $$
DECLARE
  org record;
  slot integer;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    IF EXISTS (SELECT 1 FROM status_stages WHERE org_id = org.id AND key = 'trials') THEN
      CONTINUE;
    END IF;

    SELECT sort_order INTO slot FROM status_stages
      WHERE org_id = org.id AND key = 'proposal';
    IF slot IS NULL THEN
      SELECT min(sort_order) INTO slot FROM status_stages
        WHERE org_id = org.id AND is_conversion AND active;
    END IF;
    IF slot IS NULL THEN
      SELECT coalesce(max(sort_order), 0) + 1 INTO slot FROM status_stages
        WHERE org_id = org.id;
    END IF;

    UPDATE status_stages SET sort_order = sort_order + 1
      WHERE org_id = org.id AND sort_order >= slot;

    -- win_probability 60: between Demo Scheduled (50) and Proposal (70) — a
    -- client actively trialing is warmer than a demo, colder than a proposal.
    INSERT INTO status_stages (org_id, key, label, sort_order, is_conversion, is_terminal, win_probability, active)
    VALUES (org.id, 'trials', 'Trials', slot, false, false, 60, true);
  END LOOP;
END $$;
