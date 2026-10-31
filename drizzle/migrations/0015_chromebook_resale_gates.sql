-- Close resale-ready gaps found by tests/db/phase2f_chromebook_resale_gates.sql:
-- unknown management could become a release basis via the online check, reset evidence was optional,
-- and required diagnostic failures could be waved through with a note. One rule set (_cb_resale_blockers)
-- is enforced by chromebook_review AND by a trigger for every caller, including trusted server code.

ALTER TABLE public.chromebook_records ADD COLUMN IF NOT EXISTS management_basis text;
COMMENT ON COLUMN public.chromebook_records.management_basis IS
  'Management resolution recorded before the post-reset online check (administrator report, integration confirmation or owner never-managed report). NULL = unresolved.';
ALTER TABLE public.chromebook_records ADD CONSTRAINT cb_management_basis_chk CHECK (management_basis IS NULL OR management_basis IN
  ('admin_reported_deprovisioned','deprovision_confirmed_integration','owner_reported_never_managed'));
ALTER TABLE public.chromebook_records DROP CONSTRAINT cb_management_chk;
ALTER TABLE public.chromebook_records ADD CONSTRAINT cb_management_chk CHECK (management_status IN ('unknown','management_observed','deprovision_requested',
  'admin_reported_deprovisioned','deprovision_confirmed_integration','owner_reported_never_managed','online_setup_checked','blocked'));

CREATE OR REPLACE FUNCTION public._cb_resale_blockers(r public.chromebook_records, _notes text)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE out text[] := '{}'; k text; v text; _optional_fail boolean := false;
  _required text[] := ARRAY['display','keyboard','touchpad','battery','charging','wifi','ports','hinges'];
  _all text[] := ARRAY['display','touchscreen','keyboard','touchpad','battery','charging','wifi','camera','microphone','speakers','ports','hinges'];
BEGIN
  IF r.is_synthetic THEN out := out || 'Synthetic test records can never be released for resale'; END IF;
  IF r.ownership_status <> 'recorded' THEN out := out || 'Ownership authorization is missing'; END IF;
  IF r.management_basis IS NULL THEN
    out := out || 'Management is unknown or unresolved: record an administrator deprovisioning report or the owner''s never-managed report';
  END IF;
  IF r.reset_authorized_by IS NULL OR r.reset_authorized_at IS NULL THEN
    out := out || 'Reset authorization by an owner or administrator is missing';
  END IF;
  IF r.reset_status NOT IN ('evidence_collected','reviewed') THEN
    out := out || 'Reset completion evidence is missing';
  END IF;
  IF r.reset_started_at IS NULL OR r.reset_completed_at IS NULL
     OR (r.reset_authorized_at IS NOT NULL AND r.reset_authorized_at > r.reset_started_at)
     OR r.reset_started_at > r.reset_completed_at THEN
    out := out || 'Reset timeline is incomplete or out of order';
  END IF;
  IF r.management_status <> 'online_setup_checked' OR r.online_setup_result <> 'no_enrollment_prompt' OR r.online_setup_checked_at IS NULL THEN
    out := out || 'An online setup check after the reset, with no enrollment prompt, is required';
  ELSIF r.reset_completed_at IS NOT NULL AND r.online_setup_checked_at <= r.reset_completed_at THEN
    out := out || 'The online setup check must happen after the reset was completed';
  END IF;
  FOREACH k IN ARRAY _all LOOP
    v := coalesce(r.diagnostics->>k, 'not_tested');
    IF v = 'not_tested' THEN out := out || ('Diagnostics incomplete: ' || k || ' not tested');
    ELSIF k = ANY(_required) AND v <> 'pass' THEN out := out || ('Required check not passed: ' || k || ' (' || v || ')');
    ELSIF k = 'touchscreen' AND v = 'fail' THEN out := out || 'Required check not passed: touchscreen (fail)';
    ELSIF v = 'fail' THEN _optional_fail := true;
    END IF;
  END LOOP;
  IF _optional_fail AND coalesce(trim(_notes),'') = '' THEN
    out := out || 'Explain the optional diagnostic exceptions in the review notes';
  END IF;
  RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION public._cb_resale_blockers(public.chromebook_records, text) FROM PUBLIC, anon, authenticated;

