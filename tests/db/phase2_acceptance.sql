-- NexWipe Phase 2 database acceptance checks (policies, jobs, authorizations, agent API RPCs).
-- Sessions are simulated at AAL2 (two-step verified) so owner/admin rights apply; see phase2b_security.sql for AAL1 checks.
-- Single DO block; always ends with RAISE so everything rolls back. Every item must read PASS.
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid(); uau uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  oa uuid; dev uuid; dev2 uuid; d1 uuid; d2 uuid; d3 uuid; pol uuid; pv1 uuid; j1 uuid; j2 uuid; j3 uuid;
  tok text; cred text; cred2 text; ag uuid; ag2 uuid; auth1 uuid; auth2 uuid; auth3 uuid;
  res jsonb; sim jsonb; simjob uuid; n int; ok boolean; st text; r text := '';
  ev_sha text := encode(extensions.digest(convert_to('verification log', 'UTF8'), 'sha256'), 'hex');
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'p2a@test.local', now(), 'authenticated','authenticated'),
    (ut, 'p2t@test.local', now(), 'authenticated','authenticated'),
    (uau, 'p2au@test.local', now(), 'authenticated','authenticated'),
    (ub, 'p2b@test.local', now(), 'authenticated','authenticated');

  -- Owner A sets up org, team, a two-drive laptop and a policy
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  oa := public.create_organization('P2 Company A', 'p2-a-' || substr(ua::text,1,8));
  tok := public.create_invitation(oa, 'p2t@test.local', 'technician');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.accept_invitation(tok);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_invitation(oa, 'p2au@test.local', 'auditor');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uau, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.accept_invitation(tok);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  INSERT INTO public.devices(org_id, asset_tag, manufacturer, system_serial, is_simulated) VALUES (oa, 'A-1', 'Dell', 'SYS-1', true) RETURNING id INTO dev;
  SELECT is_simulated INTO ok FROM public.devices WHERE id = dev;
  r := r || ' [browser_cannot_mark_simulated ' || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ']';
  INSERT INTO public.drives(org_id, serial, interface) VALUES (oa, 'DRV-ONE', 'nvme_ssd') RETURNING id INTO d1;
  INSERT INTO public.drives(org_id, serial, interface) VALUES (oa, 'DRV-TWO', 'sata_ssd') RETURNING id INTO d2;
  INSERT INTO public.device_drive_associations(org_id, device_id, drive_id) VALUES (oa, dev, d1), (oa, dev, d2);

  BEGIN
    PERFORM public.create_policy(oa, 'Tech policy', null, '{"allowed_manufacturers":["Dell"],"allowed_interfaces":["nvme_ssd"],"allowed_methods":["nvme_sanitize_crypto"]}');
    r := r || ' [tech_cannot_create_policy FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [tech_cannot_create_policy PASS]'; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  pol := public.create_policy(oa, 'Standard', 'test', '{"allowed_manufacturers":["Dell","HP","Lenovo"],"allowed_interfaces":["nvme_ssd","sata_ssd"],"allowed_methods":["nvme_sanitize_crypto","ata_sanitize_crypto"],"verification_method":"full_read","reviewer_roles":["owner","admin"],"require_separate_reviewer":true}');
  SELECT id INTO pv1 FROM public.policy_versions WHERE policy_id = pol AND version = 1;
  BEGIN
    UPDATE public.policy_versions SET verification_method = 'sample_read' WHERE id = pv1;
    r := r || ' [policy_version_immutable FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [policy_version_immutable PASS]'; END;
  BEGIN
    PERFORM public.create_policy(oa, 'Bad', null, '{"allowed_manufacturers":["Dell"],"allowed_interfaces":["nvme_ssd"],"allowed_methods":["overwrite_single_pass"]}');
    r := r || ' [policy_rejects_mismatched_method FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [policy_rejects_mismatched_method PASS]'; END;

  -- Technician creates jobs
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  j1 := public.create_job(dev, d1, pol); PERFORM public.submit_job(j1);
  j2 := public.create_job(dev, d2, pol); PERFORM public.submit_job(j2);
  BEGIN
    PERFORM public.create_job(dev, d1, pol);
    r := r || ' [one_open_job_per_drive FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [one_open_job_per_drive PASS]'; END;

  -- New policy version does not change existing job's version
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.create_policy_version(pol, '{"allowed_manufacturers":["Dell","Lenovo"],"allowed_interfaces":["nvme_ssd","sata_ssd"],"allowed_methods":["nvme_sanitize_block","ata_sanitize_crypto"]}', 'v2');
  SELECT policy_version_id = pv1 INTO ok FROM public.jobs WHERE id = j1;
  r := r || ' [job_keeps_policy_version ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Org isolation
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.create_organization('P2 Company B', 'p2-b-' || substr(ub::text,1,8));
  SELECT (SELECT count(*) FROM public.jobs WHERE org_id = oa) + (SELECT count(*) FROM public.policies WHERE org_id = oa)
       + (SELECT count(*) FROM public.job_events WHERE org_id = oa) + (SELECT count(*) FROM public.policy_versions WHERE org_id = oa) INTO n;
  r := r || ' [b_cannot_read_a_jobs_policies ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM public.create_job(dev, d1, pol);
    r := r || ' [b_cannot_create_job_in_a FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [b_cannot_create_job_in_a PASS]'; END;

  -- Enrollment
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(oa, 'Bench 1', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_enroll(tok, 'Bench 1', '0.0.1', 'test', 'bench1');
  cred := res->>'credential'; ag := (res->>'agent_id')::uuid;
  -- Stations enroll read-only; job tests need a lab station that trusted server code (service role) has unlocked.
  UPDATE public.agents SET read_only = false WHERE id = ag;
  BEGIN
    PERFORM public.agent_enroll(tok, 'Again', null, null, null);
    r := r || ' [enrollment_token_single_use FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [enrollment_token_single_use PASS]'; END;
  PERFORM set_config('role', 'authenticated', true);

  -- Authorization: role + confirmation
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uau, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    PERFORM public.authorize_job(j1, ag, 'A-1', 'DRV-ONE');
    r := r || ' [auditor_cannot_authorize FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [auditor_cannot_authorize PASS]'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    PERFORM public.authorize_job(j1, ag, 'A-1', 'DRV-WRONG');
    r := r || ' [authorization_requires_matching_target FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [authorization_requires_matching_target PASS]'; END;
  BEGIN
    UPDATE public.jobs SET status = 'approved' WHERE id = j1;
    r := r || ' [browser_cannot_update_jobs FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [browser_cannot_update_jobs PASS]'; END;
  auth1 := public.authorize_job(j1, ag, 'a-1', 'drv-one');
  auth2 := public.authorize_job(j2, ag, 'A-1', 'DRV-TWO');

  -- Agent side
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  PERFORM public.agent_authenticate(cred, 'nonce-aaaaaaaaaaaaaaaa', now());
  BEGIN
    PERFORM public.agent_authenticate(cred, 'nonce-aaaaaaaaaaaaaaaa', now());
    r := r || ' [nonce_replay_rejected FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [nonce_replay_rejected PASS]'; END;
  BEGIN
    PERFORM public.agent_authenticate(cred, 'nonce-bbbbbbbbbbbbbbbb', now() - interval '10 minutes');
    r := r || ' [stale_timestamp_rejected FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [stale_timestamp_rejected PASS]'; END;
  BEGIN
    PERFORM public.agent_job_event(ag, j1, 'ack', 1, 'ack-j1-0001', jsonb_build_object('authorization_id', auth1,
      'observed', jsonb_build_object('drive_serial','DRV-ONE','system_serial','SYS-1'),
      'local_confirmation', jsonb_build_object('confirmed', true, 'typed_serial_suffix', 'XXXX')), now());
    r := r || ' [local_confirmation_enforced FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [local_confirmation_enforced PASS]'; END;
  res := public.agent_job_event(ag, j1, 'ack', 1, 'ack-j1-0001', jsonb_build_object('authorization_id', auth1,
    'observed', jsonb_build_object('drive_serial','DRV-ONE','system_serial','SYS-1'),
    'local_confirmation', jsonb_build_object('confirmed', true, 'typed_serial_suffix', '-ONE')), now());
  r := r || ' [ack_starts_running ' || CASE WHEN res->>'job_status' = 'running' THEN 'PASS' ELSE 'FAIL' END || ']';
  res := public.agent_job_event(ag, j1, 'ack', 1, 'ack-j1-0001', jsonb_build_object('authorization_id', auth1,
    'observed', jsonb_build_object('drive_serial','DRV-ONE','system_serial','SYS-1'),
    'local_confirmation', jsonb_build_object('confirmed', true, 'typed_serial_suffix', '-ONE')), now());
  SELECT count(*) INTO n FROM public.job_events WHERE job_id = j1 AND event_type = 'ack';
  r := r || ' [duplicate_event_idempotent ' || CASE WHEN (res->>'duplicate')::boolean AND n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM public.agent_job_event(ag, j1, 'ack', 2, 'ack-j1-0002', jsonb_build_object('authorization_id', auth1,
      'observed', jsonb_build_object('drive_serial','DRV-ONE','system_serial','SYS-1'),
      'local_confirmation', jsonb_build_object('confirmed', true, 'typed_serial_suffix', '-ONE')), now());
    r := r || ' [authorization_reuse_blocked FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [authorization_reuse_blocked PASS]'; END;
  BEGIN
    PERFORM public.agent_job_event(ag, j1, 'progress', 5, 'prog-j1-0005', '{"phase":"x"}', now());
    r := r || ' [sequence_gap_rejected FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [sequence_gap_rejected PASS]'; END;
  BEGIN
    PERFORM public.agent_job_event(ag, j1, 'verification_result', 2, 'ver-j1-early', '{"outcome":"passed","method":"full_read"}', now());
    r := r || ' [invalid_transition_rejected FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [invalid_transition_rejected PASS]'; END;
  PERFORM public.agent_job_event(ag, j1, 'execution_result', 2, 'exe-j1-0002', '{"outcome":"succeeded","method":"nvme_sanitize_crypto"}', now());
  BEGIN
    PERFORM public.agent_job_event(ag, j1, 'verification_result', 3, 'ver-j1-0003', '{"outcome":"passed","method":"full_read"}', now());
    r := r || ' [evidence_required FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [evidence_required PASS]'; END;
  BEGIN
    PERFORM public.agent_upload_evidence(ag, j1, 'evi-j1-0001', 'verification_log', 'v.log', 'text/plain', 'verification log', repeat('0', 64));
    r := r || ' [evidence_hash_checked FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [evidence_hash_checked PASS]'; END;
  PERFORM public.agent_upload_evidence(ag, j1, 'evi-j1-0001', 'verification_log', 'v.log', 'text/plain', 'verification log', ev_sha);
  res := public.agent_job_event(ag, j1, 'verification_result', 3, 'ver-j1-0003', '{"outcome":"passed","method":"full_read"}', now());
  r := r || ' [verified_job_awaits_reviewer ' || CASE WHEN res->>'job_status' = 'awaiting_validation' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Second drive fails execution -> quarantined per policy
  PERFORM public.agent_job_event(ag, j2, 'ack', 1, 'ack-j2-0001', jsonb_build_object('authorization_id', auth2,
    'observed', jsonb_build_object('drive_serial','DRV-TWO','system_serial','SYS-1'),
    'local_confirmation', jsonb_build_object('confirmed', true, 'typed_serial_suffix', '-TWO')), now());
  res := public.agent_job_event(ag, j2, 'execution_result', 2, 'exe-j2-0002', '{"outcome":"failed","method":"ata_sanitize_crypto","detail":{"error":"sanitize aborted"}}', now());
  r := r || ' [execution_failure_quarantined ' || CASE WHEN res->>'job_status' = 'quarantined' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Review
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    PERFORM public.review_job(j1, true, 'ok');
    r := r || ' [technician_cannot_approve FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [technician_cannot_approve PASS]'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.review_job(j1, true, 'Evidence reviewed');
  SELECT status::text INTO st FROM public.jobs WHERE id = j1;
  r := r || ' [owner_approves ' || CASE WHEN st = 'approved' THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT billable_unit INTO ok FROM public.jobs WHERE id = j1;
  r := r || ' [approved_real_job_billable ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Multi-drive laptop: one failed drive blocks "processed"
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    UPDATE public.devices SET status = 'processed' WHERE id = dev;
    r := r || ' [failed_drive_blocks_processed FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [failed_drive_blocks_processed PASS]'; END;
  SELECT status::text INTO st FROM public.devices WHERE id = dev;
  r := r || ' [device_quarantined_by_failed_drive ' || CASE WHEN st = 'quarantined' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Identity mismatch on a second laptop
  INSERT INTO public.devices(org_id, asset_tag, manufacturer, system_serial) VALUES (oa, 'A-2', 'Lenovo', 'SYS-2') RETURNING id INTO dev2;
  INSERT INTO public.drives(org_id, serial, interface) VALUES (oa, 'DRV-THREE', 'nvme_ssd') RETURNING id INTO d3;
  INSERT INTO public.device_drive_associations(org_id, device_id, drive_id) VALUES (oa, dev2, d3);
  j3 := public.create_job(dev2, d3, pol); PERFORM public.submit_job(j3);
  auth3 := public.authorize_job(j3, ag, 'A-2', 'DRV-THREE');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_job_event(ag, j3, 'ack', 1, 'ack-j3-0001', jsonb_build_object('authorization_id', auth3,
    'observed', jsonb_build_object('drive_serial','SOMETHING-ELSE','system_serial','SYS-2'),
    'local_confirmation', jsonb_build_object('confirmed', true, 'typed_serial_suffix', 'HREE')), now());
  SELECT status::text INTO st FROM public.jobs WHERE id = j3;
  r := r || ' [identity_mismatch_blocks ' || CASE WHEN res->>'error' = 'drive_identity_mismatch' AND st = 'quarantined' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Stale heartbeat => interrupted, never success
  PERFORM set_config('role', me, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(oa, 'Bench 2', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_enroll(tok, 'Bench 2', null, null, null); cred2 := res->>'credential'; ag2 := (res->>'agent_id')::uuid;
  UPDATE public.agents SET read_only = false WHERE id = ag2;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  -- New job on drive two of laptop A-1 (previous job is closed)
  j2 := public.create_job(dev, d2, pol); PERFORM public.submit_job(j2);
  auth2 := public.authorize_job(j2, ag2, 'A-1', 'DRV-TWO');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  PERFORM public.agent_job_event(ag2, j2, 'ack', 1, 'ack-j2b-001', jsonb_build_object('authorization_id', auth2,
    'observed', jsonb_build_object('drive_serial','DRV-TWO','system_serial','SYS-1'),
    'local_confirmation', jsonb_build_object('confirmed', true, 'typed_serial_suffix', '-TWO')), now());
  UPDATE public.agents SET last_heartbeat_at = now() - interval '10 minutes' WHERE id = ag2;
  UPDATE public.jobs SET last_event_at = now() - interval '10 minutes' WHERE id = j2;
  PERFORM public._sweep_jobs(oa);
  SELECT status::text INTO st FROM public.jobs WHERE id = j2;
  r := r || ' [lost_heartbeat_interrupts ' || CASE WHEN st = 'interrupted' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Revoked agent
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.revoke_agent(ag, 'test');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  BEGIN
    PERFORM public.agent_authenticate(cred, 'nonce-cccccccccccccccc', now());
    r := r || ' [revoked_agent_rejected FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [revoked_agent_rejected PASS]'; END;

  -- Simulated jobs: never billable, never on a real agent
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  sim := public.simulator_prepare(oa, 'success');
  SELECT is_simulated INTO ok FROM public.devices WHERE id = (sim->>'device_id')::uuid;
  r := r || ' [simulator_device_labelled ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';
  simjob := public.create_job((sim->>'device_id')::uuid, (sim->'drives'->0->>'drive_id')::uuid, (sim->>'policy_id')::uuid);
  PERFORM public.submit_job(simjob);
  BEGIN
    PERFORM public.authorize_job(simjob, ag2, sim->>'asset_tag', sim->'drives'->0->>'serial');
    r := r || ' [real_agent_cannot_run_simulated FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [real_agent_cannot_run_simulated PASS]'; END;
  BEGIN
    PERFORM public.create_job(dev2, d3, (sim->>'policy_id')::uuid);
    r := r || ' [simulator_policy_not_for_real FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [simulator_policy_not_for_real PASS]'; END;
  SELECT is_simulated AND NOT billable_unit AND NOT certificate_eligible INTO ok FROM public.jobs WHERE id = simjob;
  r := r || ' [simulated_job_not_billable ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Append-only
  BEGIN
    UPDATE public.job_events SET message = 'x' WHERE job_id = j1;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := r || ' [job_events_append_only ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  EXCEPTION WHEN others THEN r := r || ' [job_events_append_only PASS]'; END;

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
