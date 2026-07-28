-- 0025_seed_missing_status_stages.sql
-- Prod's original org (00000000-…-000000000001, created for pre-multi-tenant data)
-- has ZERO rows in status_stages: the per-org defaults only ever came from
-- provisionOrg() on NEW registrations, and the original org predates that path.
-- Every opportunity insert calls getInitialStageKey(), so the first advisor who
-- tried to convert a lead / create an opportunity got a 500 (2026-07-27).
--
-- Seed the provisionOrg() DEFAULT_STAGES for any org that has no stages at all.
-- Keep the two in step: apps/api/src/services/provision.ts DEFAULT_STAGES.
-- Idempotent: an org with even one stage (e.g. deliberately customized) is
-- untouched, and re-running inserts nothing.
INSERT INTO status_stages (org_id, key, label, sort_order, is_conversion, is_terminal, win_probability)
SELECT o.id, v.key, v.label, v.sort_order, v.is_conversion, v.is_terminal, v.win_probability
  FROM organizations o
 CROSS JOIN (VALUES
   ('new',            'New',            1, false, false, 10),
   ('contacted',      'Contacted',      2, false, false, 25),
   ('demo_scheduled', 'Demo Scheduled', 3, false, false, 50),
   ('proposal',       'Proposal',       4, false, false, 70),
   ('won',            'Won',            5, true,  true,  100),
   ('lost',           'Lost',           6, false, true,  0)
 ) AS v(key, label, sort_order, is_conversion, is_terminal, win_probability)
 WHERE NOT EXISTS (SELECT 1 FROM status_stages s WHERE s.org_id = o.id);
