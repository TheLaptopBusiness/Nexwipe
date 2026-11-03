-- UNDO for drizzle/migrations/0020_device_grade.sql.
-- Restores the schema exactly as it was after 0019. Data loss on undo: recorded grades are removed
-- (their history stays in audit_events). Nothing else is touched.
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS devices_grade_chk;
ALTER TABLE public.devices DROP COLUMN IF EXISTS grade;
