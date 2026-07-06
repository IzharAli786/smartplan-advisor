-- Key/value app settings (branding logo, etc.). Single small table; values are text
-- (store a JSON string if a setting needs structure).
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
