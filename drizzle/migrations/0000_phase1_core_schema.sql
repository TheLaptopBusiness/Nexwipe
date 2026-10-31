-- NextDrive Phase 1: organizations, roles, inventory, clients, projects, custody, audit.

-- ===== Enums =====
CREATE TYPE public.org_role AS ENUM ('owner','admin','technician','auditor','customer_viewer');
CREATE TYPE public.org_status AS ENUM ('active','suspended','closed');
CREATE TYPE public.membership_status AS ENUM ('active','revoked');
CREATE TYPE public.invitation_status AS ENUM ('pending','accepted','revoked');
CREATE TYPE public.project_status AS ENUM ('planned','active','on_hold','completed','cancelled');
CREATE TYPE public.batch_status AS ENUM ('open','processing','closed');
CREATE TYPE public.device_status AS ENUM ('received','awaiting_processing','in_processing','quarantined','processed','released','referred_manual');
CREATE TYPE public.intake_condition AS ENUM ('good','fair','damaged','missing_parts','unknown');
CREATE TYPE public.drive_interface AS ENUM ('sata_hdd','sata_ssd','nvme_ssd','unsupported_other');
CREATE TYPE public.record_source AS ENUM ('manual','csv_import','agent_reported');
CREATE TYPE public.custody_event_type AS ENUM ('received','moved','assigned','status_changed','quarantined','released','drive_attached','drive_detached','note');

-- ===== Shared trigger: updated_at =====
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ===== Profiles =====
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, lower(NEW.email), NULLIF(NEW.raw_user_meta_data->>'full_name',''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== Platform admins (NextDrive staff) =====
CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- ===== Organizations =====
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  status public.org_status NOT NULL DEFAULT 'active',
  is_demo boolean NOT NULL DEFAULT false,
  brand_display_name text,
  evidence_retention_days integer NOT NULL DEFAULT 2555 CHECK (evidence_retention_days BETWEEN 30 AND 36500),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== Memberships =====
CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.org_role NOT NULL,
  status public.membership_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON public.memberships(user_id) WHERE status = 'active';
GRANT SELECT ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- ===== Access helper functions (SECURITY DEFINER avoids RLS recursion) =====
CREATE OR REPLACE FUNCTION public.has_org_role(_org uuid, _roles public.org_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN public.organizations o ON o.id = m.org_id
    WHERE m.org_id = _org AND m.user_id = auth.uid()
      AND m.status = 'active' AND o.status = 'active'
      AND m.role = ANY(_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_org_role(_org, ARRAY['owner','admin','technician','auditor','customer_viewer']::public.org_role[])
$$;

-- Staff = every role except customer viewer.
CREATE OR REPLACE FUNCTION public.is_org_staff(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_org_role(_org, ARRAY['owner','admin','technician','auditor']::public.org_role[])
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.shares_org_with(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships mine
    JOIN public.memberships theirs ON theirs.org_id = mine.org_id
    WHERE mine.user_id = auth.uid() AND mine.status = 'active'
      AND mine.role IN ('owner','admin','technician','auditor')
      AND theirs.user_id = _user
  )
$$;

-- Policies: profiles / platform admins / organizations / memberships
CREATE POLICY "Read own or co-member profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_org_with(id));
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Platform admins read own row" ON public.platform_admins FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Members read their organization" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id) OR public.is_platform_admin());
CREATE POLICY "Owners and admins update organization settings" ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_org_role(id, ARRAY['owner','admin']::public.org_role[]))
  WITH CHECK (public.has_org_role(id, ARRAY['owner','admin']::public.org_role[]));

-- Customers cannot change platform-controlled organization columns.
CREATE OR REPLACE FUNCTION public.protect_org_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_user = 'authenticated' AND NOT public.is_platform_admin() THEN
    NEW.status := OLD.status;
    NEW.is_demo := OLD.is_demo;
    NEW.created_by := OLD.created_by;
    NEW.slug := OLD.slug;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organizations_protect BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.protect_org_columns();

CREATE POLICY "Staff read org memberships; viewers read own" ON public.memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_staff(org_id));
-- No INSERT/UPDATE/DELETE policies: membership changes go through audited RPCs only.

