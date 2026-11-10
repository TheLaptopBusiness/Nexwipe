-- NexWipe Phase 2i checks: agent-run diagnostics (keyboard test). Request from the app, exactly-once
-- delivery by heartbeat, result reported by the Windows helper, append-only results, and access rules.
-- Single DO block; always rolls back.
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid(); uau uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  oa uuid; ox uuid; tok text; res jsonb; hb jsonb; win uuid; lin uuid; winx uuid; st text; n int; r text := '';
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'p2ia@test.local', now(), 'authenticated','authenticated'), (ut, 'p2it@test.local', now(), 'authenticated','authenticated'),
    (uau, 'p2iau@test.local', now(), 'authenticated','authenticated'), (ux, 'p2ix@test.local', now(), 'authenticated','authenticated');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  ox := public.create_organization('P2I X', 'p2i-x-' || substr(ux::text,1,8));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  oa := public.create_organization('P2I A', 'p2i-a-' || substr(ua::text,1,8));
  tok := public.create_invitation(oa, 'p2it@test.local', 'technician');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.accept_invitation(tok);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_invitation(oa, 'p2iau@test.local', 'auditor');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uau, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.accept_invitation(tok);

  -- A Windows helper and a boot-stick station in company A, plus a Windows helper in company X.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(oa, 'Win stick A', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  win := (public.agent_enroll(tok, 'Win A', '0.1.0-win', 'windows 10.0.19045', 'LAP-A')->>'agent_id')::uuid;
  PERFORM public.agent_report_inventory(win, '{"system":{"manufacturer":"Dell Inc.","model":"Latitude 5490","serial":"P2I-SYS-1"},"station":{"hardware_source":"physical"},"drives":[]}');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(oa, 'Boot stick A', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  lin := (public.agent_enroll(tok, 'Boot A', '0.2.4', 'x86_64 6.12.107', 'nexwipe')->>'agent_id')::uuid;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(ox, 'Win stick X', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  winx := (public.agent_enroll(tok, 'Win X', '0.1.0-win', 'windows 10.0.19045', 'LAP-X')->>'agent_id')::uuid;

  -- ===== Request (technician, AAL2) =====
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  res := public.request_diagnostic(win, 'keyboard');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = win;
  r := r || ' [technician_requests ' || CASE WHEN res->>'test' = 'keyboard' AND st = 'requested' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Already in progress: a second request is refused.
  BEGIN PERFORM public.request_diagnostic(win, 'keyboard'); r := r || ' [no_double_request FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_double_request PASS]'; END;

  -- Unknown test is refused (on A's own station, so this fails on the test name, not on permission).
  BEGIN PERFORM public.request_diagnostic(win, 'display'); r := r || ' [unknown_test FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [unknown_test PASS]'; END;

  -- Boot-stick station (not the Windows helper) is refused.
  BEGIN PERFORM public.request_diagnostic(lin, 'keyboard'); r := r || ' [boot_stick_refused FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [boot_stick_refused PASS]'; END;

  -- Auditor cannot act.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uau, 'role','authenticated','aal','aal2')::text, true);
  BEGIN PERFORM public.request_diagnostic(win, 'keyboard'); r := r || ' [auditor_cannot FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [auditor_cannot PASS]'; END;

  -- Another company cannot act on A's station.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  BEGIN PERFORM public.request_diagnostic(win, 'keyboard'); r := r || ' [other_company_cannot FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [other_company_cannot PASS]'; END;

  -- ===== Delivery (heartbeat delivers exactly once) =====
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  hb := public.agent_heartbeat(win, 'idle', '0.1.0-win');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = win;
  r := r || ' [heartbeat_delivers ' || CASE WHEN (hb->>'diagnostic_requested')::boolean AND hb->>'diagnostic_test' = 'keyboard' AND st = 'delivered' THEN 'PASS' ELSE 'FAIL' END || ']';
  hb := public.agent_heartbeat(win, 'idle', '0.1.0-win');
  r := r || ' [delivered_only_once ' || CASE WHEN (hb->>'diagnostic_requested')::boolean IS FALSE THEN 'PASS' ELSE 'FAIL' END || ']';

  -- ===== Report =====
  res := public.agent_report_diagnostic(win, 'keyboard', 'pass', '{"layout":"ansi","keys_registered":["KEY_A","KEY_B"]}', 'all keys ok');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = win;
  SELECT count(*) INTO n FROM public.diagnostic_results WHERE agent_id = win AND test = 'keyboard' AND outcome = 'pass';
  r := r || ' [report_records_result ' || CASE WHEN res->>'outcome' = 'pass' AND st = 'done' AND n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- The result carries the laptop's stable device_code, resolved from its discovery.
  SELECT count(*) INTO n FROM public.diagnostic_results dr JOIN public.agent_discoveries ad ON ad.agent_id = dr.agent_id
    WHERE dr.agent_id = win AND dr.device_code = ad.device_code;
  r := r || ' [result_linked_to_device_code ' || CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Reporting again without a fresh delivery is refused.
  BEGIN PERFORM public.agent_report_diagnostic(win, 'keyboard', 'pass', '{}', null); r := r || ' [no_report_without_delivery FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_report_without_delivery PASS]'; END;

  -- ===== Append-only results =====
  BEGIN UPDATE public.diagnostic_results SET outcome = 'fail' WHERE agent_id = win; r := r || ' [results_no_update FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [results_no_update PASS]'; END;
  BEGIN DELETE FROM public.diagnostic_results WHERE agent_id = win; r := r || ' [results_no_delete FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [results_no_delete PASS]'; END;

  -- ===== Expiry (no heartbeat within 2 minutes) =====
  UPDATE public.agents SET diagnostic_status = 'requested', diagnostic_test = 'keyboard',
    diagnostic_status_at = now() - interval '3 minutes', diagnostic_requested_at = now() - interval '3 minutes' WHERE id = winx;
  hb := public.agent_heartbeat(winx, 'idle', '0.1.0-win');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = winx;
  r := r || ' [stale_request_expires ' || CASE WHEN (hb->>'diagnostic_requested')::boolean IS FALSE AND st = 'expired' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- ===== RLS read =====
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  SELECT count(*) INTO n FROM public.diagnostic_results WHERE agent_id = win;
  r := r || ' [staff_reads_own ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  SELECT count(*) INTO n FROM public.diagnostic_results WHERE agent_id = win;
  r := r || ' [other_company_cannot_read ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
