-- ===== Phase 2: policies, agents, jobs, authorizations, events, evidence =====
CREATE TYPE public.job_status AS ENUM ('draft','awaiting_authorization','queued','running','verifying','awaiting_validation','approved','failed','interrupted','unsupported','quarantined','cancelled');
CREATE TYPE public.execution_outcome AS ENUM ('pending','succeeded','failed','not_run');
CREATE TYPE public.verification_outcome AS ENUM ('pending','passed','failed','not_run');
CREATE TYPE public.erasure_method AS ENUM ('nvme_sanitize_crypto','nvme_sanitize_block','nvme_format_crypto','ata_sanitize_crypto','ata_sanitize_block','ata_enhanced_secure_erase','ata_secure_erase','overwrite_single_pass');
CREATE TYPE public.agent_status AS ENUM ('active','revoked');
CREATE TYPE public.failure_action AS ENUM ('fail','quarantine');

-- Simulator labelling on inventory rows (set only by the simulator RPC, immutable afterwards).
ALTER TABLE public.devices ADD COLUMN is_simulated boolean NOT NULL DEFAULT false;
ALTER TABLE public.drives ADD COLUMN is_simulated boolean NOT NULL DEFAULT false;

-- Which methods are physically meaningful for which interface.
CREATE OR REPLACE FUNCTION public.method_fits_interface(_m public.erasure_method, _i public.drive_interface)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _i
    WHEN 'nvme_ssd' THEN _m IN ('nvme_sanitize_crypto','nvme_sanitize_block','nvme_format_crypto')
    WHEN 'sata_ssd' THEN _m IN ('ata_sanitize_crypto','ata_sanitize_block','ata_enhanced_secure_erase','ata_secure_erase')
    WHEN 'sata_hdd' THEN _m IN ('ata_sanitize_block','ata_enhanced_secure_erase','ata_secure_erase','overwrite_single_pass')
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.job_transition_allowed(_from public.job_status, _to public.job_status)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (_from::text || '>' || _to::text) = ANY (ARRAY[
    'draft>awaiting_authorization','draft>cancelled','draft>unsupported',
    'awaiting_authorization>queued','awaiting_authorization>cancelled','awaiting_authorization>unsupported',
    'queued>running','queued>awaiting_authorization','queued>cancelled','queued>unsupported','queued>quarantined',
    'running>verifying','running>failed','running>quarantined','running>interrupted','running>unsupported',
    'verifying>awaiting_validation','verifying>failed','verifying>quarantined','verifying>interrupted',
    'interrupted>running','interrupted>verifying','interrupted>failed','interrupted>quarantined',
    'awaiting_validation>approved','awaiting_validation>quarantined'
  ])
$$;

CREATE OR REPLACE FUNCTION public.job_is_terminal(_s public.job_status)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _s IN ('approved','failed','unsupported','quarantined','cancelled')
$$;

-- ----- Policies (immutable versions) -----
CREATE TABLE public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  is_archived boolean NOT NULL DEFAULT false,
  is_simulator boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)
);
GRANT SELECT ON public.policies TO authenticated;
GRANT ALL ON public.policies TO service_role;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read policies" ON public.policies FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE TRIGGER policies_updated_at BEFORE UPDATE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  allowed_manufacturers text[] NOT NULL,
  allowed_interfaces public.drive_interface[] NOT NULL,
  allowed_methods public.erasure_method[] NOT NULL,
  verification_method text NOT NULL CHECK (verification_method IN ('full_read','sample_read')),
  verification_sample_pct integer CHECK (verification_sample_pct IS NULL OR verification_sample_pct BETWEEN 1 AND 100),
  require_evidence boolean NOT NULL DEFAULT true,
  reviewer_roles public.org_role[] NOT NULL,
  require_separate_reviewer boolean NOT NULL DEFAULT true,
  on_execution_failure public.failure_action NOT NULL DEFAULT 'quarantine',
  on_verification_failure public.failure_action NOT NULL DEFAULT 'quarantine',
  authorization_ttl_minutes integer NOT NULL DEFAULT 30 CHECK (authorization_ttl_minutes BETWEEN 5 AND 240),
  change_note text CHECK (change_note IS NULL OR char_length(change_note) <= 1000),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (policy_id, version),
  FOREIGN KEY (org_id, policy_id) REFERENCES public.policies(org_id, id) ON DELETE RESTRICT,
  CHECK (cardinality(allowed_manufacturers) >= 1),
  CHECK (cardinality(allowed_interfaces) >= 1 AND NOT ('unsupported_other' = ANY (allowed_interfaces))),
  CHECK (cardinality(allowed_methods) >= 1),
  CHECK (verification_method = 'full_read' OR verification_sample_pct IS NOT NULL),
  CHECK (cardinality(reviewer_roles) >= 1 AND NOT ('auditor' = ANY (reviewer_roles)) AND NOT ('customer_viewer' = ANY (reviewer_roles)))
);
GRANT SELECT ON public.policy_versions TO authenticated;
GRANT ALL ON public.policy_versions TO service_role;
ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read policy versions" ON public.policy_versions FOR SELECT TO authenticated USING (public.is_org_staff(org_id));

