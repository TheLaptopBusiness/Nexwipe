CREATE OR REPLACE FUNCTION public._cb_resale_blockers(r public.chromebook_records, _notes text)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE out text[] := '{}'::text[]; k text; v text; _optional_fail boolean := false;
  _required text[] := ARRAY['display','keyboard','touchpad','battery','charging','wifi','ports','hinges'];
  _all text[] := ARRAY['display','touchscreen','keyboard','touchpad','battery','charging','wifi','camera','microphone','speakers','ports','hinges'];
BEGIN
  IF r.is_synthetic THEN out := array_append(out, 'Synthetic test records can never be released for resale'::text); END IF;
  IF r.ownership_status <> 'recorded' THEN out := array_append(out, 'Ownership authorization is missing'::text); END IF;
  IF r.management_basis IS NULL THEN
    out := array_append(out, 'Management is unknown or unresolved: record an administrator deprovisioning report or the owner''s never-managed report'::text);
  END IF;
  IF r.reset_authorized_by IS NULL OR r.reset_authorized_at IS NULL THEN
    out := array_append(out, 'Reset authorization by an owner or administrator is missing'::text);
  END IF;
  IF r.reset_status NOT IN ('evidence_collected','reviewed') THEN
    out := array_append(out, 'Reset completion evidence is missing'::text);
  END IF;
  IF r.reset_started_at IS NULL OR r.reset_completed_at IS NULL
     OR (r.reset_authorized_at IS NOT NULL AND r.reset_authorized_at > r.reset_started_at)
     OR r.reset_started_at > r.reset_completed_at THEN
    out := array_append(out, 'Reset timeline is incomplete or out of order'::text);
  END IF;
  IF r.management_status <> 'online_setup_checked' OR r.online_setup_result <> 'no_enrollment_prompt' OR r.online_setup_checked_at IS NULL THEN
    out := array_append(out, 'An online setup check after the reset, with no enrollment prompt, is required'::text);
  ELSIF r.reset_completed_at IS NOT NULL AND r.online_setup_checked_at < r.reset_completed_at THEN
    out := array_append(out, 'The online setup check must happen after the reset was completed'::text);
  END IF;
  FOREACH k IN ARRAY _all LOOP
    v := coalesce(r.diagnostics->>k, 'not_tested');
    IF v = 'not_tested' THEN out := array_append(out, ('Diagnostics incomplete: ' || k || ' not tested')::text);
    ELSIF k = ANY(_required) AND v <> 'pass' THEN out := array_append(out, ('Required check not passed: ' || k || ' (' || v || ')')::text);
    ELSIF k = 'touchscreen' AND v = 'fail' THEN out := array_append(out, 'Required check not passed: touchscreen (fail)'::text);
    ELSIF v = 'fail' THEN _optional_fail := true;
    END IF;
  END LOOP;
  IF _optional_fail AND coalesce(trim(_notes),'') = '' THEN
    out := array_append(out, 'Explain the optional diagnostic exceptions in the review notes'::text);
  END IF;
  RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION public._cb_resale_blockers(public.chromebook_records, text) FROM PUBLIC, anon, authenticated;