-- ===== Invitations =====
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND position('@' in email) > 1),
  role public.org_role NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status public.invitation_status NOT NULL DEFAULT 'pending',
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_by uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_org_idx ON public.invitations(org_id, status);
GRANT SELECT ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners and admins read invitations" ON public.invitations FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));

-- ===== Sites =====
CREATE TABLE public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  code text,
  address text,
  timezone text NOT NULL DEFAULT 'UTC',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER sites_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Staff read sites" ON public.sites FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE POLICY "Admins insert sites" ON public.sites FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "Admins update sites" ON public.sites FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "Admins delete sites" ON public.sites FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));

-- ===== Downstream clients =====
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  contact_name text,
  contact_email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== Projects =====
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  site_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  reference text,
  status public.project_status NOT NULL DEFAULT 'planned',
  expected_device_count integer CHECK (expected_device_count IS NULL OR expected_device_count >= 0),
  starts_on date,
  due_on date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, site_id) REFERENCES public.sites(org_id, id) ON DELETE RESTRICT
);
CREATE INDEX projects_client_idx ON public.projects(org_id, client_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== Client access grants (customer viewers -> projects) =====
CREATE TABLE public.client_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  granted_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (org_id, user_id) REFERENCES public.memberships(org_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, project_id) REFERENCES public.projects(org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX client_access_grants_active_uq ON public.client_access_grants(user_id, project_id) WHERE revoked_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON public.client_access_grants TO authenticated;
GRANT ALL ON public.client_access_grants TO service_role;
ALTER TABLE public.client_access_grants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_project_grant(_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_access_grants g
    JOIN public.memberships m ON m.org_id = g.org_id AND m.user_id = g.user_id AND m.status = 'active'
    JOIN public.organizations o ON o.id = g.org_id AND o.status = 'active'
    WHERE g.project_id = _project AND g.user_id = auth.uid() AND g.revoked_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.has_client_grant(_client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.client_id = _client AND public.has_project_grant(p.id)
  )
$$;

CREATE POLICY "Staff or granted viewers read clients" ON public.clients FOR SELECT TO authenticated
  USING (public.is_org_staff(org_id) OR public.has_client_grant(id));
CREATE POLICY "Admins insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "Admins update clients" ON public.clients FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "Admins delete clients" ON public.clients FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));

CREATE POLICY "Staff or granted viewers read projects" ON public.projects FOR SELECT TO authenticated
  USING (public.is_org_staff(org_id) OR public.has_project_grant(id));
CREATE POLICY "Admins insert projects" ON public.projects FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "Admins update projects" ON public.projects FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "Admins delete projects" ON public.projects FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));

CREATE POLICY "Admins read grants; users read own" ON public.client_access_grants FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));
CREATE POLICY "Admins create grants" ON public.client_access_grants FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]) AND granted_by = auth.uid());
CREATE POLICY "Admins revoke grants" ON public.client_access_grants FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));

-- ===== Batches =====
CREATE TABLE public.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status public.batch_status NOT NULL DEFAULT 'open',
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (project_id, name),
  FOREIGN KEY (org_id, project_id) REFERENCES public.projects(org_id, id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batches TO authenticated;
GRANT ALL ON public.batches TO service_role;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER batches_updated_at BEFORE UPDATE ON public.batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Staff or granted viewers read batches" ON public.batches FOR SELECT TO authenticated
  USING (public.is_org_staff(org_id) OR public.has_project_grant(project_id));
CREATE POLICY "Operators insert batches" ON public.batches FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[]));
CREATE POLICY "Operators update batches" ON public.batches FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[]));
CREATE POLICY "Admins delete batches" ON public.batches FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));

