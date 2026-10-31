-- NexWipe Phase 2c checks: read-only test stations, credential expiry/rotation, duplicate-free
-- discovery, review flags, record separation. Single DO block; always rolls back.
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid();
  oa uuid; dev uuid; d1 uuid; pol uuid; j1 uuid; tok text; res jsonb; ag uuid; cred text; cred2 text; cid uuid;
  disc uuid; n int; ok boolean; r text := ''; sim jsonb; simag uuid;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'p2ca@test.local', now(), 'authenticated','authenticated'), (ut, 'p2ct@test.local', now(), 'authenticated','authenticated');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  oa := public.create_organization('P2C A', 'p2c-a-' || substr(ua::text,1,8));
  tok := public.create_invitation(oa, 'p2ct@test.local', 'technician');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.accept_invitation(tok);
  INSERT INTO public.devices(org_id, asset_tag, manufacturer, system_serial) VALUES (oa, 'C-1', 'Dell', 'SYS-C1') RETURNING id INTO dev;
  INSERT INTO public.drives(org_id, serial, interface) VALUES (oa, 'DRV-C1', 'nvme_ssd') RETURNING id INTO d1;
  INSERT INTO public.device_drive_associations(org_id, device_id, drive_id) VALUES (oa, dev, d1);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  pol := public.create_policy(oa, 'Std', null, '{"allowed_manufacturers":["Dell"],"allowed_interfaces":["nvme_ssd"],"allowed_methods":["nvme_sanitize_crypto"],"verification_method":"full_read"}');
  tok := public.create_enrollment_token(oa, 'Read-only bench', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_enroll(tok, 'Read-only bench', null, null, null); ag := (res->>'agent_id')::uuid; cred := res->>'credential';
  SELECT read_only INTO ok FROM public.agents WHERE id = ag;
  r := r || ' [physical_station_enrolls_read_only ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Read-only station can never be authorized, so no erasure record or billable job can come from it.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  j1 := public.create_job(dev, d1, pol); PERFORM public.submit_job(j1);
  BEGIN
    PERFORM public.authorize_job(j1, ag, 'C-1', 'DRV-C1');
    r := r || ' [read_only_station_cannot_be_authorized FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [read_only_station_cannot_be_authorized PASS]'; END;
  BEGIN
    UPDATE public.agents SET read_only = false WHERE id = ag;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := r || ' [browser_cannot_unlock_station ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  EXCEPTION WHEN others THEN r := r || ' [browser_cannot_unlock_station PASS]'; END;
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  BEGIN
    INSERT INTO public.evidence_objects(org_id, job_id, agent_id, kind, filename, content_type, size_bytes, sha256, content, is_simulated, idempotency_key)
    VALUES (oa, j1, ag, 'other', 'x', 'text/plain', 1, repeat('a',64), 'x', false, 'evi-ro-000001');
    r := r || ' [read_only_station_evidence_blocked FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [read_only_station_evidence_blocked PASS]'; END;
  SELECT count(*) INTO n FROM public.jobs WHERE agent_id = ag;
  r := r || ' [no_jobs_bound_to_read_only_station ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Simulated stations stay separate and are never read-only test stations.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  sim := public.simulator_prepare(oa, 'success');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  simag := (public.agent_enroll(sim->>'enrollment_token', 'sim', null, null, null)->>'agent_id')::uuid;
  SELECT is_simulated AND NOT read_only INTO ok FROM public.agents WHERE id = simag;
  r := r || ' [simulator_station_not_read_only ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Discovery: repeated reports update one record; flags recorded.
  res := public.agent_report_inventory(ag, '{"system":{"manufacturer":"Dell Inc.","model":"Latitude","serial":"NEW-C9"},"drives":[{"serial":"NV-C9","interface":"nvme_ssd"},{"serial":"NV-C9","interface":"sata_ssd"},{"interface":"sata_hdd","bus_path":"pci-0000:00:17.0-ata-2"}],"review_flags":[{"code":"boot_medium_not_identified"}]}');
  disc := (res->>'discovery_id')::uuid;
  PERFORM public.agent_report_inventory(ag, '{"system":{"manufacturer":"Dell Inc.","model":"Latitude","serial":"NEW-C9"},"drives":[{"serial":"NV-C9","interface":"nvme_ssd"}]}');
  PERFORM public.agent_report_inventory(ag, '{"system":{"manufacturer":"Dell Inc.","model":"Latitude","serial":"NEW-C9"},"drives":[{"serial":"NV-C9","interface":"nvme_ssd"}]}');
  SELECT count(*) INTO n FROM public.agent_discoveries WHERE agent_id = ag AND system_serial = 'NEW-C9';
  SELECT report_count = 3 INTO ok FROM public.agent_discoveries WHERE id = disc;
  r := r || ' [restart_reports_do_not_duplicate ' || CASE WHEN n = 1 AND ok THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT is_read_only_test INTO ok FROM public.agent_discoveries WHERE id = disc;
  r := r || ' [discovery_marked_read_only_test ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT (res->'review_flags') @> '[{"code":"duplicate_drive_serial"}]' AND (res->'review_flags') @> '[{"code":"drive_serial_missing"}]'
     AND (res->'review_flags') @> '[{"code":"boot_medium_not_identified"}]' INTO ok;
  r := r || ' [review_flags_recorded ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';
  res := public.agent_report_inventory(ag, '{"system":{"manufacturer":"Dell Inc."},"drives":[]}');
  SELECT (res->'review_flags') @> '[{"code":"system_serial_missing"}]' INTO ok;
  r := r || ' [missing_system_serial_accepted_and_flagged ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';
  res := public.agent_report_inventory(ag, '{"system":{"serial":"OTHER-SYS"},"drives":[{"serial":"DRV-C1","interface":"nvme_ssd"}]}');
  SELECT (res->'review_flags') @> '[{"code":"drive_attached_to_other_device","target":"DRV-C1"}]' INTO ok;
  r := r || ' [drive_in_other_laptop_flagged ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Credential expiry and rotation
  res := public.agent_authenticate(cred, 'nonce-rot-0000000001', now()); cid := (res->>'credential_id')::uuid;
  r := r || ' [auth_reports_expiry ' || CASE WHEN res->>'credential_expires_at' IS NOT NULL AND (res->>'read_only')::boolean THEN 'PASS' ELSE 'FAIL' END || ']';
  res := public.agent_rotate_credential(ag, cid); cred2 := res->>'credential';
  PERFORM public.agent_authenticate(cred2, 'nonce-rot-0000000002', now());
  r := r || ' [rotated_credential_works PASS]';
  PERFORM public.agent_authenticate(cred, 'nonce-rot-0000000003', now());
  r := r || ' [old_credential_valid_during_grace PASS]';
  BEGIN
    PERFORM public.agent_rotate_credential(ag, cid);
    r := r || ' [old_credential_cannot_rotate_again FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [old_credential_cannot_rotate_again PASS]'; END;
  UPDATE public.agent_credentials SET expires_at = now() - interval '1 second' WHERE id = cid;
  BEGIN
    PERFORM public.agent_authenticate(cred, 'nonce-rot-0000000004', now());
    r := r || ' [expired_credential_rejected FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [expired_credential_rejected PASS]'; END;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.revoke_agent(ag, 'test');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  BEGIN
    PERFORM public.agent_authenticate(cred2, 'nonce-rot-0000000005', now());
    r := r || ' [revocation_kills_rotated_credential FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [revocation_kills_rotated_credential PASS]'; END;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  BEGIN
    PERFORM 1 FROM public.agent_credentials LIMIT 1;
    r := r || ' [credentials_unreadable FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [credentials_unreadable PASS]'; END;

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
