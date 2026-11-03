-- NexWipe Phase 2j checks: "Add to inventory" needs a connected station, and copies RAM and battery
-- health from the station report. Single DO block; always rolls back.
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid();
  oa uuid; tok text; ag uuid; disc uuid; dev uuid; n numeric; b int; r text := ''; origin text;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'p2ja@test.local', now(), 'authenticated','authenticated'), (ut, 'p2jt@test.local', now(), 'authenticated','authenticated');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  oa := public.create_organization('P2J A', 'p2j-a-' || substr(ua::text,1,8));
  tok := public.create_invitation(oa, 'p2jt@test.local', 'technician');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.accept_invitation(tok);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(oa, 'Stick J', null, 1);

  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  ag := (public.agent_enroll(tok, 'Stick J', '0.1.0-win', 'windows 10.0.19043', 'LAPTOP-J')->>'agent_id')::uuid;
  disc := (public.agent_report_inventory(ag, '{"system":{"manufacturer":"Dell Inc.","model":"Inspiron 3585","serial":"P2J-1","cpu":"AMD Ryzen 5 2500U","ram_bytes":8589934592},"batteries":[{"health_pct":43.4}],"station":{"hardware_source":"physical"},"drives":[]}')->>'discovery_id')::uuid;

  -- Station last checked in 5 minutes ago: refused.
  PERFORM set_config('role', me, true);
  UPDATE public.agents SET last_heartbeat_at = now() - interval '5 minutes' WHERE id = ag;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  BEGIN
    PERFORM public.create_device_from_discovery(disc, 'J-1');
    r := r || ' [disconnected_station_refused FAIL]';
  EXCEPTION WHEN invalid_parameter_value THEN
    r := r || ' [disconnected_station_refused ' || CASE WHEN SQLERRM LIKE '%not connected%' THEN 'PASS' ELSE 'FAIL' END || ']';
  END;
  SELECT count(*) INTO n FROM public.devices WHERE org_id = oa;
  r := r || ' [nothing_created_when_refused ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Never checked in: refused.
  PERFORM set_config('role', me, true);
  UPDATE public.agents SET last_heartbeat_at = NULL WHERE id = ag;
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.create_device_from_discovery(disc, 'J-1');
    r := r || ' [never_connected_refused FAIL]';
  EXCEPTION WHEN invalid_parameter_value THEN r := r || ' [never_connected_refused PASS]'; END;

  -- Station checks in (heartbeat): add succeeds, RAM and battery copied, rescan queued, awaiting re-report.
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  PERFORM public.agent_heartbeat(ag, 'idle', '0.1.0-win');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  dev := public.create_device_from_discovery(disc, 'J-1');
  SELECT ram_gb, battery_health_pct, hardware_origin INTO n, b, origin FROM public.devices WHERE id = dev;
  r := r || ' [connected_add_ok ' || CASE WHEN dev IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || ']';
  r := r || ' [ram_copied_8gb ' || CASE WHEN n = 8.0 THEN 'PASS' ELSE 'FAIL' END || ']';
  r := r || ' [battery_copied_43 ' || CASE WHEN b = 43 THEN 'PASS' ELSE 'FAIL' END || ']';
  r := r || ' [awaits_rescan ' || CASE WHEN origin = 'not_station_reported' THEN 'PASS' ELSE 'FAIL' END || ']';
  PERFORM set_config('role', me, true);
  SELECT count(*) INTO n FROM public.agents WHERE id = ag AND inventory_requested_at IS NOT NULL;
  r := r || ' [rescan_queued ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- The station's next report confirms the record.
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  PERFORM public.agent_report_inventory(ag, '{"system":{"manufacturer":"Dell Inc.","model":"Inspiron 3585","serial":"P2J-1","ram_bytes":8589934592},"station":{"hardware_source":"physical"},"drives":[]}');
  PERFORM set_config('role', me, true);
  SELECT hardware_origin INTO origin FROM public.devices WHERE id = dev;
  r := r || ' [rescan_confirms_station_reported ' || CASE WHEN origin = 'station_reported' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Revoked station: a second laptop it reported cannot be added, even with a fresh heartbeat.
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  disc := (public.agent_report_inventory(ag, '{"system":{"manufacturer":"HP","model":"EliteBook","serial":"P2J-2"},"station":{"hardware_source":"physical"},"drives":[]}')->>'discovery_id')::uuid;
  PERFORM set_config('role', me, true);
  UPDATE public.agents SET status = 'revoked', last_heartbeat_at = now() WHERE id = ag;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  BEGIN
    PERFORM public.create_device_from_discovery(disc, 'J-2');
    r := r || ' [revoked_station_refused FAIL]';
  EXCEPTION WHEN invalid_parameter_value THEN
    r := r || ' [revoked_station_refused ' || CASE WHEN SQLERRM LIKE '%not connected%' THEN 'PASS' ELSE 'FAIL' END || ']';
  END;

  -- Payload parsing: hostile values ignored, capacities used, over-100 capped.
  PERFORM set_config('role', me, true);
  r := r || ' [ram_rejects_text ' || CASE WHEN public._payload_ram_gb('{"system":{"ram_bytes":"8GB"}}') IS NULL THEN 'PASS' ELSE 'FAIL' END || ']';
  r := r || ' [ram_rejects_negative ' || CASE WHEN public._payload_ram_gb('{"system":{"ram_bytes":-5}}') IS NULL THEN 'PASS' ELSE 'FAIL' END || ']';
  r := r || ' [battery_from_capacities ' || CASE WHEN public._payload_battery_pct('{"batteries":[{"full_charge_capacity_mwh":42000,"design_capacity_mwh":50000}]}') = 84 THEN 'PASS' ELSE 'FAIL' END || ']';
  r := r || ' [battery_capped_100 ' || CASE WHEN public._payload_battery_pct('{"batteries":[{"health_pct":104.2}]}') = 100 THEN 'PASS' ELSE 'FAIL' END || ']';
  r := r || ' [battery_zero_design_ignored ' || CASE WHEN public._payload_battery_pct('{"batteries":[{"full_charge_capacity_mwh":1,"design_capacity_mwh":0}]}') IS NULL THEN 'PASS' ELSE 'FAIL' END || ']';
  r := r || ' [no_battery_null ' || CASE WHEN public._payload_battery_pct('{}') IS NULL THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Helpers are not callable by app users.
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public._payload_ram_gb('{}');
    r := r || ' [helpers_not_public FAIL]';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' [helpers_not_public PASS]'; END;

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