-- ===== Devices (laptops) =====
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_tag text NOT NULL CHECK (char_length(asset_tag) BETWEEN 1 AND 64),
  manufacturer text,
  model text,
  system_serial text,
  cpu text,
  ram_gb numeric(6,1) CHECK (ram_gb IS NULL OR ram_gb >= 0),
  site_id uuid,
  client_id uuid,
  project_id uuid,
  batch_id uuid,
  intake_condition public.intake_condition NOT NULL DEFAULT 'unknown',
  assigned_technician uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  status public.device_status NOT NULL DEFAULT 'received',
  hardware_verified boolean NOT NULL DEFAULT false,
  source public.record_source NOT NULL DEFAULT 'manual',
  battery_health_pct integer CHECK (battery_health_pct IS NULL OR battery_health_pct BETWEEN 0 AND 100),
  battery_notes text,
  diagnostic_notes text,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, asset_tag),
  FOREIGN KEY (org_id, site_id) REFERENCES public.sites(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id) REFERENCES public.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, batch_id) REFERENCES public.batches(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, assigned_technician) REFERENCES public.memberships(org_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX devices_serial_idx ON public.devices(org_id, lower(system_serial));
CREATE INDEX devices_received_idx ON public.devices(org_id, received_at DESC);
CREATE INDEX devices_project_idx ON public.devices(org_id, project_id);
CREATE INDEX devices_status_idx ON public.devices(org_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER devices_updated_at BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Staff read devices" ON public.devices FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE POLICY "Operators insert devices" ON public.devices FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[]));
CREATE POLICY "Operators update devices" ON public.devices FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[]));
CREATE POLICY "Admins delete devices" ON public.devices FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));

-- Device integrity: browser users cannot mark hardware verified or demo; project/client/batch must agree.
CREATE OR REPLACE FUNCTION public.validate_device()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _project_client uuid; _batch_project uuid; _org_demo boolean;
BEGIN
  IF current_user = 'authenticated' THEN
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
CREATE TRIGGER devices_validate BEFORE INSERT OR UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.validate_device();

-- ===== Drives (storage media; identity separate from laptop) =====
CREATE TABLE public.drives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  serial text NOT NULL CHECK (char_length(serial) BETWEEN 1 AND 128),
  manufacturer text,
  model text,
  interface public.drive_interface NOT NULL,
  capacity_bytes bigint CHECK (capacity_bytes IS NULL OR capacity_bytes > 0),
  firmware_version text,
  source public.record_source NOT NULL DEFAULT 'manual',
  hardware_verified boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE UNIQUE INDEX drives_identity_uq ON public.drives(org_id, coalesce(lower(model),''), lower(serial));
CREATE INDEX drives_serial_idx ON public.drives(org_id, lower(serial));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drives TO authenticated;
GRANT ALL ON public.drives TO service_role;
ALTER TABLE public.drives ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER drives_updated_at BEFORE UPDATE ON public.drives FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Staff read drives" ON public.drives FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE POLICY "Operators insert drives" ON public.drives FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[]));
CREATE POLICY "Operators update drives" ON public.drives FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[]));
CREATE POLICY "Admins delete drives" ON public.drives FOR DELETE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]));

CREATE OR REPLACE FUNCTION public.validate_drive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_user = 'authenticated' THEN
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
CREATE TRIGGER drives_validate BEFORE INSERT OR UPDATE ON public.drives FOR EACH ROW EXECUTE FUNCTION public.validate_drive();

-- ===== Device ↔ drive associations (history preserved) =====
CREATE TABLE public.device_drive_associations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  drive_id uuid NOT NULL,
  slot text,
  attached_at timestamptz NOT NULL DEFAULT now(),
  attached_by uuid DEFAULT auth.uid(),
  detached_at timestamptz,
  detached_by uuid,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, device_id) REFERENCES public.devices(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, drive_id) REFERENCES public.drives(org_id, id) ON DELETE CASCADE,
  CHECK (detached_at IS NULL OR detached_at >= attached_at)
);
CREATE UNIQUE INDEX dda_one_active_device_per_drive ON public.device_drive_associations(drive_id) WHERE detached_at IS NULL;
CREATE INDEX dda_device_idx ON public.device_drive_associations(device_id);
GRANT SELECT, INSERT, UPDATE ON public.device_drive_associations TO authenticated;
GRANT ALL ON public.device_drive_associations TO service_role;
ALTER TABLE public.device_drive_associations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read associations" ON public.device_drive_associations FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE POLICY "Operators attach drives" ON public.device_drive_associations FOR INSERT TO authenticated WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[]));
CREATE POLICY "Operators detach drives" ON public.device_drive_associations FOR UPDATE TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[]));

