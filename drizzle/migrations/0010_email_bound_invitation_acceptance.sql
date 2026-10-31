-- Invitations addressed to the caller's CONFIRMED email can be listed and accepted without the link token,
-- so an invitee who lands on the home page (e.g. after an email sign-in link) still finds the invitation.
-- Equivalent proof to the token: the session belongs to someone who controls that mailbox.
CREATE OR REPLACE FUNCTION public.my_pending_invitations()
RETURNS TABLE(invitation_id uuid, org_name text, role public.org_role, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, o.name, i.role, i.expires_at
  FROM public.invitations i JOIN public.organizations o ON o.id = i.org_id
  WHERE i.status = 'pending' AND i.expires_at > now() AND o.status = 'active'
    AND i.email = (SELECT lower(email) FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.org_id = i.org_id AND m.user_id = auth.uid() AND m.status = 'active')
  ORDER BY i.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.accept_invitation_by_id(_invitation uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv public.invitations; _email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF _email IS NULL THEN RAISE EXCEPTION 'Verify your email address before accepting an invitation' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _inv FROM public.invitations WHERE id = _invitation AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR _inv.email <> _email THEN RAISE EXCEPTION 'Invitation not found or no longer valid' USING ERRCODE = 'P0002'; END IF;
  IF _inv.expires_at < now() THEN RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.memberships(org_id, user_id, role, status)
    VALUES (_inv.org_id, auth.uid(), _inv.role, 'active')
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', revoked_at = NULL;
  UPDATE public.invitations SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now() WHERE id = _inv.id;
  RETURN _inv.org_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.my_pending_invitations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_invitation_by_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_pending_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation_by_id(uuid) TO authenticated;