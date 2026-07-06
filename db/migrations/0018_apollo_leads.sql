-- Reshape the (unused) leads table into a proper org-scoped, advisor-assigned
-- Apollo lead inbox. The old table was v1 scaffolding referenced by no route.
DROP TABLE IF EXISTS leads;

CREATE TABLE leads (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL,
  assigned_advisor_id      uuid NOT NULL,
  status                   lead_status NOT NULL DEFAULT 'new',

  -- Person (Apollo)
  first_name               text,
  last_name                text,
  title                    text,
  email                    text,
  email_normalized         text,
  department               text,
  linkedin_url             text,

  -- Company (Apollo)
  company_name             text NOT NULL,
  company_name_normalized  text NOT NULL,
  website                  text,
  company_address          text,
  company_city             text,
  company_state            text,
  corporate_phone          text,
  company_phone            text,
  phone_e164               text,
  num_employees            integer,
  keywords                 text,          -- business description
  technologies             text,          -- software / tools in use
  annual_revenue           text,          -- kept raw (Apollo gives ranges or numbers)
  subsidiary_of            text,          -- parent contractor group, if any

  -- Meta
  apollo_org_id            text,
  source                   text NOT NULL DEFAULT 'apollo',
  notes                    text,
  custom_fields            jsonb NOT NULL DEFAULT '{}',
  converted_opportunity_id uuid,
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_org_idx          ON leads (org_id);
CREATE INDEX leads_advisor_idx      ON leads (assigned_advisor_id);
CREATE INDEX leads_company_norm_idx ON leads (company_name_normalized);
CREATE INDEX leads_email_norm_idx   ON leads (email_normalized);