-- Associations are history: only detaching is allowed after creation.
CREATE OR REPLACE FUNCTION public.guard_association_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.detached_at IS NOT NULL THEN
    RAISE EXCEPTION 'A detached drive association cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.device_id <> OLD.device_id OR NEW.drive_id <> OLD.drive_id OR NEW.org_id <> OLD.org_id
     OR NEW.attached_at <> OLD.attached_at OR NEW.detached_at IS NULL THEN
    RAISE EXCEPTION 'Only detaching a drive is allowed' USING ERRCODE = '42501';
  END IF;
  NEW.detached_by := auth.uid();
  RETURN NEW;
END $$;
CREATE TRIGGER dda_guard BEFORE UPDATE ON public.device_drive_associations FOR EACH ROW EXECUTE FUNCTION public.guard_association_update();

-- ===== Custody events (append-only) =====
CREATE TABLE public.custody_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  event_type public.custody_event_type NOT NULL,
  from_value text,
  to_value text,
  notes text,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, device_id) REFERENCES public.devices(org_id, id) ON DELETE CASCADE
);
CREATE INDEX custody_device_idx ON public.custody_events(device_id, occurred_at DESC);
GRANT SELECT, INSERT ON public.custody_events TO authenticated;
GRANT ALL ON public.custody_events TO service_role;
ALTER TABLE public.custody_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read custody" ON public.custody_events FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE POLICY "Operators add custody notes" ON public.custody_events FOR INSERT TO authenticated
  WITH CHECK (event_type = 'note' AND actor_id = auth.uid()
    AND public.has_org_role(org_id, ARRAY['owner','admin','technician']::public.org_role[]));

CREATE OR REPLACE FUNCTION public.device_custody_trail()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.custody_events(org_id, device_id, event_type, to_value, notes, actor_id)
    VALUES (NEW.org_id, NEW.id, 'received', NEW.site_id::text, 'Source: ' || NEW.source::text, auth.uid());
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.custody_events(org_id, device_id, event_type, from_value, to_value, actor_id)
      VALUES (NEW.org_id, NEW.id,
        CASE NEW.status WHEN 'quarantined' THEN 'quarantined'::public.custody_event_type
                        WHEN 'released' THEN 'released'::public.custody_event_type
                        ELSE 'status_changed'::public.custody_event_type END,
        OLD.status::text, NEW.status::text, auth.uid());
    END IF;
    IF NEW.site_id IS DISTINCT FROM OLD.site_id THEN
      INSERT INTO public.custody_events(org_id, device_id, event_type, from_value, to_value, actor_id)
      VALUES (NEW.org_id, NEW.id, 'moved', OLD.site_id::text, NEW.site_id::text, auth.uid());
    END IF;
    IF NEW.assigned_technician IS DISTINCT FROM OLD.assigned_technician THEN
      INSERT INTO public.custody_events(org_id, device_id, event_type, from_value, to_value, actor_id)
      VALUES (NEW.org_id, NEW.id, 'assigned', OLD.assigned_technician::text, NEW.assigned_technician::text, auth.uid());
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER devices_custody AFTER INSERT OR UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.device_custody_trail();

