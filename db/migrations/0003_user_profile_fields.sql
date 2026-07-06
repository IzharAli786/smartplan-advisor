-- Additional advisor profile fields (editable from the Users admin screen).
ALTER TABLE users
  ADD COLUMN phone2     text,
  ADD COLUMN address    text,
  ADD COLUMN start_date date,
  ADD COLUMN notes      text;
