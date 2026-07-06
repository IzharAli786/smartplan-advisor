-- Referral / enrolment fields on the advisor record.
ALTER TABLE users ADD COLUMN referral_link text;
ALTER TABLE users ADD COLUMN enrolled_date date;
ALTER TABLE users ADD COLUMN referred_by text;
