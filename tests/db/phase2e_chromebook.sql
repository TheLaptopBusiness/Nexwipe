-- NexWipe Chromebook processing acceptance checks. Single DO block; always rolls back.
-- Run: psql -f tests/db/phase2e_chromebook.sql
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  oa uuid; ob uuid; tok text; rec uuid; rec2 uuid; rsyn uuid; dsyn uuid; dev uuid; drv uuid; pol uuid; j uuid;
  s text; m text; n int; n2 int; r text := '';
  diag jsonb := '{"display":"pass","touchscreen":"not_fitted","keyboard":"pass","touchpad":"pass","battery":"pass","charging":"pass","wifi":"pass","camera":"pass","microphone":"pass","speakers":"pass","ports":"pass","hinges":"pass"}';
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'p2ea@test.local', now(), 'authenticated','authenticated'),
    (ut, 'p2et@test.local', now(), 'authenticated','authenticated'),
    (ub, 'p2eb@test.local', now(), 'authenticated','authenticated');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated','aal','aal2')::text, true);
  ob := public.create_organization('P2E B', 'p2e-b-' || substr(ub::text,1,8));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  oa := public.create_organization('P2E A', 'p2e-a-' || substr(ua::text,1,8));
  tok := public.create_invitation(oa, 'p2et@test.local', 'technician');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.accept_invitation(tok);

  -- technician receives a Chromebook
  rec := public.chromebook_register(oa, 'CB-1', 'HP', 'Chromebook 11 G5', 'CBSER001');
  SELECT management_status INTO m FROM public.chromebook_records WHERE id = rec;
  r := r || ' [new_record_unknown_management ' || CASE WHEN m = 'unknown' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- 1. browser cannot write records/events directly
  BEGIN
    UPDATE public.chromebook_records SET management_status = 'online_setup_checked' WHERE id = rec;
    SELECT management_status INTO m FROM public.chromebook_records WHERE id = rec;
    r := r || ' [no_direct_update ' || CASE WHEN m = 'unknown' THEN 'PASS' ELSE 'FAIL' END || ']';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' [no_direct_update PASS]'; END;
  BEGIN
    INSERT INTO public.chromebook_events(org_id, record_id, step, evidence_kind) VALUES (oa, rec, 'x', 'integration_result');
    r := r || ' [no_direct_event_insert FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_direct_event_insert PASS]'; END;

  -- 2. integration-only states and API sources are refused for app users
  BEGIN
    PERFORM public.chromebook_set_management(rec, 'deprovision_confirmed_integration', 'x');
    r := r || ' [no_user_integration_confirm FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_user_integration_confirm PASS]'; END;
  BEGIN
    PERFORM public.chromebook_update_identity(rec, '{"board":{"value":"SETZER","source":"api_reported"}}');
    r := r || ' [no_user_api_source FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_user_api_source PASS]'; END;
  BEGIN
    PERFORM public.chromebook_set_management(rec, 'online_setup_checked', 'x');
    r := r || ' [unknown_cannot_be_set_unmanaged FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [unknown_cannot_be_set_unmanaged PASS]'; END;
  PERFORM public.chromebook_update_identity(rec, '{"board":{"value":"setzer","source":"physically_observed"},"cpu_arch":{"value":"unknown","source":"manual"}}');
  SELECT board || '/' || board_source || '/' || cpu_arch || '/' || coalesce(cpu_arch_source,'null') INTO s FROM public.chromebook_records WHERE id = rec;
  r := r || ' [unknown_stays_unknown ' || CASE WHEN s = 'SETZER/physically_observed/unknown/null' THEN 'PASS' ELSE 'FAIL ' || s END || ']';

  -- 3. managed device: reset blocked until administrator reports deprovisioning
  PERFORM public.chromebook_record_ownership(rec, 'Lincoln School District IT', 'PO-1234');
  PERFORM public.chromebook_set_management(rec, 'management_observed', 'Managed-by label on sign-in screen');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    PERFORM public.chromebook_reset_step(rec, 'authorize', NULL, 'CBSER001', NULL);
    r := r || ' [managed_reset_blocked FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [managed_reset_blocked PASS]'; END;
  BEGIN
    PERFORM public.chromebook_set_management(rec, 'deprovision_requested', '');
    r := r || ' [deprov_request_needs_note FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [deprov_request_needs_note PASS]'; END;
  PERFORM public.chromebook_set_management(rec, 'deprovision_requested', 'Emailed j.doe@school 10:00');
  PERFORM public.chromebook_set_management(rec, 'admin_reported_deprovisioned', 'J. Doe confirmed by email 11:00');
  BEGIN
    PERFORM public.chromebook_reset_step(rec, 'authorize', NULL, 'WRONG', NULL);
    r := r || ' [authorize_needs_serial FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [authorize_needs_serial PASS]'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  BEGIN
    PERFORM public.chromebook_reset_step(rec, 'authorize', NULL, 'CBSER001', NULL);
    r := r || ' [technician_cannot_authorize FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [technician_cannot_authorize PASS]'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.chromebook_reset_step(rec, 'authorize', NULL, 'cbser001', NULL);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.chromebook_reset_step(rec, 'start', 'powerwash', NULL, NULL);
  PERFORM public.chromebook_reset_step(rec, 'complete');
  PERFORM public.chromebook_reset_step(rec, 'evidence', NULL, NULL, 'Photo of welcome screen');

  -- 4. reset completion does not imply deprovisioning or unmanaged
  SELECT management_status INTO m FROM public.chromebook_records WHERE id = rec;
  r := r || ' [reset_does_not_change_management ' || CASE WHEN m = 'admin_reported_deprovisioned' THEN 'PASS' ELSE 'FAIL ' || m END || ']';

  -- 5. offline setup screen is not evidence; resale needs online check
  BEGIN
    PERFORM public.chromebook_online_setup_check(rec, false, false, 'offline welcome screen');
    r := r || ' [offline_setup_rejected FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [offline_setup_rejected PASS]'; END;
  PERFORM public.chromebook_record_diagnostics(rec, diag, NULL);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    PERFORM public.chromebook_review(rec, 'resale_ready', NULL);
    r := r || ' [no_resale_without_online_check FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_resale_without_online_check PASS]'; END;
  PERFORM public.chromebook_online_setup_check(rec, true, false, 'Online, no enterprise enrollment screen');
  PERFORM public.chromebook_review(rec, 'resale_ready', NULL);
  SELECT release_decision || '/' || reset_status INTO s FROM public.chromebook_records WHERE id = rec;
  r := r || ' [full_path_resale_ready ' || CASE WHEN s = 'resale_ready/reviewed' THEN 'PASS' ELSE 'FAIL ' || s END || ']';

  -- 6. enrollment prompt after reset => blocked, no resale
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  rec2 := public.chromebook_register(oa, 'CB-2', 'Lenovo', '300e Chromebook', 'CBSER002');
  PERFORM public.chromebook_record_ownership(rec2, 'District', 'PO-9');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.chromebook_reset_step(rec2, 'authorize', NULL, 'CBSER002', NULL);
  PERFORM public.chromebook_reset_step(rec2, 'start', 'powerwash', NULL, NULL);
  -- 7. interrupted workflow keeps history
  PERFORM public.chromebook_reset_step(rec2, 'fail', NULL, NULL, 'Battery died mid-reset');
  SELECT count(*) INTO n FROM public.chromebook_events WHERE record_id = rec2;
  PERFORM public.chromebook_reset_step(rec2, 'authorize', NULL, 'CBSER002', NULL);
  PERFORM public.chromebook_reset_step(rec2, 'start', 'recovery_media', NULL, NULL);
  PERFORM public.chromebook_reset_step(rec2, 'complete');
  SELECT count(*) INTO n2 FROM public.chromebook_events WHERE record_id = rec2 AND step IN ('reset_fail');
  r := r || ' [interrupted_history_kept ' || CASE WHEN n = 5 AND n2 = 1 THEN 'PASS' ELSE 'FAIL ' || n || '/' || n2 END || ']';
  PERFORM public.chromebook_online_setup_check(rec2, true, true, 'Enterprise enrollment screen shown');
  PERFORM public.chromebook_record_diagnostics(rec2, diag, NULL);
  SELECT management_status INTO m FROM public.chromebook_records WHERE id = rec2;
  BEGIN
    PERFORM public.chromebook_review(rec2, 'resale_ready', NULL);
    r := r || ' [enrollment_prompt_blocks_resale FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [enrollment_prompt_blocks_resale ' || CASE WHEN m = 'blocked' THEN 'PASS' ELSE 'FAIL ' || m END || ']'; END;
  BEGIN
    UPDATE public.chromebook_events SET notes = 'edited' WHERE record_id = rec2;
    DELETE FROM public.chromebook_events WHERE record_id = rec2;
    SELECT count(*) INTO n FROM public.chromebook_events WHERE record_id = rec2;
    r := r || ' [events_append_only ' || CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  EXCEPTION WHEN others THEN r := r || ' [events_append_only PASS]'; END;

  -- 8. synthetic stays synthetic, can never be resale-ready
  INSERT INTO public.devices(org_id, asset_tag, manufacturer, system_serial, hardware_origin)
    VALUES (oa, 'CB-SYN', 'HP', 'SYNCB01', 'synthetic') RETURNING id INTO dsyn;
  rsyn := public.chromebook_start_for_device(dsyn);
  PERFORM public.chromebook_record_ownership(rsyn, 'Test', 'T-1');
  PERFORM public.chromebook_set_management(rsyn, 'owner_reported_never_managed', 'Test fixture');
  PERFORM public.chromebook_reset_step(rsyn, 'authorize', NULL, 'SYNCB01', NULL);
  PERFORM public.chromebook_reset_step(rsyn, 'start', 'powerwash', NULL, NULL);
  PERFORM public.chromebook_reset_step(rsyn, 'complete');
  PERFORM public.chromebook_reset_step(rsyn, 'evidence', NULL, NULL, 'test');
  PERFORM public.chromebook_online_setup_check(rsyn, true, false, 'test');
  PERFORM public.chromebook_record_diagnostics(rsyn, diag, NULL);
  BEGIN
    PERFORM public.chromebook_review(rsyn, 'resale_ready', NULL);
    r := r || ' [synthetic_never_resale FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [synthetic_never_resale PASS]'; END;
  SELECT count(*) INTO n FROM public.chromebook_events WHERE record_id = rsyn AND NOT is_synthetic;
  r := r || ' [synthetic_events_stay_synthetic ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- 9. Chromebooks never get drive-erasure jobs
  pol := public.create_policy(oa, 'Std', null, '{"allowed_manufacturers":["HP"],"allowed_interfaces":["nvme_ssd"],"allowed_methods":["nvme_sanitize_crypto"],"verification_method":"full_read"}');
  SELECT device_id INTO dev FROM public.chromebook_records WHERE id = rec;
  INSERT INTO public.drives(org_id, serial, interface) VALUES (oa, 'CBDRV1', 'nvme_ssd') RETURNING id INTO drv;
  INSERT INTO public.device_drive_associations(org_id, device_id, drive_id) VALUES (oa, dev, drv);
  BEGIN
    j := public.create_job(dev, drv, pol);
    r := r || ' [chromebook_no_erasure_job FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [chromebook_no_erasure_job PASS]'; END;

  -- 10. tenant isolation: other org cannot read or act
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated','aal','aal2')::text, true);
  SELECT count(*) INTO n FROM public.chromebook_records WHERE org_id = oa;
  SELECT count(*) INTO n2 FROM public.chromebook_events WHERE org_id = oa;
  r := r || ' [other_org_cannot_read ' || CASE WHEN n = 0 AND n2 = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM public.chromebook_review(rec2, 'quarantined', 'hostile');
    r := r || ' [other_org_cannot_act FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [other_org_cannot_act PASS]'; END;

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
