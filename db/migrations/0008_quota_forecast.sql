-- Quota (per advisor) + win probability (per stage) for forecasting.
ALTER TABLE users ADD COLUMN monthly_quota numeric(12,2);
ALTER TABLE status_stages ADD COLUMN win_probability integer NOT NULL DEFAULT 0;

-- Seed sensible default win probabilities for the standard stages.
UPDATE status_stages SET win_probability = CASE key
  WHEN 'new'            THEN 10
  WHEN 'contacted'      THEN 25
  WHEN 'demo_scheduled' THEN 50
  WHEN 'proposal'       THEN 70
  WHEN 'won'            THEN 100
  WHEN 'lost'           THEN 0
  ELSE win_probability END;