CREATE OR REPLACE FUNCTION public.policy_versions_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Policy versions are immutable; create a new version instead' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER policy_versions_no_update BEFORE UPDATE OR DELETE ON public.policy_versions FOR EACH ROW EXECUTE FUNCTION public.policy_versions_immutable();

-- ----- Agents, credentials, enrollment -----
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  status public.agent_status NOT NULL DEFAULT 'active',
  is_simulated boolean NOT NULL DEFAULT false,
  agent_version text,
  platform text,
  hostname text,
  credential_prefix text NOT NULL,
  enrollment_token_id uuid,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz,
  last_state text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES public.sites(org_id, id) ON DELETE RESTRICT
);
GRANT SELECT ON public.agents TO authenticated;
GRANT ALL ON public.agents TO service_role;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read agents" ON public.agents FOR SELECT TO authenticated USING (public.is_org_staff(org_id));

-- Credential hashes are never readable by app users.
CREATE TABLE public.agent_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  credential_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id) ON DELETE CASCADE
);
GRANT ALL ON public.agent_credentials TO service_role;
ALTER TABLE public.agent_credentials ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.enrollment_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid,
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 120),
  token_hash text NOT NULL UNIQUE,
  is_simulated boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_agent uuid,
  revoked_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, site_id) REFERENCES public.sites(org_id, id) ON DELETE RESTRICT
);
GRANT SELECT ON public.enrollment_tokens TO authenticated;
GRANT ALL ON public.enrollment_tokens TO service_role;
ALTER TABLE public.enrollment_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners and admins read enrollment tokens" ON public.enrollment_tokens FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_role[]) OR (is_simulated AND public.is_org_staff(org_id)));

CREATE TABLE public.agent_request_nonces (
  agent_id uuid NOT NULL,
  nonce text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, nonce)
);
GRANT ALL ON public.agent_request_nonces TO service_role;
ALTER TABLE public.agent_request_nonces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.agent_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  device_id uuid,
  system_serial text,
  payload jsonb NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  reported_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, device_id) REFERENCES public.devices(org_id, id) ON DELETE SET NULL (device_id)
);
CREATE INDEX agent_discoveries_device_idx ON public.agent_discoveries(device_id, reported_at DESC);
GRANT SELECT ON public.agent_discoveries TO authenticated;
GRANT ALL ON public.agent_discoveries TO service_role;
ALTER TABLE public.agent_discoveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read discoveries" ON public.agent_discoveries FOR SELECT TO authenticated USING (public.is_org_staff(org_id));