CREATE OR REPLACE FUNCTION public.association_custody_trail()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.custody_events(org_id, device_id, event_type, to_value, notes, actor_id)
    VALUES (NEW.org_id, NEW.device_id, 'drive_attached', NEW.drive_id::text, NEW.slot, auth.uid());
  ELSIF NEW.detached_at IS NOT NULL AND OLD.detached_at IS NULL THEN
    INSERT INTO public.custody_events(org_id, device_id, event_type, from_value, notes, actor_id)
    VALUES (NEW.org_id, NEW.device_id, 'drive_detached', NEW.drive_id::text, NEW.slot, auth.uid());
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER dda_custody AFTER INSERT OR UPDATE ON public.device_drive_associations FOR EACH ROW EXECUTE FUNCTION public.association_custody_trail();

-- ===== Application audit events (append-only for app users) =====
CREATE TABLE public.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid,
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_time_idx ON public.audit_events(org_id, created_at DESC);
GRANT SELECT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners, admins and auditors read audit" ON public.audit_events FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','auditor']::public.org_role[]));

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row jsonb; _old jsonb; _org uuid; _details jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN _row := to_jsonb(OLD); ELSE _row := to_jsonb(NEW); END IF;
  _row := _row - 'token_hash';
  _org := CASE WHEN TG_TABLE_NAME = 'organizations' THEN (_row->>'id')::uuid ELSE (_row->>'org_id')::uuid END;
  IF TG_OP = 'UPDATE' THEN
    _old := to_jsonb(OLD) - 'token_hash';
    SELECT coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', _old->n.key, 'to', n.value)), '{}'::jsonb)
      INTO _details
      FROM jsonb_each(_row) n
      WHERE n.key NOT IN ('updated_at') AND (_old->n.key) IS DISTINCT FROM n.value;
    IF _details = '{}'::jsonb THEN RETURN NULL; END IF;
    _details := jsonb_build_object('changed', _details);
  ELSE
    _details := jsonb_build_object('row', _row);
  END IF;
  INSERT INTO public.audit_events(org_id, actor_id, action, entity_type, entity_id, details)
  VALUES (_org, auth.uid(), TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, (_row->>'id')::uuid, _details);
  RETURN NULL;
END $$;

