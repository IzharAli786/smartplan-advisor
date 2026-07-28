-- 0026_drop_converted_leads.sql
-- Converting a lead now DELETES its row (the record lives on as the pipeline
-- opportunity, linked by the conversion activity-log entry) — a converted lead
-- "isn't a lead anymore" and should not clutter the Leads page. Remove the rows
-- converted before this change; their opportunities are untouched.
DELETE FROM leads WHERE status = 'converted';
