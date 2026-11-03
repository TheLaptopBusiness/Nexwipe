-- NexWipe Phase 2h checks: device codes (barcodes) on station reports, and station actions
-- (Rescan, Reboot into NexWipe) requested from the app. Single DO block; always rolls back.
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid(); uau uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  oa uuid; ox uuid; tok text; res jsonb; win uuid; lin uuid; d1 uuid; d2 uuid; c1 text; c2 text; c3 text;
  n int; ok boolean; r text := ''; st text;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'p2ha@test.local', now(), 'authenticated','authenticated'), (ut, 'p2ht@test.local', now(), 'authenticated','authenticated'),
    (uau, 'p2hau@test.local', now(), 'authenticated','authenticated'), (ux, 'p2hx@test.local', now(), 'authenticated','authenticated');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  ox := public.create_organization('P2H X', 'p2h-x-' || substr(ux::text,1,8));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  oa := public.create_organization('P2H A', 'p2h-a-' || substr(ua::text,1,8));
  tok := public.create_invitation(oa, 'p2ht@test.local', 'technician');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.accept_invitation(tok);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_invitation(oa, 'p2hau@test.local', 'auditor');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uau, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.accept_invitation(tok);

  -- Two stations: the Windows helper and the boot-stick station.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(oa, 'Windows stick', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  win := (public.agent_enroll(tok, 'Stick 1 (Windows)', '0.1.0-win', 'windows 10.0.19045', 'LAPTOP-1')->>'agent_id')::uuid;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(oa, 'Boot stick', null, 1);
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  lin := (public.agent_enroll(tok, 'Stick 1 (boot)', '0.2.4', 'x86_64 6.12.107', 'nexwipe')->>'agent_id')::uuid;

  -- ===== Device codes =====
  res := public.agent_report_inventory(win, '{"system":{"manufacturer":"Dell Inc.","model":"Latitude 5490","serial":"P2H-SYS-1"},"station":{"hardware_source":"physical"},"drives":[]}');
  d1 := (res->>'discovery_id')::uuid;
  SELECT device_code INTO c1 FROM public.agent_discoveries WHERE id = d1;
  r := r || ' [device_code_generated ' || CASE WHEN c1 ~ '^NW-[0-9A-HJKMNP-TV-Z]{8}$' THEN 'PASS' ELSE 'FAIL' END || ']';
  PERFORM public.agent_report_inventory(win, '{"system":{"manufacturer":"Dell Inc.","model":"Latitude 5490","serial":"P2H-SYS-1"},"station":{"hardware_source":"physical"},"drives":[],"review_flags":[]}');
  SELECT device_code INTO c2 FROM public.agent_discoveries WHERE id = d1;
  r := r || ' [device_code_stable_on_re_report ' || CASE WHEN c2 = c1 THEN 'PASS' ELSE 'FAIL' END || ']';
  res := public.agent_report_inventory(lin, '{"system":{"manufacturer":"Dell Inc.","model":"Latitude 5490","serial":"p2h-sys-1"},"station":{"hardware_source":"physical"},"drives":[]}');
  d2 := (res->>'discovery_id')::uuid;
  SELECT device_code INTO c2 FROM public.agent_discoveries WHERE id = d2;
  r := r || ' [same_laptop_other_station_same_code ' || CASE WHEN d2 <> d1 AND c2 = c1 THEN 'PASS' ELSE 'FAIL' END || ']';
  res := public.agent_report_inventory(win, '{"system":{"manufacturer":"HP","model":"EliteBook","serial":"P2H-SYS-2"},"station":{"hardware_source":"physical"},"drives":[]}');
  SELECT device_code INTO c3 FROM public.agent_discoveries WHERE id = (res->>'discovery_id')::uuid;
  r := r || ' [other_laptop_other_code ' || CASE WHEN c3 <> c1 THEN 'PASS' ELSE 'FAIL' END || ']';
  -- Even trusted code cannot change a code once given (the trigger keeps the old value).
  UPDATE public.agent_discoveries SET device_code = 'NW-00000000' WHERE id = d1;
  SELECT device_code = c1 INTO ok FROM public.agent_discoveries WHERE id = d1;
  r := r || ' [device_code_immutable ' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    INSERT INTO public.agent_discoveries(org_id, agent_id, system_serial, payload, device_code) VALUES (oa, win, 'P2H-SYS-1', '{}', 'NW-ZZZZZZZZ')
      RETURNING device_code INTO c3;
    r := r || ' [inserted_code_is_ignored ' || CASE WHEN c3 = c1 THEN 'PASS' ELSE 'FAIL' END || ']';
  EXCEPTION WHEN others THEN r := r || ' [inserted_code_is_ignored FAIL ' || SQLERRM || ']'; END;

  -- Browser users can read codes but never write them.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  SELECT count(*) INTO n FROM public.agent_discoveries WHERE id = d1 AND device_code = c1;
  r := r || ' [technician_reads_code ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    UPDATE public.agent_discoveries SET device_code = 'NW-00000000' WHERE id = d1;
    r := r || ' [browser_cannot_write_code FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [browser_cannot_write_code PASS]'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  SELECT count(*) INTO n FROM public.agent_discoveries WHERE id = d1;
  r := r || ' [other_company_cannot_see_device ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- ===== Station actions: permissions =====
  BEGIN
    PERFORM public.request_station_action(win, 'rescan');
    r := r || ' [other_company_cannot_act FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [other_company_cannot_act PASS]'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uau, 'role','authenticated','aal','aal1')::text, true);
  BEGIN
    PERFORM public.request_station_action(win, 'rescan');
    r := r || ' [auditor_cannot_act FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [auditor_cannot_act PASS]'; END;
  -- Owner without two-step verification has no owner rights (has_org_role requires AAL2).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal1')::text, true);
  BEGIN
    PERFORM public.request_station_action(win, 'rescan');
    r := r || ' [owner_without_mfa_cannot_act FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [owner_without_mfa_cannot_act PASS]'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  BEGIN
    UPDATE public.agents SET reboot_status = 'requested', reboot_status_at = now() WHERE id = win;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := r || ' [browser_cannot_write_reboot_directly ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  EXCEPTION WHEN others THEN r := r || ' [browser_cannot_write_reboot_directly PASS]'; END;
  BEGIN
    PERFORM public.request_station_action(win, 'wipe');
    r := r || ' [no_wipe_action FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_wipe_action PASS]'; END;

  -- ===== Rescan =====
  PERFORM public.request_station_action(lin, 'rescan');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_heartbeat(lin, 'idle', null);
  r := r || ' [rescan_reaches_station ' || CASE WHEN (res->>'inventory_requested')::boolean AND NOT (res->>'reboot_to_usb_requested')::boolean THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT count(*) INTO n FROM public.audit_events WHERE entity_id = lin AND action = 'agents.rescan_requested' AND actor_id = ut;
  r := r || ' [rescan_audited ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- ===== Reboot into NexWipe =====
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  BEGIN
    PERFORM public.request_station_action(lin, 'reboot_to_usb');
    r := r || ' [boot_stick_station_refuses_reboot FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [boot_stick_station_refuses_reboot PASS]'; END;
  PERFORM public.request_station_action(win, 'reboot_to_usb');
  BEGIN
    PERFORM public.request_station_action(win, 'reboot_to_usb');
    r := r || ' [second_reboot_while_pending_refused FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [second_reboot_while_pending_refused PASS]'; END;
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  BEGIN
    PERFORM public.agent_report_action(win, 'reboot_to_usb', true, 'early');
    r := r || ' [result_before_delivery_refused FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [result_before_delivery_refused PASS]'; END;
  res := public.agent_heartbeat(win, 'idle', null);
  ok := (res->>'reboot_to_usb_requested')::boolean;
  res := public.agent_heartbeat(win, 'idle', null);
  r := r || ' [reboot_delivered_exactly_once ' || CASE WHEN ok AND NOT (res->>'reboot_to_usb_requested')::boolean THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM public.agent_report_action(lin, 'reboot_to_usb', true, 'not mine');
    r := r || ' [other_station_cannot_report FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [other_station_cannot_report PASS]'; END;
  PERFORM public.agent_report_action(win, 'reboot_to_usb', true, 'Boot entry set; restarting in 15 s');
  SELECT reboot_status INTO st FROM public.agents WHERE id = win;
  r := r || ' [reboot_result_recorded ' || CASE WHEN st = 'done' THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    PERFORM public.agent_report_action(win, 'reboot_to_usb', false, 'again');
    r := r || ' [result_cannot_be_rewritten FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [result_cannot_be_rewritten PASS]'; END;

  -- A request nobody picked up within 2 minutes expires instead of firing late.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.request_station_action(win, 'reboot_to_usb');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  UPDATE public.agents SET reboot_status_at = now() - interval '3 minutes' WHERE id = win;
  res := public.agent_heartbeat(win, 'idle', null);
  SELECT reboot_status INTO st FROM public.agents WHERE id = win;
  r := r || ' [late_reboot_expires_not_delivered ' || CASE WHEN st = 'expired' AND NOT (res->>'reboot_to_usb_requested')::boolean THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Revoked stations get nothing.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.revoke_agent(win, 'test');
  BEGIN
    PERFORM public.request_station_action(win, 'reboot_to_usb');
    r := r || ' [revoked_station_refused FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [revoked_station_refused PASS]'; END;
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  BEGIN
    PERFORM public.agent_heartbeat(win, 'idle', null);
    r := r || ' [revoked_station_heartbeat_refused FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [revoked_station_heartbeat_refused PASS]'; END;

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