CREATE TRIGGER audit_organizations AFTER INSERT OR UPDATE OR DELETE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_memberships AFTER INSERT OR UPDATE OR DELETE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_invitations AFTER INSERT OR UPDATE OR DELETE ON public.invitations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_sites AFTER INSERT OR UPDATE OR DELETE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_clients AFTER INSERT OR UPDATE OR DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_projects AFTER INSERT OR UPDATE OR DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_grants AFTER INSERT OR UPDATE OR DELETE ON public.client_access_grants FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_batches AFTER INSERT OR UPDATE OR DELETE ON public.batches FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_devices AFTER INSERT OR UPDATE OR DELETE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_drives AFTER INSERT OR UPDATE OR DELETE ON public.drives FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_dda AFTER INSERT OR UPDATE OR DELETE ON public.device_drive_associations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_custody AFTER INSERT ON public.custody_events FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- ===== Membership RPCs (the only path to change roles) =====
CREATE OR REPLACE FUNCTION public.create_organization(_name text, _slug text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.organizations(name, slug, created_by) VALUES (trim(_name), lower(trim(_slug)), _uid) RETURNING id INTO _org;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (_org, _uid, 'owner');
  RETURN _org;
END $$;

CREATE OR REPLACE FUNCTION public.create_invitation(_org uuid, _email text, _role public.org_role)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _token text;
BEGIN
  IF NOT public.has_org_role(_org, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only owners and administrators can invite users' USING ERRCODE = '42501';
  END IF;
  IF _role = 'owner' AND NOT public.has_org_role(_org, ARRAY['owner']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only owners can invite another owner' USING ERRCODE = '42501';
  END IF;
  UPDATE public.invitations SET status = 'revoked'
    WHERE org_id = _org AND email = lower(trim(_email)) AND status = 'pending';
  _token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.invitations(org_id, email, role, token_hash, invited_by)
  VALUES (_org, lower(trim(_email)), _role, encode(extensions.digest(_token, 'sha256'), 'hex'), auth.uid());
  RETURN _token;
END $$;

CREATE OR REPLACE FUNCTION public.preview_invitation(_token text)
RETURNS TABLE(org_name text, role public.org_role, email text, expired boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT o.name, i.role, i.email, i.expires_at < now()
  FROM public.invitations i JOIN public.organizations o ON o.id = i.org_id
  WHERE i.token_hash = encode(extensions.digest(_token, 'sha256'), 'hex') AND i.status = 'pending'
    AND auth.uid() IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _inv public.invitations; _email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF _email IS NULL THEN RAISE EXCEPTION 'Verify your email address before accepting an invitation' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _inv FROM public.invitations
    WHERE token_hash = encode(extensions.digest(_token, 'sha256'), 'hex') AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found or no longer valid' USING ERRCODE = 'P0002'; END IF;
  IF _inv.expires_at < now() THEN RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023'; END IF;
  IF _inv.email <> _email THEN RAISE EXCEPTION 'This invitation was sent to a different email address' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.memberships(org_id, user_id, role, status)
    VALUES (_inv.org_id, auth.uid(), _inv.role, 'active')
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', revoked_at = NULL;
  UPDATE public.invitations SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now() WHERE id = _inv.id;
  RETURN _inv.org_id;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_invitation(_invitation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid;
BEGIN
  SELECT org_id INTO _org FROM public.invitations WHERE id = _invitation;
  IF _org IS NULL OR NOT public.has_org_role(_org, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.invitations SET status = 'revoked' WHERE id = _invitation AND status = 'pending';
END $$;

CREATE OR REPLACE FUNCTION public.update_member_role(_membership uuid, _role public.org_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.memberships; _caller_owner boolean;
BEGIN
  SELECT * INTO _m FROM public.memberships WHERE id = _membership FOR UPDATE;
  IF NOT FOUND OR NOT public.has_org_role(_m.org_id, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only owners and administrators can change roles' USING ERRCODE = '42501';
  END IF;
  IF _m.user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own role' USING ERRCODE = '42501'; END IF;
  _caller_owner := public.has_org_role(_m.org_id, ARRAY['owner']::public.org_role[]);
  IF (_role = 'owner' OR _m.role = 'owner') AND NOT _caller_owner THEN
    RAISE EXCEPTION 'Only owners can grant or remove the owner role' USING ERRCODE = '42501';
  END IF;
  UPDATE public.memberships SET role = _role WHERE id = _membership;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_member(_membership uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.memberships;
BEGIN
  SELECT * INTO _m FROM public.memberships WHERE id = _membership FOR UPDATE;
  IF NOT FOUND OR NOT public.has_org_role(_m.org_id, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only owners and administrators can remove users' USING ERRCODE = '42501';
  END IF;
  IF _m.user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot remove yourself' USING ERRCODE = '42501'; END IF;
  IF _m.role = 'owner' AND NOT public.has_org_role(_m.org_id, ARRAY['owner']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only owners can remove an owner' USING ERRCODE = '42501';
  END IF;
  UPDATE public.memberships SET status = 'revoked', revoked_at = now() WHERE id = _membership;
  UPDATE public.client_access_grants SET revoked_at = now() WHERE org_id = _m.org_id AND user_id = _m.user_id AND revoked_at IS NULL;
END $$;

-- An organization must always keep at least one active owner.
CREATE OR REPLACE FUNCTION public.ensure_owner_remains()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active' AND (NEW.role <> 'owner' OR NEW.status <> 'active') THEN
    IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = OLD.org_id AND id <> OLD.id AND role = 'owner' AND status = 'active') THEN
      RAISE EXCEPTION 'An organization must keep at least one active owner' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memberships_owner_guard BEFORE UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.ensure_owner_remains();

-- Lock down helper/RPC execution to signed-in users.
REVOKE EXECUTE ON FUNCTION public.create_organization(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_invitation(uuid, text, public.org_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_invitation(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_invitation(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_invitation(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_member_role(uuid, public.org_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invitation(uuid, text, public.org_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_role(uuid, public.org_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_member(uuid) TO authenticated;
