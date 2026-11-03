-- NexWipe Phase 2i checks: resale grade on inventory devices (A/B/C/D), who may set it, and its history.
-- Single DO block; always rolls back.
DO $$
DECLARE
  me text := current_user;
  ua uuid := gen_random_uuid(); ut uuid := gen_random_uuid(); uau uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  oa uuid; ox uuid; tok text; dev uuid; n int; g text; r text := '';
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

  -- Technician adds a laptop: no grade until someone grades it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ut, 'role','authenticated','aal','aal1')::text, true);
  INSERT INTO public.devices(org_id, asset_tag, manufacturer, system_serial) VALUES (oa, 'I-1', 'Dell', 'SYS-I1') RETURNING id INTO dev;
  SELECT grade INTO g FROM public.devices WHERE id = dev;
  r := r || ' [new_device_ungraded ' || CASE WHEN g IS NULL THEN 'PASS' ELSE 'FAIL' END || ']';

  UPDATE public.devices SET grade = 'B' WHERE id = dev;
  SELECT grade INTO g FROM public.devices WHERE id = dev;
  r := r || ' [technician_sets_grade ' || CASE WHEN g = 'B' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Technicians cannot read audit history, so check it as the database owner.
  PERFORM set_config('role', me, true);
  SELECT count(*) INTO n FROM public.audit_events
    WHERE entity_id = dev AND action = 'devices.update' AND actor_id = ut
      AND details->'changed'->'grade'->>'from' IS NULL AND details->'changed'->'grade'->>'to' = 'B';
  r := r || ' [grade_change_in_audit_with_actor ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    UPDATE public.devices SET grade = 'E' WHERE id = dev;
    r := r || ' [invalid_grade_refused FAIL]';
  EXCEPTION WHEN check_violation THEN r := r || ' [invalid_grade_refused PASS]'; END;
  BEGIN
    UPDATE public.devices SET grade = 'b' WHERE id = dev;
    r := r || ' [lowercase_grade_refused FAIL]';
  EXCEPTION WHEN check_violation THEN r := r || ' [lowercase_grade_refused PASS]'; END;

  UPDATE public.devices SET grade = 'A' WHERE id = dev;
  PERFORM set_config('role', me, true);
  SELECT count(*) INTO n FROM public.audit_events
    WHERE entity_id = dev AND details->'changed'->'grade'->>'from' = 'B' AND details->'changed'->'grade'->>'to' = 'A';
  r := r || ' [regrade_keeps_old_value_in_history ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ']';
  PERFORM set_config('role', 'authenticated', true);

  -- Auditor can read but not grade (RLS filters the update to zero rows).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uau, 'role','authenticated','aal','aal1')::text, true);
  UPDATE public.devices SET grade = 'D' WHERE id = dev;
  SELECT grade INTO g FROM public.devices WHERE id = dev;
  r := r || ' [auditor_cannot_grade ' || CASE WHEN g = 'A' THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Another company cannot see or grade it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ux, 'role','authenticated','aal','aal2')::text, true);
  UPDATE public.devices SET grade = 'D' WHERE id = dev;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || ' [other_company_cannot_grade ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';

  -- Grade history cannot be rewritten by app users.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated','aal','aal2')::text, true);
  BEGIN
    DELETE FROM public.audit_events WHERE entity_id = dev;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := r || ' [grade_history_not_deletable ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ']';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' [grade_history_not_deletable PASS]'; END;

  PERFORM set_config('role', me, true);
  SELECT grade INTO g FROM public.devices WHERE id = dev;
  r := r || ' [final_grade_is_A ' || CASE WHEN g = 'A' THEN 'PASS' ELSE 'FAIL' END || ']';
  RAISE EXCEPTION 'RESULTS:%', r;
END $$;
