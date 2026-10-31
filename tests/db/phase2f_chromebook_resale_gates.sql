-- NexWipe Chromebook resale-ready gates (server-side). Single DO block; always rolls back.
-- Every check here tries to approve "resale-ready" with one requirement missing and expects
-- the database to refuse it, plus positive controls proving a complete record can be released.
-- Run with a privileged connection (needs to insert test users into auth.users).
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid();
  ca text; ct text;
  oa uuid; tok text; rec uuid; m text; s text; r text := '';
  diag jsonb := '{"display":"pass","touchscreen":"not_fitted","keyboard":"pass","touchpad":"pass","battery":"pass","charging":"pass","wifi":"pass","camera":"pass","microphone":"pass","speakers":"pass","ports":"pass","hinges":"pass"}';
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'p2fa@test.local', now(), 'authenticated','authenticated'),
    (ut, 'p2ft@test.local', now(), 'authenticated','authenticated');
  ca := json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text;
  ct := json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', ca, true);
  oa := public.create_organization('P2F A', 'p2f-a-' || substr(ua::text,1,8));
  tok := public.create_invitation(oa, 'p2ft@test.local', 'technician');
  PERFORM set_config('request.jwt.claims', ct, true);
  PERFORM public.accept_invitation(tok);

  ---------------------------------------------------------------------------
  -- G1. Unknown management status: reset + online check must not turn "unknown" into a release basis
  rec := public.chromebook_register(oa, 'F-1', 'HP', 'Chromebook 11 G5', 'FSER1');
  PERFORM public.chromebook_record_ownership(rec, 'District IT', 'PO-1');
  PERFORM set_config('request.jwt.claims', ca, true);
  PERFORM public.chromebook_reset_step(rec, 'authorize', NULL, 'FSER1', NULL);
  PERFORM set_config('request.jwt.claims', ct, true);
  PERFORM public.chromebook_reset_step(rec, 'start', 'powerwash', NULL, NULL);
  PERFORM public.chromebook_reset_step(rec, 'complete');
  PERFORM public.chromebook_reset_step(rec, 'evidence', NULL, NULL, 'Photo of welcome screen');
  PERFORM public.chromebook_record_diagnostics(rec, diag, NULL);
  BEGIN
    PERFORM public.chromebook_online_setup_check(rec, true, false, 'Online, no enrollment screen');
    r := r || ' [unknown_mgmt_online_check_refused FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [unknown_mgmt_online_check_refused PASS]'; END;
  PERFORM set_config('request.jwt.claims', ca, true);
  BEGIN
    PERFORM public.chromebook_review(rec, 'resale_ready', NULL);
    r := r || ' [unknown_mgmt_blocks_resale FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [unknown_mgmt_blocks_resale PASS]'; END;
  SELECT management_status INTO m FROM public.chromebook_records WHERE id = rec;
  r := r || ' [unknown_stays_unknown ' || CASE WHEN m = 'unknown' THEN 'PASS' ELSE 'FAIL ' || m END || ']';

  -- G1b. Owner-reported "never managed" is an explicit, noted report and then allows release
  PERFORM set_config('request.jwt.claims', ct, true);
  BEGIN
    PERFORM public.chromebook_set_management(rec, 'owner_reported_never_managed', '');
    r := r || ' [never_managed_needs_note FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [never_managed_needs_note PASS]'; END;
  PERFORM public.chromebook_set_management(rec, 'owner_reported_never_managed', 'Owner A. Smith states consumer purchase, never enrolled (email 09:12)');
  PERFORM public.chromebook_online_setup_check(rec, true, false, 'Online, no enrollment screen');
  PERFORM set_config('request.jwt.claims', ca, true);
  PERFORM public.chromebook_review(rec, 'resale_ready', NULL);
  SELECT release_decision || '/' || coalesce(management_basis,'null') INTO s FROM public.chromebook_records WHERE id = rec;
  r := r || ' [control_never_managed_release ' || CASE WHEN s = 'resale_ready/owner_reported_never_managed' THEN 'PASS' ELSE 'FAIL ' || s END || ']';

  -- G1c. Once released, management cannot be changed without quarantining first
  PERFORM set_config('request.jwt.claims', ct, true);
  BEGIN
    PERFORM public.chromebook_set_management(rec, 'management_observed', 'Managed label seen later');
    r := r || ' [released_record_mgmt_change_refused FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [released_record_mgmt_change_refused PASS]'; END;

  -- G1d. "Never managed" cannot override observed management
  rec := public.chromebook_register(oa, 'F-1D', 'HP', 'Chromebook 11 G5', 'FSER1D');
  PERFORM public.chromebook_set_management(rec, 'management_observed', 'Managed-by label');
  BEGIN
    PERFORM public.chromebook_set_management(rec, 'owner_reported_never_managed', 'Owner says never managed');
    r := r || ' [never_managed_cannot_override_observed FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [never_managed_cannot_override_observed PASS]'; END;

  ---------------------------------------------------------------------------
  -- G2. Missing reset evidence blocks release
  rec := public.chromebook_register(oa, 'F-2', 'HP', 'Chromebook 14 G5', 'FSER2');
  PERFORM public.chromebook_record_ownership(rec, 'District IT', 'PO-2');
  PERFORM public.chromebook_set_management(rec, 'admin_reported_deprovisioned', 'J. Doe confirmed by email 11:00');
  PERFORM set_config('request.jwt.claims', ca, true);
  PERFORM public.chromebook_reset_step(rec, 'authorize', NULL, 'FSER2', NULL);
  PERFORM set_config('request.jwt.claims', ct, true);
  PERFORM public.chromebook_reset_step(rec, 'start', 'powerwash', NULL, NULL);
  PERFORM public.chromebook_reset_step(rec, 'complete');
  PERFORM public.chromebook_online_setup_check(rec, true, false, 'Online, no enrollment screen');
  PERFORM public.chromebook_record_diagnostics(rec, diag, NULL);
  PERFORM set_config('request.jwt.claims', ca, true);
  BEGIN
    PERFORM public.chromebook_review(rec, 'resale_ready', NULL);
    r := r || ' [missing_reset_evidence_blocks FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [missing_reset_evidence_blocks PASS]'; END;
  PERFORM set_config('request.jwt.claims', ct, true);
  PERFORM public.chromebook_reset_step(rec, 'evidence', NULL, NULL, 'Photo of welcome screen + recovery log');

  ---------------------------------------------------------------------------
  -- G4. Unresolved required diagnostic failure blocks release even with notes
  PERFORM public.chromebook_record_diagnostics(rec, diag || '{"display":"fail"}', 'Dead pixels');
  PERFORM set_config('request.jwt.claims', ca, true);
  BEGIN
    PERFORM public.chromebook_review(rec, 'resale_ready', 'Accept anyway');
    r := r || ' [required_diag_fail_blocks FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [required_diag_fail_blocks PASS]'; END;
  PERFORM set_config('request.jwt.claims', ct, true);
  PERFORM public.chromebook_record_diagnostics(rec, diag || '{"keyboard":"not_fitted"}', NULL);
  PERFORM set_config('request.jwt.claims', ca, true);
  BEGIN
    PERFORM public.chromebook_review(rec, 'resale_ready', 'x');
    r := r || ' [required_diag_not_fitted_blocks FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [required_diag_not_fitted_blocks PASS]'; END;
  -- optional check failing needs an explanation
  PERFORM set_config('request.jwt.claims', ct, true);
  PERFORM public.chromebook_record_diagnostics(rec, diag || '{"camera":"fail"}', 'Camera dead');
  PERFORM set_config('request.jwt.claims', ca, true);
  BEGIN
    PERFORM public.chromebook_review(rec, 'resale_ready', '');
    r := r || ' [optional_fail_needs_explanation FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [optional_fail_needs_explanation PASS]'; END;
  -- resolved: required failure re-tested as pass -> release allowed (positive control)
  PERFORM set_config('request.jwt.claims', ct, true);
  PERFORM public.chromebook_record_diagnostics(rec, diag, 'Display replaced and re-tested');
  PERFORM set_config('request.jwt.claims', ca, true);
  PERFORM public.chromebook_review(rec, 'resale_ready', NULL);
  SELECT release_decision INTO s FROM public.chromebook_records WHERE id = rec;
  r := r || ' [control_full_record_release ' || CASE WHEN s = 'resale_ready' THEN 'PASS' ELSE 'FAIL ' || s END || ']';

  ---------------------------------------------------------------------------
  -- G3. Incomplete online setup check blocks release; a new authorization clears the old check
  PERFORM set_config('request.jwt.claims', ct, true);
  rec := public.chromebook_register(oa, 'F-3', 'Lenovo', '300e Chromebook 2nd Gen', 'FSER3');
  PERFORM public.chromebook_record_ownership(rec, 'District IT', 'PO-3');
  PERFORM public.chromebook_set_management(rec, 'admin_reported_deprovisioned', 'Ticket 4411');
  PERFORM set_config('request.jwt.claims', ca, true);
  PERFORM public.chromebook_reset_step(rec, 'authorize', NULL, 'FSER3', NULL);
  PERFORM set_config('request.jwt.claims', ct, true);
  PERFORM public.chromebook_reset_step(rec, 'start', 'powerwash', NULL, NULL);
  PERFORM public.chromebook_reset_step(rec, 'complete');
  PERFORM public.chromebook_reset_step(rec, 'evidence', NULL, NULL, 'Photo');
  PERFORM public.chromebook_record_diagnostics(rec, diag, NULL);
  PERFORM set_config('request.jwt.claims', ca, true);
  BEGIN
    PERFORM public.chromebook_review(rec, 'resale_ready', NULL);
    r := r || ' [no_online_check_blocks FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_online_check_blocks PASS]'; END;
  PERFORM set_config('request.jwt.claims', ct, true);
  PERFORM public.chromebook_online_setup_check(rec, true, true, 'Enterprise enrollment screen');
  PERFORM set_config('request.jwt.claims', ca, true);
  BEGIN
    PERFORM public.chromebook_review(rec, 'resale_ready', NULL);
    r := r || ' [enrollment_prompt_blocks FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [enrollment_prompt_blocks PASS]'; END;

  ---------------------------------------------------------------------------
  -- G5. Trusted/server path cannot skip authorization or evidence either (invariant trigger)
  PERFORM set_config('role', me, true);
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.chromebook_records SET management_status = 'online_setup_checked', management_basis = 'admin_reported_deprovisioned',
    online_setup_result = 'no_enrollment_prompt', online_setup_checked_at = now(),
    reset_status = 'evidence_collected', reset_authorized_by = NULL, reset_authorized_at = NULL,
    reviewed_by = ua, reviewed_at = now()
  WHERE id = rec;
  BEGIN
    UPDATE public.chromebook_records SET release_decision = 'resale_ready' WHERE id = rec;
    r := r || ' [trusted_path_needs_authorization FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [trusted_path_needs_authorization PASS]'; END;
  UPDATE public.chromebook_records SET reset_authorized_by = ua, reset_authorized_at = reset_started_at - interval '1 minute',
    reset_status = 'technician_completed' WHERE id = rec;
  BEGIN
    UPDATE public.chromebook_records SET release_decision = 'resale_ready' WHERE id = rec;
    r := r || ' [trusted_path_needs_evidence FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [trusted_path_needs_evidence PASS]'; END;
  UPDATE public.chromebook_records SET reset_status = 'evidence_collected', online_setup_checked_at = reset_completed_at - interval '1 minute' WHERE id = rec;
  BEGIN
    UPDATE public.chromebook_records SET release_decision = 'resale_ready' WHERE id = rec;
    r := r || ' [online_check_must_follow_reset FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [online_check_must_follow_reset PASS]'; END;
  -- positive control: same record with every requirement satisfied is accepted by the trigger
  UPDATE public.chromebook_records SET online_setup_checked_at = reset_completed_at + interval '1 minute' WHERE id = rec;
  UPDATE public.chromebook_records SET release_decision = 'resale_ready' WHERE id = rec;
  SELECT release_decision INTO s FROM public.chromebook_records WHERE id = rec;
  r := r || ' [control_trusted_complete_release ' || CASE WHEN s = 'resale_ready' THEN 'PASS' ELSE 'FAIL ' || s END || ']';

  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
