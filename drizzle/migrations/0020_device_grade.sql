-- Resale grade: the cosmetic condition a laptop is sold at (A like new, B light wear, C heavy wear,
-- D faulty / for parts), set by staff after testing. Kept in the system rather than written on the
-- label so it cannot be altered by hand; it prints on the device tag.
-- Who may set it: the existing "Operators update devices" policy (owner/admin/technician; auditors and
-- client viewers cannot). Every change is recorded with actor and old/new value by the existing
-- audit_devices trigger, so no new history code is needed.
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS grade text;
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS devices_grade_chk;
ALTER TABLE public.devices ADD CONSTRAINT devices_grade_chk CHECK (grade IS NULL OR grade IN ('A','B','C','D'));
