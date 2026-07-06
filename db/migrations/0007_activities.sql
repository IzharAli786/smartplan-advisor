-- Activity timeline: every interaction on an opportunity, auto-logged where possible.
CREATE TYPE activity_type AS ENUM ('call', 'sms', 'email', 'note', 'status_change', 'quote', 'system');

CREATE TABLE activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  advisor_id     uuid REFERENCES users(id),          -- null for system events
  type           activity_type NOT NULL,
  subject        text NOT NULL,
  body           text,
  outcome        text,                                -- e.g. connected / voicemail / no answer
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_opp_idx ON activities (opportunity_id, created_at DESC);
