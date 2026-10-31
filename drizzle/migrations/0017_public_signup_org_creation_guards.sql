CREATE OR REPLACE FUNCTION public.create_organization(_name text, _slug text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _org uuid; _uid uuid := auth.uid(); _confirmed timestamptz; _n text := trim(coalesce(_name, '')); _s text := lower(trim(coalesce(_slug, '')));
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  -- Public sign-up: only verified email addresses may create an organization.
  SELECT email_confirmed_at INTO _confirmed FROM auth.users WHERE id = _uid;
  IF _confirmed IS NULL THEN
    RAISE EXCEPTION 'Verify your email address before creating an organization' USING ERRCODE = '42501';
  END IF;
  IF char_length(_n) < 2 OR char_length(_n) > 120 THEN
    RAISE EXCEPTION 'Company name must be 2-120 characters' USING ERRCODE = '22023';
  END IF;
  IF _s !~ '^[a-z0-9][a-z0-9-]{1,47}$' THEN
    RAISE EXCEPTION 'URL name must be 2-48 lowercase letters, numbers or dashes' USING ERRCODE = '22023';
  END IF;
  -- Abuse limits: at most 3 new organizations per hour and 5 owned organizations per account.
  IF (SELECT count(*) FROM public.organizations WHERE created_by = _uid AND created_at > now() - interval '1 hour') >= 3 THEN
    RAISE EXCEPTION 'Too many organizations created recently. Try again later.' USING ERRCODE = '54000';
  END IF;
  IF (SELECT count(*) FROM public.memberships WHERE user_id = _uid AND role = 'owner' AND status = 'active') >= 5 THEN
    RAISE EXCEPTION 'An account can own at most 5 organizations. Contact support for more.' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.organizations(name, slug, created_by) VALUES (_n, _s, _uid) RETURNING id INTO _org;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (_org, _uid, 'owner');
  RETURN _org;
END $function$;

-- Sign-up metadata is user-supplied: store only a bounded display name, never roles or permissions.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, lower(NEW.email), NULLIF(left(trim(coalesce(NEW.raw_user_meta_data->>'full_name', '')), 120), ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $function$;