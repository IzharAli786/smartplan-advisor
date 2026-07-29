-- 0028_org_date_format_us.sql
-- Standardize date display on US MM/DD/YYYY: any org still set to the
-- day-first DD/MM/YYYY (chosen at registration) flips over. The DB default
-- and the registration default were already MM/DD/YYYY — this fixes orgs
-- created with the UK/EU choice. Other formats (YYYY-MM-DD, DD MMM YYYY)
-- are deliberate picks and are left alone. Idempotent.
UPDATE organizations SET date_format = 'MM/DD/YYYY' WHERE date_format = 'DD/MM/YYYY';
