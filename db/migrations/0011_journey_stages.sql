-- "Stages": a configurable sales-journey / touchpoint sequence shown as a graphical
-- stepper on each opportunity (distinct from pipeline Status). Managed in Settings.
CREATE TABLE journey_stages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  sort_order integer NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO journey_stages (label, sort_order) VALUES
  ('Intro Call', 1),
  ('Intro Email', 2),
  ('Follow Up Email', 3),
  ('Zoom Demo', 4),
  ('Upgrade Email', 5),
  ('Trial Started', 6);

-- Which journey stages an opportunity has completed (presence = done, with a timestamp).
CREATE TABLE opportunity_journey (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  stage_id       uuid NOT NULL REFERENCES journey_stages(id) ON DELETE CASCADE,
  completed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX opportunity_journey_unique ON opportunity_journey (opportunity_id, stage_id);