-- ----- Jobs (one per drive) -----
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_number bigint GENERATED ALWAYS AS IDENTITY,
  device_id uuid NOT NULL,
  drive_id uuid NOT NULL,
  association_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  agent_id uuid,
  status public.job_status NOT NULL DEFAULT 'draft',
  is_simulated boolean NOT NULL DEFAULT false,
  target_asset_tag text NOT NULL,
  target_system_serial text,
  target_drive_serial text NOT NULL,
  target_drive_model text,
  target_drive_interface public.drive_interface NOT NULL,
  target_drive_capacity_bytes bigint,
  method public.erasure_method,
  execution_outcome public.execution_outcome NOT NULL DEFAULT 'pending',
  execution_detail jsonb,
  verification_outcome public.verification_outcome NOT NULL DEFAULT 'pending',
  verification_detail jsonb,
  review_decision text CHECK (review_decision IS NULL OR review_decision IN ('approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  current_phase text,
  progress_pct numeric(5,2) CHECK (progress_pct IS NULL OR progress_pct BETWEEN 0 AND 100),
  progress_measured boolean NOT NULL DEFAULT false,
  last_agent_seq integer NOT NULL DEFAULT 0,
  last_event_at timestamptz,
  exception_code text,
  exception_detail text,
  started_at timestamptz,
  execution_finished_at timestamptz,
  verification_finished_at timestamptz,
  finished_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  billable_unit boolean GENERATED ALWAYS AS (status = 'approved' AND NOT is_simulated) STORED,
  certificate_eligible boolean GENERATED ALWAYS AS (status = 'approved' AND NOT is_simulated) STORED,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, device_id) REFERENCES public.devices(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, drive_id) REFERENCES public.drives(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, association_id) REFERENCES public.device_drive_associations(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, policy_version_id) REFERENCES public.policy_versions(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX jobs_one_open_per_drive ON public.jobs(drive_id)
  WHERE status IN ('draft','awaiting_authorization','queued','running','verifying','interrupted','awaiting_validation');
CREATE INDEX jobs_org_status_idx ON public.jobs(org_id, status, updated_at DESC);
CREATE INDEX jobs_device_idx ON public.jobs(device_id, created_at DESC);
CREATE INDEX jobs_agent_idx ON public.jobs(agent_id) WHERE agent_id IS NOT NULL;
GRANT SELECT ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read jobs" ON public.jobs FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Server-enforced state machine. Runs for every caller, including trusted server code.
CREATE OR REPLACE FUNCTION public.guard_job_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.job_is_terminal(OLD.status) THEN
    RAISE EXCEPTION 'Job % is closed (%) and cannot change', OLD.job_number, OLD.status USING ERRCODE = 'ND409';
  END IF;
  IF NEW.org_id <> OLD.org_id OR NEW.device_id <> OLD.device_id OR NEW.drive_id <> OLD.drive_id
     OR NEW.association_id <> OLD.association_id OR NEW.policy_version_id <> OLD.policy_version_id
     OR NEW.is_simulated <> OLD.is_simulated OR NEW.target_drive_serial <> OLD.target_drive_serial
     OR NEW.target_asset_tag <> OLD.target_asset_tag OR NEW.created_at <> OLD.created_at
     OR NEW.target_system_serial IS DISTINCT FROM OLD.target_system_serial THEN
    RAISE EXCEPTION 'Job target and policy version are fixed at creation' USING ERRCODE = '42501';
  END IF;
  IF NEW.last_agent_seq < OLD.last_agent_seq THEN
    RAISE EXCEPTION 'Agent sequence cannot go backwards' USING ERRCODE = 'ND409';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.job_transition_allowed(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'Invalid job transition: % -> %', OLD.status, NEW.status USING ERRCODE = 'ND409';
    END IF;
  END IF;
  IF NEW.status = 'verifying' AND NEW.execution_outcome <> 'succeeded' THEN
    RAISE EXCEPTION 'Verification can only start after successful execution' USING ERRCODE = 'ND409';
  END IF;
  IF NEW.status = 'awaiting_validation' AND (NEW.execution_outcome <> 'succeeded' OR NEW.verification_outcome <> 'passed') THEN
    RAISE EXCEPTION 'Only executed and verified jobs can await validation' USING ERRCODE = 'ND409';
  END IF;
  IF NEW.status = 'approved' AND (NEW.reviewed_by IS NULL OR NEW.review_decision IS DISTINCT FROM 'approved'
      OR NEW.execution_outcome <> 'succeeded' OR NEW.verification_outcome <> 'passed') THEN
    RAISE EXCEPTION 'Approval requires a reviewer decision on an executed and verified job' USING ERRCODE = 'ND409';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_guard BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.guard_job_update();

CREATE OR REPLACE FUNCTION public.guard_job_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'draft' OR NEW.execution_outcome <> 'pending' OR NEW.verification_outcome <> 'pending'
     OR NEW.reviewed_by IS NOT NULL OR NEW.agent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Jobs start as drafts' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_guard_insert BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.guard_job_insert();

-- ----- Authorizations (single use, expiring) -----
CREATE TABLE public.job_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  device_id uuid NOT NULL,
  drive_id uuid NOT NULL,
  association_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  confirmed_asset_tag text NOT NULL,
  confirmed_drive_serial text NOT NULL,
  authorized_by uuid NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  local_confirmation_required boolean NOT NULL DEFAULT true,
  consumed_at timestamptz,
  local_confirmation jsonb,
  revoked_at timestamptz,
  revoke_reason text,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, device_id) REFERENCES public.devices(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, drive_id) REFERENCES public.drives(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, association_id) REFERENCES public.device_drive_associations(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, policy_version_id) REFERENCES public.policy_versions(org_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > authorized_at)
);
CREATE UNIQUE INDEX job_auth_one_live ON public.job_authorizations(job_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;
GRANT SELECT ON public.job_authorizations TO authenticated;
GRANT ALL ON public.job_authorizations TO service_role;
ALTER TABLE public.job_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read authorizations" ON public.job_authorizations FOR SELECT TO authenticated USING (public.is_org_staff(org_id));

CREATE OR REPLACE FUNCTION public.guard_authorization_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Authorization has already been used or revoked' USING ERRCODE = 'ND409';
  END IF;
  IF NEW.job_id <> OLD.job_id OR NEW.agent_id <> OLD.agent_id OR NEW.drive_id <> OLD.drive_id
     OR NEW.device_id <> OLD.device_id OR NEW.policy_version_id <> OLD.policy_version_id
     OR NEW.expires_at <> OLD.expires_at OR NEW.authorized_by <> OLD.authorized_by THEN
    RAISE EXCEPTION 'Authorization bindings are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_auth_guard BEFORE UPDATE ON public.job_authorizations FOR EACH ROW EXECUTE FUNCTION public.guard_authorization_update();

-- ----- Job events (append-only) -----
CREATE TABLE public.job_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('agent','user','system')),
  event_type text NOT NULL,
  agent_seq integer,
  idempotency_key text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 128),
  request_hash text,
  from_status public.job_status,
  to_status public.job_status,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  agent_id uuid,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX job_events_seq ON public.job_events(job_id, agent_seq) WHERE agent_seq IS NOT NULL;
