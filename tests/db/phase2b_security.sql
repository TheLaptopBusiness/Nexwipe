-- NextDrive Phase 2b security checks: server-side MFA, tenant isolation on agent endpoints/jobs/evidence,
-- revocation, discovery intake. Single DO block; always ends with RAISE so everything rolls back.
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  oa uuid; ob uuid; dev uuid; d1 uuid; pol uuid; j1 uuid; tok text; res jsonb;
  ag_a uuid; ag_b uuid; cred_b text; auth1 uuid; disc uuid; dev_new uuid; sim jsonb; sim_disc uuid;
  n int; ok boolean; st text; r text := '';
  ev_sha text := encode(extensions.digest(convert_to('log', 'UTF8'), 'sha256'), 'hex');
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'p2ba@test.local', now(), 'authenticated','authenticated'),
    (ut, 'p2bt@test.local', now(), 'authenticated','authenticated'),
    (ub, 'p2bb@test.local', now(), 'authenticated','authenticated');

  -- ===== MFA (AAL2) enforcement =====
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  oa := public.create_organization('P2B A', 'p2b-a-' || substr(ua::text,1,8));
  tok := public.create_invitation(oa, 'p2bt@test.local', 'technician');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.accept_invitation(tok);
  INSERT INTO public.devices(org_id, asset_tag, manufacturer, system_serial) VALUES (oa, 'A-1', 'Dell', 'SYS-A1') RETURNING id INTO dev;
  r := r || ' [technician_works_without_mfa PASS]';
  INSERT INTO public.drives(org_id, serial, interface) VALUES (oa, 'DRV-A1', 'nvme_ssd') RETURNING id INTO d1;
  INSERT INTO public.device_drive_associations(org_id, device_id, drive_id) VALUES (oa, dev, d1);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal1')::text, true);
  SELECT count(*) INTO n FROM public.organizations WHERE id = oa;
  r := r || ' [aal1_owner_sees_own_org_row ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT count(*) INTO n FROM public.memberships WHERE org_id = oa AND user_id = ua;
  r := r || ' [aal1_owner_sees_own_membership ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT count(*) INTO n FROM public.devices WHERE org_id = oa;
  r := r || ' [aal1_owner_cannot_read_inventory ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM public.create_invitation(oa, 'x@test.local', 'admin');
    r := r || ' [aal1_owner_cannot_invite FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [aal1_owner_cannot_invite PASS]'; END;
  BEGIN
    PERFORM public.create_enrollment_token(oa, 'x', null, 1);
    r := r || ' [aal1_owner_cannot_enroll_station FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [aal1_owner_cannot_enroll_station PASS]'; END;
  BEGIN
    PERFORM public.create_policy(oa, 'P', null, '{"allowed_manufacturers":["Dell"],"allowed_interfaces":["nvme_ssd"],"allowed_methods":["nvme_sanitize_crypto"]}');
    r := r || ' [aal1_owner_cannot_create_policy FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [aal1_owner_cannot_create_policy PASS]'; END;
  UPDATE public.organizations SET name = 'renamed' WHERE id = oa; GET DIAGNOSTICS n = ROW_COUNT;
  r := r || ' [aal1_owner_cannot_change_settings ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  SELECT count(*) INTO n FROM public.devices WHERE org_id = oa;
  r := r || ' [missing_aal_claim_treated_as_aal1 ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  SELECT count(*) INTO n FROM public.devices WHERE org_id = oa;
  r := r || ' [aal2_owner_reads_inventory ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  pol := public.create_policy(oa, 'Std', null, '{"allowed_manufacturers":["Dell"],"allowed_interfaces":["nvme_ssd"],"allowed_methods":["nvme_sanitize_crypto"],"verification_method":"full_read"}');
  tok := public.create_enrollment_token(oa, 'Bench A', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  ag_a := (public.agent_enroll(tok, 'Bench A', null, null, null)->>'agent_id')::uuid;

  -- Org B with its own station
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated','aal','aal2')::text, true);
  ob := public.create_organization('P2B B', 'p2b-b-' || substr(ub::text,1,8));
  tok := public.create_enrollment_token(ob, 'Bench B', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_enroll(tok, 'Bench B', null, null, null); ag_b := (res->>'agent_id')::uuid; cred_b := res->>'credential';

  -- A job in org A authorized for station A
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  j1 := public.create_job(dev, d1, pol); PERFORM public.submit_job(j1);
  BEGIN
    PERFORM public.authorize_job(j1, ag_b, 'A-1', 'DRV-A1');
    r := r || ' [cannot_authorize_other_org_station FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [cannot_authorize_other_org_station PASS]'; END;
  auth1 := public.authorize_job(j1, ag_a, 'A-1', 'DRV-A1');

  -- ===== Agent endpoint isolation =====
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_list_jobs(ag_b);
  r := r || ' [other_station_lists_no_jobs ' || CASE WHEN jsonb_array_length(res) = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM public.agent_job_event(ag_b, j1, 'ack', 1, 'ack-b-000001', jsonb_build_object('authorization_id', auth1,
      'observed', jsonb_build_object('drive_serial','DRV-A1','system_serial','SYS-A1'),
      'local_confirmation', jsonb_build_object('confirmed', true, 'typed_serial_suffix', '-A1')), now());
    r := r || ' [other_station_cannot_ack FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [other_station_cannot_ack PASS]'; END;
  BEGIN
    PERFORM public.agent_upload_evidence(ag_b, j1, 'evi-b-000001', 'other', 'x.log', 'text/plain', 'log', ev_sha);
    r := r || ' [other_station_cannot_upload_evidence FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [other_station_cannot_upload_evidence PASS]'; END;
  res := public.agent_reconcile(ag_b, jsonb_build_array(jsonb_build_object('job_id', j1, 'agent_last_seq', 0)));
  r := r || ' [other_station_reconcile_reveals_nothing ' || CASE WHEN coalesce(res->'jobs'->0->>'instruction','stop') IN ('stop','unknown') OR jsonb_array_length(coalesce(res->'jobs','[]'::jsonb)) = 0 THEN 'PASS' ELSE 'FAIL:' || res::text END || ']';
  res := public.agent_report_inventory(ag_b, '{"system":{"serial":"SYS-A1"},"drives":[{"serial":"DRV-A1","interface":"nvme_ssd"}]}');
  r := r || ' [other_org_inventory_does_not_match ' || CASE WHEN res->>'device_id' IS NULL AND res->'drives'->0->>'drive_id' IS NULL THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Station A acks and uploads evidence; org B user cannot read any of it
  PERFORM public.agent_job_event(ag_a, j1, 'ack', 1, 'ack-a-000001', jsonb_build_object('authorization_id', auth1,
    'observed', jsonb_build_object('drive_serial','DRV-A1','system_serial','SYS-A1'),
    'local_confirmation', jsonb_build_object('confirmed', true, 'typed_serial_suffix', '-A1')), now());
  PERFORM public.agent_upload_evidence(ag_a, j1, 'evi-a-000001', 'execution_log', 'x.log', 'text/plain', 'log', ev_sha);
  res := public.agent_upload_evidence(ag_a, j1, 'evi-a-000001', 'execution_log', 'x.log', 'text/plain', 'log', ev_sha);
  SELECT count(*) INTO n FROM public.evidence_objects WHERE job_id = j1;
  r := r || ' [duplicate_evidence_idempotent ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM public.agent_job_event(ag_a, j1, 'progress', 2, 'ack-a-000001', '{"phase":"x"}', now());
    r := r || ' [idempotency_key_reuse_with_other_body_rejected FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [idempotency_key_reuse_with_other_body_rejected PASS]'; END;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated','aal','aal2')::text, true);
  SELECT (SELECT count(*) FROM public.evidence_objects WHERE org_id = oa) + (SELECT count(*) FROM public.job_events WHERE org_id = oa)
       + (SELECT count(*) FROM public.job_authorizations WHERE org_id = oa) + (SELECT count(*) FROM public.agents WHERE org_id = oa)
       + (SELECT count(*) FROM public.enrollment_tokens WHERE org_id = oa) + (SELECT count(*) FROM public.agent_discoveries WHERE org_id = oa)
       + (SELECT count(*) FROM public.jobs WHERE org_id = oa) INTO n;
  r := r || ' [b_reads_nothing_of_a_jobs_evidence_stations ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM 1 FROM public.agent_credentials LIMIT 1;
    r := r || ' [credential_hashes_unreadable FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [credential_hashes_unreadable PASS]'; END;
  BEGIN
    PERFORM public.agent_heartbeat(ag_a, 'idle', null);
    r := r || ' [browser_cannot_call_agent_rpcs FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [browser_cannot_call_agent_rpcs PASS]'; END;
  SELECT count(*) INTO n FROM storage.buckets;
  r := r || ' [no_storage_buckets_exposed ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'REVIEW(' || n || ' buckets)' END || ']';

  -- ===== Discovery intake (read-only milestone) =====
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_report_inventory(ag_a, '{"system":{"manufacturer":"Lenovo","model":"ThinkPad T14","serial":"NEW-SYS-9"},"drives":[{"serial":"NEW-DRV-9","model":"WD SN740","interface":"nvme_ssd","capacity_bytes":512110190592}]}');
  disc := (res->>'discovery_id')::uuid;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    PERFORM public.create_device_from_discovery(disc, 'STEAL-1');
    r := r || ' [other_org_cannot_claim_discovery FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [other_org_cannot_claim_discovery PASS]'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  dev_new := public.create_device_from_discovery(disc, 'A-NEW-9');
  SELECT NOT hardware_verified INTO ok FROM public.devices WHERE id = dev_new;
  r := r || ' [intake_from_discovery_starts_unverified ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT count(*) INTO n FROM public.device_drive_associations WHERE device_id = dev_new AND detached_at IS NULL;
  r := r || ' [discovered_drive_attached ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM public.create_device_from_discovery(disc, 'A-NEW-10');
    r := r || ' [discovery_used_once FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [discovery_used_once PASS]'; END;
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_heartbeat(ag_a, 'idle', null);
  r := r || ' [heartbeat_requests_reinventory ' || CASE WHEN (res->>'inventory_requested')::boolean THEN 'PASS' ELSE 'FAIL' END || ']';
  PERFORM public.agent_report_inventory(ag_a, '{"system":{"serial":"NEW-SYS-9"},"drives":[{"serial":"NEW-DRV-9","interface":"nvme_ssd"}]}');
  SELECT hardware_verified AND source = 'agent_reported' INTO ok FROM public.devices WHERE id = dev_new;
  r := r || ' [re_report_marks_station_verified ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';
  res := public.agent_heartbeat(ag_a, 'idle', null);
  r := r || ' [reinventory_flag_cleared ' || CASE WHEN NOT (res->>'inventory_requested')::boolean THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Simulated discoveries never become real inventory
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  sim := public.simulator_prepare(oa, 'success');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_enroll(sim->>'enrollment_token', 'sim', null, null, null);
  res := public.agent_report_inventory((res->>'agent_id')::uuid, '{"system":{"serial":"SIM-ONLY-1"},"drives":[]}');
  sim_disc := (res->>'discovery_id')::uuid;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  BEGIN
    PERFORM public.create_device_from_discovery(sim_disc, 'SIM-TO-REAL');
    r := r || ' [simulated_discovery_not_real FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [simulated_discovery_not_real PASS]'; END;

  -- ===== Revocation =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.revoke_agent(ag_b, 'test');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  BEGIN
    PERFORM public.agent_authenticate(cred_b, 'nonce-revoked-000000', now());
    r := r || ' [revoked_credential_rejected FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [revoked_credential_rejected PASS]'; END;
  BEGIN
    PERFORM public.agent_report_inventory(ag_b, '{"system":{"serial":"x"}}');
    r := r || ' [revoked_station_cannot_report FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [revoked_station_cannot_report PASS]'; END;
  BEGIN
    PERFORM public.agent_heartbeat(ag_b, 'idle', null);
    r := r || ' [revoked_station_cannot_heartbeat FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [revoked_station_cannot_heartbeat PASS]'; END;

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
