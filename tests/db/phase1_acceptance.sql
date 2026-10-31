-- NexWipe Phase 1 database acceptance checks.
-- Sessions are simulated at AAL2 (two-step verified) so owner/admin rights apply; see phase2b_security.sql for AAL1 checks.
-- Runs as a single DO block, creates temporary users/orgs, and always ends by
-- raising an exception so the whole transaction rolls back (nothing persists).
-- Read the result line: every check must show "PASS".
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); ut uuid := gen_random_uuid(); uv uuid := gen_random_uuid();
  oa uuid; ob uuid; mt uuid; ca uuid; pa uuid; pa2 uuid; tok text; n int; ok boolean;
  r text := '';
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role) VALUES
    (ua, 'a@test.local', now(), 'authenticated','authenticated'),
    (ub, 'b@test.local', now(), 'authenticated','authenticated'),
    (ut, 't@test.local', now(), 'authenticated','authenticated'),
    (uv, 'v@test.local', now(), 'authenticated','authenticated');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  oa := public.create_organization('Company A', 'test-a-' || substr(ua::text,1,8));
  INSERT INTO public.clients(org_id, name) VALUES (oa, 'School A') RETURNING id INTO ca;
  INSERT INTO public.projects(org_id, client_id, name) VALUES (oa, ca, 'Shared project') RETURNING id INTO pa;
  INSERT INTO public.projects(org_id, client_id, name) VALUES (oa, ca, 'Private project') RETURNING id INTO pa2;
  INSERT INTO public.devices(org_id, asset_tag, system_serial, hardware_verified, source, project_id)
    VALUES (oa, 'A-1', 'SERIAL-A', true, 'agent_reported', pa);
  SELECT hardware_verified INTO ok FROM public.devices WHERE org_id = oa AND asset_tag = 'A-1';
  r := r || ' [browser_cannot_mark_verified ' || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT count(*) INTO n FROM public.custody_events WHERE org_id = oa;
  r := r || ' [custody_written_on_intake ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Company B isolation
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated','aal','aal2')::text, true);
  ob := public.create_organization('Company B', 'test-b-' || substr(ub::text,1,8));
  SELECT (SELECT count(*) FROM public.devices WHERE org_id = oa) + (SELECT count(*) FROM public.clients WHERE org_id = oa)
       + (SELECT count(*) FROM public.organizations WHERE id = oa) + (SELECT count(*) FROM public.audit_events WHERE org_id = oa)
       + (SELECT count(*) FROM public.custody_events WHERE org_id = oa) + (SELECT count(*) FROM public.memberships WHERE org_id = oa) INTO n;
  r := r || ' [b_cannot_read_a ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  BEGIN
    INSERT INTO public.devices(org_id, asset_tag) VALUES (oa, 'B-INTO-A');
    r := r || ' [b_cannot_insert_into_a FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [b_cannot_insert_into_a PASS]'; END;
  BEGIN
    INSERT INTO public.projects(org_id, client_id, name) VALUES (ob, ca, 'Cross-org reference');
    r := r || ' [no_cross_org_reference FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [no_cross_org_reference PASS]'; END;
  UPDATE public.devices SET notes = 'x' WHERE org_id = oa; GET DIAGNOSTICS n = ROW_COUNT;
  r := r || ' [b_cannot_update_a ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Technician cannot escalate
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_invitation(oa, 't@test.local', 'technician');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.accept_invitation(tok);
  SELECT id INTO mt FROM public.memberships WHERE org_id = oa AND user_id = ut;
  BEGIN
    PERFORM public.update_member_role(mt, 'admin');
    r := r || ' [tech_cannot_self_promote FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [tech_cannot_self_promote PASS]'; END;
  BEGIN
    UPDATE public.memberships SET role = 'owner' WHERE id = mt;
    r := r || ' [tech_cannot_write_memberships FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [tech_cannot_write_memberships PASS]'; END;
  BEGIN
    PERFORM public.create_invitation(oa, 'x@test.local', 'admin');
    r := r || ' [tech_cannot_invite FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [tech_cannot_invite PASS]'; END;
  BEGIN
    DELETE FROM public.audit_events WHERE org_id = oa;
    r := r || ' [audit_not_deletable FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [audit_not_deletable PASS]'; END;
  BEGIN
    UPDATE public.custody_events SET notes = 'rewritten' WHERE org_id = oa;
    r := r || ' [custody_not_editable FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [custody_not_editable PASS]'; END;

  -- Customer viewer sees only the granted project and no devices
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  tok := public.create_invitation(oa, 'v@test.local', 'customer_viewer');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uv, 'role','authenticated','aal','aal2')::text, true);
  PERFORM public.accept_invitation(tok);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  INSERT INTO public.client_access_grants(org_id, user_id, project_id, granted_by) VALUES (oa, uv, pa, ua);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uv, 'role','authenticated','aal','aal2')::text, true);
  SELECT count(*) INTO n FROM public.projects WHERE org_id = oa;
  r := r || ' [viewer_sees_only_granted_project ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  SELECT count(*) INTO n FROM public.devices WHERE org_id = oa;
  r := r || ' [viewer_sees_no_devices ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Last owner cannot be removed
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    PERFORM public.revoke_member((SELECT id FROM public.memberships WHERE org_id = oa AND user_id = ua));
    r := r || ' [owner_cannot_remove_self FAIL]';
  EXCEPTION WHEN others THEN r := r || ' [owner_cannot_remove_self PASS]'; END;

  PERFORM set_config('role', me, true);
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