CREATE UNIQUE INDEX job_events_idem ON public.job_events(job_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX job_events_job_idx ON public.job_events(job_id, id);
GRANT SELECT ON public.job_events TO authenticated;
GRANT ALL ON public.job_events TO service_role;
ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read job events" ON public.job_events FOR SELECT TO authenticated USING (public.is_org_staff(org_id));

CREATE OR REPLACE FUNCTION public.append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER job_events_append_only BEFORE UPDATE OR DELETE ON public.job_events FOR EACH ROW EXECUTE FUNCTION public.append_only();

-- ----- Evidence (Phase 2: text evidence stored inline with SHA-256; binary storage is Phase 3) -----
CREATE TABLE public.evidence_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  agent_id uuid,
  kind text NOT NULL CHECK (kind IN ('execution_log','verification_log','device_report','smart_data','other')),
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  content_type text NOT NULL DEFAULT 'text/plain',
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 262144),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content text NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (job_id, idempotency_key),
  FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE CASCADE
);
GRANT SELECT ON public.evidence_objects TO authenticated;
GRANT ALL ON public.evidence_objects TO service_role;
ALTER TABLE public.evidence_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read evidence" ON public.evidence_objects FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON public.evidence_objects FOR EACH ROW EXECUTE FUNCTION public.append_only();

-- ----- Audit trail for new tables -----
CREATE TRIGGER audit_policies AFTER INSERT OR UPDATE OR DELETE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_policy_versions AFTER INSERT ON public.policy_versions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_agents AFTER INSERT OR UPDATE OF status, name, site_id ON public.agents FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_enrollment_tokens AFTER INSERT OR UPDATE ON public.enrollment_tokens FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_job_authorizations AFTER INSERT OR UPDATE ON public.job_authorizations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_jobs_insert AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_jobs_status AFTER UPDATE OF status ON public.jobs FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.audit_row_change();

-- ----- Device rules: simulator labels are immutable; "processed" requires every attached drive approved -----
CREATE OR REPLACE FUNCTION public.device_all_drives_approved(_device uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) > 0 AND coalesce(bool_and(
    (SELECT j.status = 'approved' FROM public.jobs j
      WHERE j.association_id = a.id AND j.status <> 'cancelled'
      ORDER BY j.created_at DESC LIMIT 1) IS TRUE), false)
  FROM public.device_drive_associations a
  WHERE a.device_id = _device AND a.detached_at IS NULL
$$;

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
  IF TG_OP = 'INSERT' THEN
    IF coalesce(current_setting('nextdrive.simulator', true), '') <> 'on' THEN NEW.is_simulated := false; END IF;
  ELSE
    NEW.is_simulated := OLD.is_simulated;
  END IF;
  SELECT is_demo INTO _org_demo FROM public.organizations WHERE id = NEW.org_id;
  NEW.is_demo := coalesce(_org_demo, false);
  IF NEW.status = 'processed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'processed') THEN
    IF TG_OP = 'INSERT' OR NOT public.device_all_drives_approved(NEW.id) THEN
      RAISE EXCEPTION 'A device can only be marked processed when every attached drive has an approved erasure job' USING ERRCODE = '23514';
    END IF;
  END IF;
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
  IF TG_OP = 'INSERT' THEN
    IF coalesce(current_setting('nextdrive.simulator', true), '') <> 'on' THEN NEW.is_simulated := false; END IF;
  ELSE
    NEW.is_simulated := OLD.is_simulated;
    -- A drive with an open job keeps its identity.
    IF NEW.serial IS DISTINCT FROM OLD.serial AND EXISTS (
      SELECT 1 FROM public.jobs j WHERE j.drive_id = NEW.id AND NOT public.job_is_terminal(j.status)) THEN
      RAISE EXCEPTION 'Drive serial cannot change while an erasure job is open' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- A drive under an active job cannot be detached.
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
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.association_id = OLD.id AND j.status IN ('queued','running','verifying','interrupted')) THEN
    RAISE EXCEPTION 'This drive has an erasure job in progress and cannot be detached' USING ERRCODE = '23514';
  END IF;
  NEW.detached_by := auth.uid();
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.device_all_drives_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.device_all_drives_approved(uuid) TO authenticated, service_role;