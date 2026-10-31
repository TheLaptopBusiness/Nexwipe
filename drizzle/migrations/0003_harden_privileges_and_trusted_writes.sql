-- Only server-side trusted code (service role / migrations) may set verified or platform-controlled fields.
CREATE OR REPLACE FUNCTION public.is_untrusted_caller()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(auth.role(), '') IN ('authenticated', 'anon')
$$;

CREATE OR REPLACE FUNCTION public.protect_org_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_untrusted_caller() AND NOT public.is_platform_admin() THEN
    NEW.status := OLD.status;
    NEW.is_demo := OLD.is_demo;
    NEW.created_by := OLD.created_by;
    NEW.slug := OLD.slug;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.validate_device()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _project_client uuid; _batch_project uuid; _org_demo boolean;
BEGIN
  IF public.is_untrusted_caller() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.hardware_verified := false;
      IF NEW.source = 'agent_reported' THEN NEW.source := 'manual'; END IF;
      NEW.created_by := auth.uid();
    ELSE
      NEW.hardware_verified := OLD.hardware_verified;
      NEW.source := OLD.source;
      NEW.created_by := OLD.created_by;
      NEW.org_id := OLD.org_id;
    END IF;
  END IF;
  SELECT is_demo INTO _org_demo FROM public.organizations WHERE id = NEW.org_id;
  NEW.is_demo := coalesce(_org_demo, false);
  IF NEW.project_id IS NOT NULL THEN
    SELECT client_id INTO _project_client FROM public.projects WHERE id = NEW.project_id AND org_id = NEW.org_id;
    IF NEW.client_id IS NULL THEN NEW.client_id := _project_client;
    ELSIF NEW.client_id <> _project_client THEN
      RAISE EXCEPTION 'Device client does not match the project client' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.batch_id IS NOT NULL THEN
    SELECT project_id INTO _batch_project FROM public.batches WHERE id = NEW.batch_id AND org_id = NEW.org_id;
    IF NEW.project_id IS NULL OR NEW.project_id <> _batch_project THEN
      RAISE EXCEPTION 'Device batch does not belong to the device project' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.validate_drive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_untrusted_caller() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.hardware_verified := false;
      IF NEW.source = 'agent_reported' THEN NEW.source := 'manual'; END IF;
    ELSE
      NEW.hardware_verified := OLD.hardware_verified;
      NEW.source := OLD.source;
      NEW.org_id := OLD.org_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Explicit least-privilege table grants (do not rely on platform defaults).
REVOKE ALL ON public.audit_events, public.custody_events, public.memberships, public.invitations,
  public.platform_admins, public.organizations, public.profiles, public.sites, public.clients,
  public.projects, public.client_access_grants, public.batches, public.devices, public.drives,
  public.device_drive_associations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_events FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.custody_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.memberships, public.invitations, public.platform_admins FROM authenticated;
REVOKE INSERT, DELETE, TRUNCATE ON public.organizations, public.profiles FROM authenticated;
REVOKE DELETE, TRUNCATE ON public.client_access_grants, public.device_drive_associations FROM authenticated;
REVOKE TRUNCATE ON public.sites, public.clients, public.projects, public.batches, public.devices, public.drives FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, SELECT ON public.pilot_requests FROM anon;
GRANT SELECT ON public.audit_events, public.custody_events, public.memberships, public.invitations, public.platform_admins TO authenticated;
GRANT INSERT ON public.custody_events TO authenticated;