-- Defense in depth: no caller (RPC, trusted server code, service role) can hold resale_ready with a blocker.
CREATE OR REPLACE FUNCTION public.guard_chromebook_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b text[];
BEGIN
  IF NEW.release_decision = 'resale_ready' THEN
    b := public._cb_resale_blockers(NEW, NEW.review_notes);
    IF array_length(b, 1) > 0 THEN
      RAISE EXCEPTION 'Resale-ready is blocked: %', array_to_string(b, '; ') USING ERRCODE = '23514';
    END IF;
    IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'Resale-ready needs a recorded reviewer' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chromebook_records_zz_release_gate BEFORE INSERT OR UPDATE ON public.chromebook_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_chromebook_release();

CREATE OR REPLACE FUNCTION public.chromebook_set_management(_record uuid, _status text, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records;
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  IF r.release_decision = 'resale_ready' THEN
    RAISE EXCEPTION 'This Chromebook is already released: an owner or administrator must quarantine it before management changes' USING ERRCODE = '23514';
  END IF;
  IF _status NOT IN ('management_observed','deprovision_requested','admin_reported_deprovisioned','owner_reported_never_managed','blocked') THEN
    RAISE EXCEPTION 'This management status cannot be set by hand' USING ERRCODE = '22023';
  END IF;
  IF _status IN ('admin_reported_deprovisioned','deprovision_requested','blocked','owner_reported_never_managed') AND coalesce(trim(_notes),'') = '' THEN
    RAISE EXCEPTION 'Record who you contacted or who reported this, and when' USING ERRCODE = '22023';
  END IF;
  IF _status = 'owner_reported_never_managed' AND (r.management_status IN ('management_observed','deprovision_requested','blocked')
     OR EXISTS (SELECT 1 FROM public.chromebook_events e WHERE e.record_id = r.id AND e.to_value IN ('management_observed','blocked'))) THEN
    RAISE EXCEPTION 'Management was observed on this device: only the owning organization''s deprovisioning report can resolve it' USING ERRCODE = '23514';
  END IF;
  -- Any manual change invalidates an earlier post-reset online check and its basis.
  UPDATE public.chromebook_records SET management_status = _status, management_basis = NULL,
    online_setup_result = CASE WHEN management_status = 'online_setup_checked' THEN 'not_checked' ELSE online_setup_result END,
    online_setup_checked_at = CASE WHEN management_status = 'online_setup_checked' THEN NULL ELSE online_setup_checked_at END
  WHERE id = r.id;
  PERFORM public._cb_event(r, 'management', r.management_status, _status,
    CASE WHEN _status IN ('admin_reported_deprovisioned','owner_reported_never_managed') THEN 'administrator_report' ELSE 'technician_observation' END, _notes, '{}');
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_online_setup_check(_record uuid, _online boolean, _enrollment_prompt boolean, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records; _mgmt text; _res text; _basis text;
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  IF r.release_decision = 'resale_ready' THEN
    RAISE EXCEPTION 'This Chromebook is already released' USING ERRCODE = '23514';
  END IF;
  IF r.reset_status NOT IN ('technician_completed','evidence_collected') THEN
    RAISE EXCEPTION 'Check setup after the reset is completed' USING ERRCODE = '23514';
  END IF;
  IF NOT coalesce(_online,false) THEN
    RAISE EXCEPTION 'An offline setup screen is not evidence: connect to the internet and check again' USING ERRCODE = '23514';
  END IF;
  IF _enrollment_prompt THEN
    _mgmt := 'blocked'; _res := 'enrollment_prompt_shown'; _basis := NULL;
  ELSE
    IF r.management_status = 'online_setup_checked' THEN _basis := r.management_basis;
    ELSIF r.management_status IN ('admin_reported_deprovisioned','deprovision_confirmed_integration','owner_reported_never_managed') THEN _basis := r.management_status;
    ELSIF r.management_status = 'unknown' THEN
      RAISE EXCEPTION 'Management status is unknown: record the administrator''s deprovisioning report or the owner''s never-managed report first. A missing enrollment screen alone does not prove the device is unmanaged.' USING ERRCODE = '23514';
    ELSE
      RAISE EXCEPTION 'Management was observed: record the administrator''s deprovisioning report before this check' USING ERRCODE = '23514';
    END IF;
    IF _basis IS NULL THEN
      RAISE EXCEPTION 'Management basis is missing: record the management report again' USING ERRCODE = '23514';
    END IF;
    _mgmt := 'online_setup_checked'; _res := 'no_enrollment_prompt';
  END IF;
  UPDATE public.chromebook_records SET management_status = _mgmt, management_basis = _basis,
    online_setup_result = _res, online_setup_checked_at = now() WHERE id = r.id;
  PERFORM public._cb_event(r, 'online_setup_check', r.management_status, _mgmt, 'technician_observation', _notes,
    jsonb_build_object('online', _online, 'enrollment_prompt', _enrollment_prompt, 'management_basis', _basis));
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_reset_step(_record uuid, _action text, _method text DEFAULT NULL, _confirm_serial text DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records; d public.devices; _to text;
BEGIN
  IF _action = 'authorize' THEN
    r := public._cb_load(_record, ARRAY['owner','admin']::public.org_role[]);
  ELSE
    r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  END IF;
  IF r.release_decision = 'resale_ready' THEN
    RAISE EXCEPTION 'This Chromebook is already released' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO d FROM public.devices WHERE id = r.device_id;
  CASE _action
    WHEN 'authorize' THEN
      IF r.reset_status NOT IN ('not_started','failed_interrupted') THEN RAISE EXCEPTION 'Reset is already authorized or done' USING ERRCODE = '23514'; END IF;
      IF r.ownership_status <> 'recorded' THEN RAISE EXCEPTION 'Record ownership/processing authorization first' USING ERRCODE = '23514'; END IF;
      IF r.management_status IN ('management_observed','deprovision_requested','blocked') THEN
        RAISE EXCEPTION 'Managed or unresolved device: the owning organization must deprovision it before a reset' USING ERRCODE = '23514';
      END IF;
      IF d.system_serial IS NULL OR lower(trim(coalesce(_confirm_serial,''))) <> lower(d.system_serial) THEN
        RAISE EXCEPTION 'Type the serial number shown on the device to authorize the reset' USING ERRCODE = '22023';
      END IF;
      _to := 'authorized';
      -- A new reset invalidates the previous online check; the earlier management report is restored, not upgraded.
      UPDATE public.chromebook_records SET reset_status = _to, reset_method = NULL, reset_authorized_by = auth.uid(), reset_authorized_at = now(),
        reset_started_by = NULL, reset_started_at = NULL, reset_completed_at = NULL,
        online_setup_result = 'not_checked', online_setup_checked_at = NULL,
        management_status = CASE WHEN management_status = 'online_setup_checked' THEN coalesce(management_basis, 'unknown') ELSE management_status END,
        management_basis = NULL
      WHERE id = r.id;
    WHEN 'start' THEN
      IF r.reset_status <> 'authorized' THEN RAISE EXCEPTION 'Reset must be authorized first' USING ERRCODE = '23514'; END IF;
      IF _method IS NULL OR _method NOT IN ('powerwash','recovery_media','other') THEN RAISE EXCEPTION 'Choose the method being used' USING ERRCODE = '22023'; END IF;
      IF _method = 'other' AND coalesce(trim(_notes),'') = '' THEN RAISE EXCEPTION 'Describe the method' USING ERRCODE = '22023'; END IF;
      _to := 'in_progress';
      UPDATE public.chromebook_records SET reset_status = _to, reset_method = _method, reset_started_by = auth.uid(), reset_started_at = now() WHERE id = r.id;
    WHEN 'complete' THEN
      IF r.reset_status <> 'in_progress' THEN RAISE EXCEPTION 'Reset is not in progress' USING ERRCODE = '23514'; END IF;
      _to := 'technician_completed';
      UPDATE public.chromebook_records SET reset_status = _to, reset_completed_at = now() WHERE id = r.id;
    WHEN 'evidence' THEN
      IF r.reset_status NOT IN ('technician_completed','evidence_collected') THEN RAISE EXCEPTION 'Complete the reset first' USING ERRCODE = '23514'; END IF;
      IF coalesce(trim(_notes),'') = '' THEN RAISE EXCEPTION 'Describe the evidence collected' USING ERRCODE = '22023'; END IF;
      _to := 'evidence_collected';
      UPDATE public.chromebook_records SET reset_status = _to WHERE id = r.id;
    WHEN 'fail' THEN
      IF r.reset_status NOT IN ('authorized','in_progress') THEN RAISE EXCEPTION 'Only an authorized or running reset can fail' USING ERRCODE = '23514'; END IF;
      IF coalesce(trim(_notes),'') = '' THEN RAISE EXCEPTION 'Describe what happened' USING ERRCODE = '22023'; END IF;
      _to := 'failed_interrupted';
      UPDATE public.chromebook_records SET reset_status = _to WHERE id = r.id;
    ELSE RAISE EXCEPTION 'Unknown reset action' USING ERRCODE = '22023';
  END CASE;
  PERFORM public._cb_event(r, 'reset_' || _action, r.reset_status, _to, 'technician_observation', _notes,
    jsonb_build_object('method', _method));
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_record_diagnostics(_record uuid, _results jsonb, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records; k text; v text; _status text := 'passed'; _clean jsonb := '{}'::jsonb;
  _keys text[] := ARRAY['display','touchscreen','keyboard','touchpad','battery','charging','wifi','camera','microphone','speakers','ports','hinges'];
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  IF r.release_decision = 'resale_ready' THEN
    RAISE EXCEPTION 'This Chromebook is already released: quarantine it before re-testing' USING ERRCODE = '23514';
  END IF;
  FOREACH k IN ARRAY _keys LOOP
    v := coalesce(_results->>k, 'not_tested');
    IF v NOT IN ('pass','fail','not_fitted','not_tested') THEN RAISE EXCEPTION 'Invalid result for %', k USING ERRCODE = '22023'; END IF;
    _clean := _clean || jsonb_build_object(k, v);
    IF v = 'not_tested' THEN _status := 'in_progress';
    ELSIF v = 'fail' AND _status <> 'in_progress' THEN _status := 'exceptions'; END IF;
  END LOOP;
  IF _status = 'in_progress' AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(_clean) WHERE value <> 'not_tested') THEN _status := 'not_started'; END IF;
  UPDATE public.chromebook_records SET diagnostics = _clean || jsonb_build_object('notes', nullif(trim(_notes),''), 'method', 'manual'),
    diagnostics_status = _status WHERE id = r.id;
  PERFORM public._cb_event(r, 'diagnostics', r.diagnostics_status, _status, 'technician_observation', _notes, _clean);
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_review(_record uuid, _decision text, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records; b text[];
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin']::public.org_role[]);
  IF _decision = 'resale_ready' THEN
    IF r.release_decision = 'resale_ready' THEN RAISE EXCEPTION 'Already released' USING ERRCODE = '23514'; END IF;
    b := public._cb_resale_blockers(r, _notes);
    IF array_length(b, 1) > 0 THEN
      RAISE EXCEPTION 'Resale-ready is blocked: %', array_to_string(b, '; ') USING ERRCODE = '23514';
    END IF;
    UPDATE public.chromebook_records SET release_decision = 'resale_ready', reset_status = 'reviewed',
      reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(trim(_notes),'') WHERE id = r.id;
  ELSIF _decision = 'quarantined' THEN
    IF coalesce(trim(_notes),'') = '' THEN RAISE EXCEPTION 'Give a reason for quarantine' USING ERRCODE = '22023'; END IF;
    UPDATE public.chromebook_records SET release_decision = 'quarantined',
      reviewed_by = auth.uid(), reviewed_at = now(), review_notes = trim(_notes) WHERE id = r.id;
  ELSE RAISE EXCEPTION 'Unknown decision' USING ERRCODE = '22023';
  END IF;
  PERFORM public._cb_event(r, 'review', r.release_decision, _decision, 'technician_observation', _notes, '{}');
END $$;

-- Staff-readable server-side blocker list for the review screen.
CREATE OR REPLACE FUNCTION public.chromebook_resale_check(_record uuid, _notes text DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records;
BEGIN
  SELECT * INTO r FROM public.chromebook_records WHERE id = _record;
  IF NOT FOUND OR NOT public.is_org_staff(r.org_id) THEN
    RAISE EXCEPTION 'Chromebook record not found or not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN public._cb_resale_blockers(r, _notes);
END $$;
REVOKE EXECUTE ON FUNCTION public.chromebook_resale_check(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chromebook_resale_check(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_chromebook_release() FROM PUBLIC, anon, authenticated;