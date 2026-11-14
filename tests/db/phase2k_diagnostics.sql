-- NexWipe Phase 2k checks: agent-run diagnostics ("Run complete test suite", migrations 0025 + 0026).
-- Request from the app, exactly-once delivery by heartbeat; the Windows helper runs the suite in the
-- laptop's own Windows and reports it (only when asked); the boot stick runs its own suite (also when
-- started at the laptop); append-only results; access rules.
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
  lin := (public.agent_enroll(tok, 'Boot A', '0.3.0-readonly', 'x86_64 6.12.107', 'nexwipe')->>'agent_id')::uuid;
  PERFORM public.agent_report_inventory(lin, '{"system":{"manufacturer":"HP","model":"EliteBook 840 G5","serial":"P2K-SYS-2"},"station":{"hardware_source":"physical"},"drives":[]}');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(ox, 'Win stick X', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  winx := (public.agent_enroll(tok, 'Win X', '0.1.0-win', 'windows 10.0.19045', 'LAP-X')->>'agent_id')::uuid;

  -- ===== Request (technician, AAL2) =====
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  res := public.request_diagnostic(lin, 'full');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = lin;
  r := r || ' [technician_requests_full ' || CASE WHEN res->>'test' = 'full' AND st = 'requested' THEN 'PASS' ELSE 'FAIL' END || ']';

  BEGIN PERFORM public.request_diagnostic(lin, 'full'); r := r || ' [no_double_request FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_double_request PASS]'; END;

  -- The old Windows keyboard test and unknown tests are refused (on A's own stations: test name, not permission).
  BEGIN PERFORM public.request_diagnostic(win, 'keyboard'); r := r || ' [keyboard_request_refused FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [keyboard_request_refused PASS]'; END;
  BEGIN PERFORM public.request_diagnostic(lin, 'display'); r := r || ' [unknown_test FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [unknown_test PASS]'; END;

  -- A Windows laptop can be sent the suite too (the helper asks, then restarts into the stick).
  res := public.request_diagnostic(win, 'full');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = win;
  r := r || ' [windows_laptop_can_be_sent_suite ' || CASE WHEN st = 'requested' THEN 'PASS' ELSE 'FAIL' END || ']';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', uau, 'role','authenticated','aal','aal2')::text, true);
  BEGIN PERFORM public.request_diagnostic(lin, 'full'); r := r || ' [auditor_cannot FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [auditor_cannot PASS]'; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  BEGIN PERFORM public.request_diagnostic(lin, 'full'); r := r || ' [other_company_cannot FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [other_company_cannot PASS]'; END;

  -- ===== Delivery (heartbeat delivers exactly once) =====
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  hb := public.agent_heartbeat(lin, 'idle', '0.3.0-readonly');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = lin;
  r := r || ' [heartbeat_delivers ' || CASE WHEN (hb->>'diagnostic_requested')::boolean AND hb->>'diagnostic_test' = 'full' AND st = 'delivered' THEN 'PASS' ELSE 'FAIL' END || ']';
  hb := public.agent_heartbeat(lin, 'idle', '0.3.0-readonly');
  r := r || ' [delivered_only_once ' || CASE WHEN (hb->>'diagnostic_requested')::boolean IS FALSE THEN 'PASS' ELSE 'FAIL' END || ']';

  -- ===== Report =====
  res := public.agent_report_diagnostic(lin, 'full', 'fail',
    '{"layout":"ansi","tests":{"keyboard":{"outcome":"pass","keys_registered":["SC_1E"]},"speakers":{"outcome":"fail","note":"left silent"}}}', '1 pass, 1 fail');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = lin;
  SELECT count(*) INTO n FROM public.diagnostic_results WHERE agent_id = lin AND test = 'full' AND outcome = 'fail'
    AND result->'tests'->'speakers'->>'outcome' = 'fail';
  r := r || ' [report_records_result ' || CASE WHEN res->>'outcome' = 'fail' AND st = 'done' AND n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';

  SELECT count(*) INTO n FROM public.diagnostic_results dr JOIN public.agent_discoveries ad ON ad.agent_id = dr.agent_id
    WHERE dr.agent_id = lin AND dr.device_code = ad.device_code;
  r := r || ' [result_linked_to_device_code ' || CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Started by the technician at the laptop (no cloud request): recorded, station status untouched.
  res := public.agent_report_diagnostic(lin, 'full', 'pass', '{"tests":{}}', 'started at the laptop');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = lin;
  SELECT count(*) INTO n FROM public.diagnostic_results WHERE agent_id = lin AND test = 'full';
  r := r || ' [laptop_started_full_test ' || CASE WHEN st = 'done' AND n = 2 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- ===== Windows laptop: the suite runs in its own Windows (0026) =====
  hb := public.agent_heartbeat(win, 'idle', '0.6.0-win');
  r := r || ' [windows_gets_suite ' || CASE WHEN hb->>'diagnostic_test' = 'full' THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT count(*) INTO n FROM public.diagnostic_results WHERE agent_id = win;
  res := public.agent_report_diagnostic(win, 'full', 'pass',
    '{"layout":"ansi","tests":{"keyboard":{"outcome":"pass","keys_registered":["SC_1E"]},"webcam":{"outcome":"pass"}}}', '2 pass');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = win;
  r := r || ' [windows_reports_suite_result ' || CASE WHEN res->>'outcome' = 'pass' AND st = 'done'
    AND (SELECT count(*) FROM public.diagnostic_results WHERE agent_id = win AND test = 'full' AND result->'tests'->'webcam'->>'outcome' = 'pass') = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  -- Without a delivered request the helper cannot report (only the stick may start a suite on its own).
  BEGIN PERFORM public.agent_report_diagnostic(win, 'full', 'pass', '{}', null); r := r || ' [windows_no_report_without_request FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [windows_no_report_without_request PASS]'; END;
  -- Declined at the laptop: recorded as incomplete, request marked failed.
  UPDATE public.agents SET diagnostic_status = 'delivered', diagnostic_test = 'full', diagnostic_status_at = now() WHERE id = win;
  PERFORM public.agent_report_diagnostic(win, 'full', 'incomplete', '{"tests":{"keyboard":{"outcome":"incomplete","note":"Declined at the laptop"}}}', 'Declined at the laptop');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = win;
  r := r || ' [windows_decline_recorded ' || CASE WHEN st = 'failed' AND (SELECT count(*) FROM public.diagnostic_results WHERE agent_id = win) = n + 2 THEN 'PASS' ELSE 'FAIL' END || ']';
  -- The 0025 restart hand-off is gone.
  UPDATE public.agents SET diagnostic_status = 'delivered', diagnostic_test = 'full', diagnostic_status_at = now() WHERE id = win;
  BEGIN PERFORM public.agent_report_diagnostic(win, 'full', 'handoff', '{}', null); r := r || ' [no_handoff_outcome FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_handoff_outcome PASS]'; END;
  UPDATE public.agents SET diagnostic_status = 'failed' WHERE id = win;
  -- A keyboard result needs a delivered keyboard request.
  BEGIN PERFORM public.agent_report_diagnostic(win, 'keyboard', 'pass', '{}', null); r := r || ' [no_keyboard_report_without_delivery FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_keyboard_report_without_delivery PASS]'; END;
  BEGIN PERFORM public.agent_report_diagnostic(lin, 'display', 'pass', '{}', null); r := r || ' [unknown_test_report FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [unknown_test_report PASS]'; END;
  BEGIN PERFORM public.agent_report_diagnostic(lin, 'full', 'great', '{}', null); r := r || ' [unknown_outcome FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [unknown_outcome PASS]'; END;

  -- A keyboard test handed out before 0025 can still report (old helpers already in the field).
  UPDATE public.agents SET diagnostic_status = 'delivered', diagnostic_test = 'keyboard', diagnostic_status_at = now() WHERE id = win;
  res := public.agent_report_diagnostic(win, 'keyboard', 'pass', '{"layout":"ansi","keys_registered":["SC_1E"]}', 'all keys ok');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = win;
  r := r || ' [delivered_keyboard_still_reports ' || CASE WHEN st = 'done' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- ===== Append-only results =====
  BEGIN UPDATE public.diagnostic_results SET outcome = 'pass' WHERE agent_id = lin; r := r || ' [results_no_update FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [results_no_update PASS]'; END;
  BEGIN DELETE FROM public.diagnostic_results WHERE agent_id = lin; r := r || ' [results_no_delete FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [results_no_delete PASS]'; END;

  -- ===== Expiry (no heartbeat within 2 minutes) =====
  UPDATE public.agents SET diagnostic_status = 'requested', diagnostic_test = 'full',
    diagnostic_status_at = now() - interval '3 minutes', diagnostic_requested_at = now() - interval '3 minutes' WHERE id = lin;
  hb := public.agent_heartbeat(lin, 'idle', '0.3.0-readonly');
  SELECT diagnostic_status INTO st FROM public.agents WHERE id = lin;
  r := r || ' [stale_request_expires ' || CASE WHEN (hb->>'diagnostic_requested')::boolean IS FALSE AND st = 'expired' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- ===== RLS read =====
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  SELECT count(*) INTO n FROM public.diagnostic_results WHERE agent_id IN (lin, win);
  r := r || ' [staff_reads_own ' || CASE WHEN n = 5 THEN 'PASS' ELSE 'FAIL' END || ']';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  SELECT count(*) INTO n FROM public.diagnostic_results WHERE agent_id IN (lin, win);
  r := r || ' [other_company_cannot_read ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  -- Nobody in the app can write a result directly.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    INSERT INTO public.diagnostic_results(org_id, agent_id, device_code, test, outcome) VALUES (oa, lin, 'X', 'full', 'pass');
    r := r || ' [app_cannot_insert FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [app_cannot_insert PASS]'; END;

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
