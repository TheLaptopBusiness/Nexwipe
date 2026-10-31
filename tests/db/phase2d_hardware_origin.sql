-- NexWipe hardware-origin checks: a real station reporting synthetic/virtual hardware keeps it marked
-- synthetic; station sign-in never upgrades it; app users cannot claim station-reported identity.
-- Single DO block; always rolls back. Run: psql -f tests/db/phase2d_hardware_origin.sql
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid();
  oa uuid; pol uuid; tok text; res jsonb; ag uuid; disc uuid; dev uuid; dev2 uuid; man uuid; drv uuid; j uuid;
  o text; v boolean; r text := '';
  syn jsonb := '{"system":{"manufacturer":"Dell Inc.","model":"Latitude 5420","serial":"SYN-0001"},
                 "station":{"mode":"read_only","hardware_source":"synthetic"},
                 "drives":[{"serial":"SYNDRV01","model":"SAMSUNG MZVLB512","interface":"nvme_ssd","transport":"nvme","capacity_bytes":512110190592}]}';
  phy jsonb := '{"system":{"manufacturer":"Dell Inc.","model":"Latitude 5420","serial":"PHY-0001"},
                 "station":{"mode":"read_only","hardware_source":"physical"},
                 "drives":[{"serial":"PHYDRV01","model":"SAMSUNG MZVLB512","interface":"nvme_ssd","transport":"nvme","capacity_bytes":512110190592}]}';
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'p2da@test.local', now(), 'authenticated','authenticated'), (ut, 'p2dt@test.local', now(), 'authenticated','authenticated');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  oa := public.create_organization('P2D A', 'p2d-a-' || substr(ua::text,1,8));
  tok := public.create_invitation(oa, 'p2dt@test.local', 'technician');
  pol := public.create_policy(oa, 'Std', null, '{"allowed_manufacturers":["Dell"],"allowed_interfaces":["nvme_ssd"],"allowed_methods":["nvme_sanitize_crypto"],"verification_method":"full_read"}');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  PERFORM public.accept_invitation(tok);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_enrollment_token(oa, 'Bench', null, 1);

  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  res := public.agent_enroll(tok, 'Bench', '0.2.1-readonly', 'x86_64 6.12.0-amd64', 'bench'); ag := (res->>'agent_id')::uuid;

  -- 1. Synthetic report from an authenticated real station
  res := public.agent_report_inventory(ag, syn); disc := (res->>'discovery_id')::uuid;
  SELECT hardware_origin INTO o FROM public.agent_discoveries WHERE id = disc;
  r := r || ' [synthetic_report_marked_synthetic ' || CASE WHEN o = 'synthetic' THEN 'PASS' ELSE 'FAIL ' || o END || ']';
  r := r || ' [synthetic_review_flag ' || CASE WHEN res->'review_flags' @> '[{"code":"synthetic_hardware"}]' THEN 'PASS' ELSE 'FAIL' END || ']';

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  dev := public.create_device_from_discovery(disc, 'SYN-TAG');
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  PERFORM public.agent_report_inventory(ag, syn);
  SELECT hardware_origin, hardware_verified INTO o, v FROM public.devices WHERE id = dev;
  r := r || ' [synthetic_rereport_not_verified ' || CASE WHEN o = 'synthetic' AND NOT v THEN 'PASS' ELSE 'FAIL ' || o || v END || ']';
  SELECT d.hardware_origin, d.hardware_verified INTO o, v FROM public.drives d WHERE d.org_id = oa AND d.serial = 'SYNDRV01';
  r := r || ' [synthetic_drive_not_verified ' || CASE WHEN o = 'synthetic' AND NOT v THEN 'PASS' ELSE 'FAIL ' || o || v END || ']';

  -- 2. Same laptop later claimed physical: stays synthetic (sticky)
  PERFORM public.agent_report_inventory(ag, jsonb_set(syn, '{station,hardware_source}', '"physical"'));
  SELECT hardware_origin, hardware_verified INTO o, v FROM public.devices WHERE id = dev;
  r := r || ' [synthetic_is_permanent ' || CASE WHEN o = 'synthetic' AND NOT v THEN 'PASS' ELSE 'FAIL ' || o || v END || ']';

  -- 3. Old agents that declare nothing, and VM-looking identities, are synthetic
  res := public.agent_report_inventory(ag, '{"system":{"manufacturer":"Dell Inc.","serial":"OLD-0001"},"station":{"mode":"read_only"},"drives":[]}');
  SELECT hardware_origin INTO o FROM public.agent_discoveries WHERE id = (res->>'discovery_id')::uuid;
  r := r || ' [undeclared_source_synthetic ' || CASE WHEN o = 'synthetic' THEN 'PASS' ELSE 'FAIL' END || ']';
  res := public.agent_report_inventory(ag, '{"system":{"manufacturer":"QEMU","model":"Standard PC","serial":"VM-9"},"station":{"hardware_source":"physical"},"drives":[]}');
  SELECT hardware_origin INTO o FROM public.agent_discoveries WHERE id = (res->>'discovery_id')::uuid;
  r := r || ' [vm_identity_synthetic_despite_claim ' || CASE WHEN o = 'synthetic' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- 4. Physical claim: station-reported (never called proven)
  res := public.agent_report_inventory(ag, phy); disc := (res->>'discovery_id')::uuid;
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  dev2 := public.create_device_from_discovery(disc, 'PHY-TAG');
  SELECT hardware_origin INTO o FROM public.devices WHERE id = dev2;
  r := r || ' [physical_not_reported_until_rereport ' || CASE WHEN o = 'not_station_reported' THEN 'PASS' ELSE 'FAIL ' || o END || ']';
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  PERFORM public.agent_report_inventory(ag, phy);
  SELECT hardware_origin, hardware_verified INTO o, v FROM public.devices WHERE id = dev2;
  r := r || ' [physical_rereport_station_reported ' || CASE WHEN o = 'station_reported' AND v THEN 'PASS' ELSE 'FAIL ' || o || v END || ']';

  -- 5. App users cannot claim or upgrade origin; synthetic hardware cannot get jobs
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  INSERT INTO public.devices(org_id, asset_tag, manufacturer, system_serial, hardware_origin, hardware_verified)
    VALUES (oa, 'MAN-1', 'Dell', 'MAN-0001', 'station_reported', true) RETURNING id INTO man;
  SELECT hardware_origin, hardware_verified INTO o, v FROM public.devices WHERE id = man;
  r := r || ' [user_cannot_insert_station_reported ' || CASE WHEN o = 'not_station_reported' AND NOT v THEN 'PASS' ELSE 'FAIL' END || ']';
  UPDATE public.devices SET hardware_origin = 'station_reported' WHERE id = dev;
  SELECT hardware_origin INTO o FROM public.devices WHERE id = dev;
  r := r || ' [user_cannot_clear_synthetic ' || CASE WHEN o = 'synthetic' THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT a.drive_id INTO drv FROM public.device_drive_associations a WHERE a.device_id = dev AND a.detached_at IS NULL LIMIT 1;
  BEGIN
    j := public.create_job(dev, drv, pol);
    r := r || ' [synthetic_cannot_get_job FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [synthetic_cannot_get_job PASS]'; END;
  SELECT a.drive_id INTO drv FROM public.device_drive_associations a WHERE a.device_id = dev2 AND a.detached_at IS NULL LIMIT 1;
  BEGIN
    j := public.create_job(dev2, drv, pol);
    r := r || ' [station_reported_can_get_draft_job PASS]';
  EXCEPTION WHEN others THEN r := r || ' [station_reported_can_get_draft_job FAIL ' || SQLERRM || ']'; END;

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
