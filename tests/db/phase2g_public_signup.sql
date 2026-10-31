-- Public sign-up acceptance checks (self-rolling-back). Run with the privileged database tool.
DO $$
DECLARE
  uv uuid := gen_random_uuid();  -- verified public sign-up
  uu uuid := gen_random_uuid();  -- unverified public sign-up
  uo uuid := gen_random_uuid();  -- owner of an existing company
  oo uuid; ov uuid; r text := ''; ok boolean; n int; i int;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at, aud, role, raw_user_meta_data) VALUES
    (uv, 'p2g-verified-' || substr(uv::text,1,8) || '@test.local', now(), 'authenticated', 'authenticated',
       jsonb_build_object('full_name', repeat('x', 300), 'role', 'owner', 'is_platform_admin', true)),
    (uu, 'p2g-unverified-' || substr(uu::text,1,8) || '@test.local', NULL, 'authenticated', 'authenticated', '{}'),
    (uo, 'p2g-owner-' || substr(uo::text,1,8) || '@test.local', now(), 'authenticated', 'authenticated', '{}');

  -- 1. Unverified accounts cannot create an organization.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uu, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.create_organization('Unverified Co', 'p2g-unv-' || substr(uu::text,1,8)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Verify your email%'; END;
  RESET ROLE;
  r := r || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' unverified cannot create organization' || E'\n';

  -- 2. Verified sign-up creates its own organization as owner; metadata grants nothing.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  SET LOCAL ROLE authenticated;
  ov := public.create_organization('Verified Co', 'p2g-ver-' || substr(uv::text,1,8));
  RESET ROLE;
  SELECT count(*) INTO n FROM public.memberships WHERE user_id = uv;
  r := r || CASE WHEN n = 1 AND EXISTS (SELECT 1 FROM public.memberships WHERE user_id = uv AND org_id = ov AND role = 'owner') THEN 'PASS' ELSE 'FAIL' END || ' verified sign-up owns only its new organization' || E'\n';
  r := r || CASE WHEN NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = uv) THEN 'PASS' ELSE 'FAIL' END || ' sign-up metadata never grants platform admin' || E'\n';
  r := r || CASE WHEN (SELECT char_length(full_name) FROM public.profiles WHERE id = uv) = 120 THEN 'PASS' ELSE 'FAIL' END || ' profile name is bounded to 120 characters' || E'\n';

  -- 3. Cannot write a membership into someone else's organization or self-grant platform admin.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uo, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  SET LOCAL ROLE authenticated;
  oo := public.create_organization('Existing Co', 'p2g-own-' || substr(uo::text,1,8));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN INSERT INTO public.memberships(org_id, user_id, role) VALUES (oo, uv, 'technician'); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  RESET ROLE;
  r := r || CASE WHEN ok AND NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = oo AND user_id = uv) THEN 'PASS' ELSE 'FAIL' END || ' cannot join an existing organization without an invitation' || E'\n';
  SET LOCAL ROLE authenticated;
  BEGIN INSERT INTO public.platform_admins(user_id) VALUES (uv); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  BEGIN PERFORM public.accept_invitation('not-a-real-token-' || md5(random()::text)); ok := ok AND false;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT count(*) INTO n FROM public.sites WHERE org_id = oo;
  SELECT count(*) INTO i FROM public.organizations WHERE id = oo;
  RESET ROLE;
  r := r || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' cannot self-grant platform admin; forged invitation refused' || E'\n';
  r := r || CASE WHEN i = 0 THEN 'PASS' ELSE 'FAIL' END || ' other organization is invisible to a new sign-up' || E'\n';

  -- 4. Abuse limit: at most 3 organizations per hour.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.create_organization('V2', 'p2g-v2-' || substr(uv::text,1,8));
  PERFORM public.create_organization('V3', 'p2g-v3-' || substr(uv::text,1,8));
  BEGIN PERFORM public.create_organization('V4', 'p2g-v4-' || substr(uv::text,1,8)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE 'Too many organizations%'; END;
  -- 5. Invalid input refused.
  BEGIN PERFORM public.create_organization('x', 'p2g-x'); ok := ok AND false;
  EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE 'Company name%'; END;
  RESET ROLE;
  r := r || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' organization creation rate limit and input checks' || E'\n';

  RAISE EXCEPTION 'RESULTS:%', E'\n' || r;
END $$;
