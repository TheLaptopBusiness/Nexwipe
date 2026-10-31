-- Chromebook processing track: inventory fields, separate management/reset statuses,
-- guided technician workflow (RPC-only), append-only history. No reset or deprovisioning
-- is performed by NexWipe; every status here is a recorded observation or report.

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS device_class text NOT NULL DEFAULT 'laptop';
ALTER TABLE public.devices ADD CONSTRAINT devices_device_class_chk CHECK (device_class IN ('laptop','chromebook'));

CREATE TABLE public.chromebook_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  board text,
  board_source text,
  cpu_arch text NOT NULL DEFAULT 'unknown',
  cpu_arch_source text,
  storage_type text NOT NULL DEFAULT 'unknown',
  storage_type_source text,
  storage_capacity_gb numeric,
  storage_capacity_source text,
  chromeos_version text,
  chromeos_version_source text,
  aue_date date,
  aue_source text,
  aue_retrieved_on date,
  ownership_status text NOT NULL DEFAULT 'not_recorded',
  ownership_authorized_by text,
  ownership_reference text,
  ownership_recorded_by uuid,
  ownership_recorded_at timestamptz,
  management_status text NOT NULL DEFAULT 'unknown',
  reset_status text NOT NULL DEFAULT 'not_started',
  reset_method text,
  reset_authorized_by uuid,
  reset_authorized_at timestamptz,
  reset_started_by uuid,
  reset_started_at timestamptz,
  reset_completed_at timestamptz,
  online_setup_result text NOT NULL DEFAULT 'not_checked',
  online_setup_checked_at timestamptz,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostics_status text NOT NULL DEFAULT 'not_started',
  release_decision text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, device_id),
  FOREIGN KEY (org_id, device_id) REFERENCES public.devices(org_id, id) ON DELETE CASCADE,
  CONSTRAINT cb_cpu_arch_chk CHECK (cpu_arch IN ('x86_64','arm','unknown')),
  CONSTRAINT cb_storage_type_chk CHECK (storage_type IN ('emmc','sata','nvme','ufs','unknown')),
  CONSTRAINT cb_source_chk CHECK (
    coalesce(board_source,'manual') IN ('manual','csv_import','api_reported','physically_observed') AND
    coalesce(cpu_arch_source,'manual') IN ('manual','csv_import','api_reported','physically_observed') AND
    coalesce(storage_type_source,'manual') IN ('manual','csv_import','api_reported','physically_observed') AND
    coalesce(storage_capacity_source,'manual') IN ('manual','csv_import','api_reported','physically_observed') AND
    coalesce(chromeos_version_source,'manual') IN ('manual','csv_import','api_reported','physically_observed')),
  CONSTRAINT cb_aue_source_chk CHECK (aue_date IS NULL OR (aue_source IS NOT NULL AND aue_retrieved_on IS NOT NULL)),
  CONSTRAINT cb_ownership_chk CHECK (ownership_status IN ('not_recorded','recorded')),
  CONSTRAINT cb_management_chk CHECK (management_status IN ('unknown','management_observed','deprovision_requested',
    'admin_reported_deprovisioned','deprovision_confirmed_integration','online_setup_checked','blocked')),
  CONSTRAINT cb_reset_chk CHECK (reset_status IN ('not_started','authorized','in_progress','technician_completed',
    'evidence_collected','reviewed','failed_interrupted')),
  CONSTRAINT cb_reset_method_chk CHECK (reset_method IS NULL OR reset_method IN ('powerwash','recovery_media','admin_remote_powerwash','other')),
  CONSTRAINT cb_online_chk CHECK (online_setup_result IN ('not_checked','no_enrollment_prompt','enrollment_prompt_shown')),
  CONSTRAINT cb_diag_chk CHECK (diagnostics_status IN ('not_started','in_progress','passed','exceptions')),
  CONSTRAINT cb_release_chk CHECK (release_decision IN ('pending','resale_ready','quarantined')),
  CONSTRAINT cb_synthetic_never_resale CHECK (NOT (is_synthetic AND release_decision = 'resale_ready'))
);
CREATE INDEX chromebook_records_mgmt_idx ON public.chromebook_records(org_id, management_status);
GRANT SELECT ON public.chromebook_records TO authenticated;
GRANT ALL ON public.chromebook_records TO service_role;
ALTER TABLE public.chromebook_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read chromebook records" ON public.chromebook_records FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE TRIGGER chromebook_records_updated_at BEFORE UPDATE ON public.chromebook_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_chromebook_records AFTER INSERT OR UPDATE OR DELETE ON public.chromebook_records FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

CREATE TABLE public.chromebook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  record_id uuid NOT NULL,
  step text NOT NULL,
  from_value text,
  to_value text,
  evidence_kind text NOT NULL,
  notes text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_synthetic boolean NOT NULL DEFAULT false,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, record_id) REFERENCES public.chromebook_records(org_id, id) ON DELETE CASCADE,
  CONSTRAINT cbe_kind_chk CHECK (evidence_kind IN ('technician_observation','administrator_report','integration_result','machine_generated','system'))
);
CREATE INDEX chromebook_events_record_idx ON public.chromebook_events(org_id, record_id, id);
GRANT SELECT ON public.chromebook_events TO authenticated;
GRANT ALL ON public.chromebook_events TO service_role;
ALTER TABLE public.chromebook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read chromebook events" ON public.chromebook_events FOR SELECT TO authenticated USING (public.is_org_staff(org_id));
CREATE TRIGGER chromebook_events_append_only BEFORE UPDATE OR DELETE ON public.chromebook_events FOR EACH ROW EXECUTE FUNCTION public.append_only();

-- Events inherit the record's synthetic flag; app users can never write integration/machine evidence.
CREATE OR REPLACE FUNCTION public.guard_chromebook_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT is_synthetic INTO NEW.is_synthetic FROM public.chromebook_records WHERE id = NEW.record_id AND org_id = NEW.org_id;
  NEW.is_synthetic := coalesce(NEW.is_synthetic, true);
  IF public.is_untrusted_caller() AND NEW.evidence_kind IN ('integration_result','machine_generated') THEN
    RAISE EXCEPTION 'Integration or machine-generated evidence can only come from trusted server code' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chromebook_events_guard BEFORE INSERT ON public.chromebook_events FOR EACH ROW EXECUTE FUNCTION public.guard_chromebook_event();

CREATE OR REPLACE FUNCTION public._cb_has_api_source(r public.chromebook_records)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT 'api_reported' IN (coalesce(r.board_source,''), coalesce(r.cpu_arch_source,''), coalesce(r.storage_type_source,''),
                            coalesce(r.storage_capacity_source,''), coalesce(r.chromeos_version_source,''))
$$;

-- Trusted-only fields on the record, re-checked even for SECURITY DEFINER paths called by app users.
CREATE OR REPLACE FUNCTION public.guard_chromebook_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _origin text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT hardware_origin INTO _origin FROM public.devices WHERE id = NEW.device_id AND org_id = NEW.org_id;
    NEW.is_synthetic := (_origin = 'synthetic') OR coalesce(NEW.is_synthetic, false);
  ELSE
    NEW.is_synthetic := OLD.is_synthetic OR EXISTS (SELECT 1 FROM public.devices d WHERE d.id = NEW.device_id AND d.hardware_origin = 'synthetic');
    NEW.org_id := OLD.org_id; NEW.device_id := OLD.device_id;
  END IF;
  IF public.is_untrusted_caller() THEN
    IF NEW.management_status = 'deprovision_confirmed_integration'
       AND (TG_OP = 'INSERT' OR OLD.management_status IS DISTINCT FROM 'deprovision_confirmed_integration') THEN
      RAISE EXCEPTION 'Deprovisioning can only be confirmed by an authorized integration' USING ERRCODE = '42501';
    END IF;
    IF (public._cb_has_api_source(NEW) AND (TG_OP = 'INSERT' OR NOT public._cb_has_api_source(OLD))) THEN
      RAISE EXCEPTION 'API-reported values can only come from trusted server code' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chromebook_records_guard BEFORE INSERT OR UPDATE ON public.chromebook_records FOR EACH ROW EXECUTE FUNCTION public.guard_chromebook_record();

-- Chromebooks never get drive-erasure jobs; a Chromebook cannot be turned back into a laptop once it has a record.
CREATE OR REPLACE FUNCTION public.block_chromebook_erasure_jobs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.devices WHERE id = NEW.device_id AND device_class = 'chromebook') THEN
    RAISE EXCEPTION 'Chromebooks use the Chromebook processing workflow, not drive-erasure jobs' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_block_chromebook BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.block_chromebook_erasure_jobs();

CREATE OR REPLACE FUNCTION public.guard_device_class()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.device_class = 'chromebook' AND NEW.device_class <> 'chromebook'
     AND EXISTS (SELECT 1 FROM public.chromebook_records WHERE device_id = OLD.id) THEN
    RAISE EXCEPTION 'This device has a Chromebook processing record and must stay a Chromebook' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER devices_guard_class BEFORE UPDATE OF device_class ON public.devices FOR EACH ROW EXECUTE FUNCTION public.guard_device_class();

CREATE OR REPLACE FUNCTION public._cb_load(_record uuid, _roles public.org_role[])
RETURNS public.chromebook_records LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records;
BEGIN
  SELECT * INTO r FROM public.chromebook_records WHERE id = _record FOR UPDATE;
  IF NOT FOUND OR NOT public.has_org_role(r.org_id, _roles) THEN
    RAISE EXCEPTION 'Chromebook record not found or not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public._cb_event(_r public.chromebook_records, _step text, _from text, _to text, _kind text, _notes text, _payload jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.chromebook_events(org_id, record_id, step, from_value, to_value, evidence_kind, notes, payload, actor_id)
  VALUES (_r.org_id, _r.id, _step, _from, _to, _kind, nullif(trim(_notes),''), coalesce(_payload,'{}'::jsonb), auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.chromebook_register(_org uuid, _asset_tag text, _manufacturer text, _model text, _serial text, _project uuid DEFAULT NULL, _batch uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _dev uuid; r public.chromebook_records;
BEGIN
  IF NOT public.has_org_role(_org, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(_asset_tag),'') = '' THEN RAISE EXCEPTION 'Asset tag is required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.devices(org_id, asset_tag, manufacturer, model, system_serial, project_id, batch_id, device_class, source)
  VALUES (_org, trim(_asset_tag), nullif(trim(_manufacturer),''), nullif(trim(_model),''), nullif(trim(_serial),''), _project, _batch, 'chromebook', 'manual')
  RETURNING id INTO _dev;
  INSERT INTO public.chromebook_records(org_id, device_id, created_by) VALUES (_org, _dev, auth.uid()) RETURNING * INTO r;
  PERFORM public._cb_event(r, 'received', NULL, 'received', 'technician_observation', NULL,
    jsonb_build_object('asset_tag', trim(_asset_tag), 'manufacturer', _manufacturer, 'model', _model, 'serial', _serial));
  RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_start_for_device(_device uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.devices; r public.chromebook_records;
BEGIN
  SELECT * INTO d FROM public.devices WHERE id = _device;
  IF NOT FOUND OR NOT public.has_org_role(d.org_id, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Device not found or not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.chromebook_records WHERE device_id = _device;
  IF FOUND THEN RETURN r.id; END IF;
  IF EXISTS (SELECT 1 FROM public.jobs WHERE device_id = _device) THEN
    RAISE EXCEPTION 'This device already has drive-erasure jobs' USING ERRCODE = '23514';
  END IF;
  UPDATE public.devices SET device_class = 'chromebook' WHERE id = _device;
  INSERT INTO public.chromebook_records(org_id, device_id, created_by) VALUES (d.org_id, _device, auth.uid()) RETURNING * INTO r;
  PERFORM public._cb_event(r, 'received', NULL, 'received', 'technician_observation', 'Started Chromebook processing for an existing inventory record', '{}');
  RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_update_identity(_record uuid, _fields jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records; k text; v jsonb; src text; val text;
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  FOR k, v IN SELECT * FROM jsonb_each(coalesce(_fields,'{}'::jsonb)) LOOP
    IF k = 'aue' THEN
      IF v->>'date' IS NULL OR v->>'date' = '' THEN
        UPDATE public.chromebook_records SET aue_date = NULL, aue_source = NULL, aue_retrieved_on = NULL WHERE id = r.id;
      ELSE
        IF coalesce(trim(v->>'source'),'') = '' OR coalesce(v->>'retrieved_on','') = '' THEN
          RAISE EXCEPTION 'Automatic Update Expiration needs a source and retrieval date' USING ERRCODE = '22023';
        END IF;
        UPDATE public.chromebook_records SET aue_date = (v->>'date')::date, aue_source = trim(v->>'source'),
          aue_retrieved_on = (v->>'retrieved_on')::date WHERE id = r.id;
      END IF;
      CONTINUE;
    END IF;
    val := nullif(trim(v->>'value'),'');
    src := CASE WHEN val IS NULL OR val = 'unknown' THEN NULL ELSE v->>'source' END;
    IF src IS NOT NULL AND src NOT IN ('manual','physically_observed') THEN
      RAISE EXCEPTION 'App users can record values as manually entered or physically observed only' USING ERRCODE = '42501';
    END IF;
    IF val IS NOT NULL AND val <> 'unknown' AND src IS NULL THEN
      RAISE EXCEPTION 'Each value needs a source' USING ERRCODE = '22023';
    END IF;
    CASE k
      WHEN 'board' THEN UPDATE public.chromebook_records SET board = upper(val), board_source = src WHERE id = r.id;
      WHEN 'cpu_arch' THEN UPDATE public.chromebook_records SET cpu_arch = coalesce(val,'unknown'), cpu_arch_source = src WHERE id = r.id;
      WHEN 'storage_type' THEN UPDATE public.chromebook_records SET storage_type = coalesce(val,'unknown'), storage_type_source = src WHERE id = r.id;
      WHEN 'storage_capacity_gb' THEN UPDATE public.chromebook_records SET storage_capacity_gb = val::numeric, storage_capacity_source = src WHERE id = r.id;
      WHEN 'chromeos_version' THEN UPDATE public.chromebook_records SET chromeos_version = val, chromeos_version_source = src WHERE id = r.id;
      ELSE RAISE EXCEPTION 'Unknown field %', k USING ERRCODE = '22023';
    END CASE;
  END LOOP;
  PERFORM public._cb_event(r, 'identity_updated', NULL, NULL, 'technician_observation', NULL, _fields);
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_record_ownership(_record uuid, _authorized_by text, _reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records;
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  IF coalesce(trim(_authorized_by),'') = '' OR coalesce(trim(_reference),'') = '' THEN
    RAISE EXCEPTION 'Record who authorized processing and the reference (contract, PO or letter)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.chromebook_records SET ownership_status = 'recorded', ownership_authorized_by = trim(_authorized_by),
    ownership_reference = trim(_reference), ownership_recorded_by = auth.uid(), ownership_recorded_at = now() WHERE id = r.id;
  PERFORM public._cb_event(r, 'ownership_recorded', r.ownership_status, 'recorded', 'administrator_report', NULL,
    jsonb_build_object('authorized_by', trim(_authorized_by), 'reference', trim(_reference)));
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_set_management(_record uuid, _status text, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records;
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  IF _status NOT IN ('management_observed','deprovision_requested','admin_reported_deprovisioned','blocked') THEN
    RAISE EXCEPTION 'This management status cannot be set by hand' USING ERRCODE = '22023';
  END IF;
  IF _status IN ('admin_reported_deprovisioned','deprovision_requested','blocked') AND coalesce(trim(_notes),'') = '' THEN
    RAISE EXCEPTION 'Record who you contacted or who reported this, and when' USING ERRCODE = '22023';
  END IF;
  UPDATE public.chromebook_records SET management_status = _status WHERE id = r.id;
  PERFORM public._cb_event(r, 'management', r.management_status, _status,
    CASE WHEN _status = 'admin_reported_deprovisioned' THEN 'administrator_report' ELSE 'technician_observation' END, _notes, '{}');
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_reset_step(_record uuid, _action text, _method text DEFAULT NULL, _confirm_serial text DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records; d public.devices; _to text;
BEGIN
  IF _action = 'authorize' THEN
    r := public._cb_load(_record, ARRAY['owner','admin']::public.org_role[]);
  ELSE
    r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  END IF;
  SELECT * INTO d FROM public.devices WHERE id = r.device_id;
  CASE _action
    WHEN 'authorize' THEN
      IF r.reset_status NOT IN ('not_started','failed_interrupted') THEN RAISE EXCEPTION 'Reset is already authorized or done' USING ERRCODE = '23514'; END IF;
      IF r.ownership_status <> 'recorded' THEN RAISE EXCEPTION 'Record ownership/processing authorization first' USING ERRCODE = '23514'; END IF;
      IF r.management_status IN ('management_observed','deprovision_requested','blocked') THEN
        RAISE EXCEPTION 'Managed or unresolved device: the owning organization must deprovision it before a reset' USING ERRCODE = '23514';
      END IF;
      IF d.system_serial IS NULL OR lower(trim(coalesce(_confirm_serial,''))) <> lower(d.system_serial) THEN
        RAISE EXCEPTION 'Type the serial number shown on the device to authorize the reset' USING ERRCODE = '22023';
      END IF;
      _to := 'authorized';
      UPDATE public.chromebook_records SET reset_status = _to, reset_method = NULL, reset_authorized_by = auth.uid(), reset_authorized_at = now(),
        reset_started_by = NULL, reset_started_at = NULL, reset_completed_at = NULL,
        online_setup_result = 'not_checked', online_setup_checked_at = NULL,
        management_status = CASE WHEN management_status = 'online_setup_checked' THEN 'unknown' ELSE management_status END
      WHERE id = r.id;
    WHEN 'start' THEN
      IF r.reset_status <> 'authorized' THEN RAISE EXCEPTION 'Reset must be authorized first' USING ERRCODE = '23514'; END IF;
      IF _method IS NULL OR _method NOT IN ('powerwash','recovery_media','other') THEN RAISE EXCEPTION 'Choose the method being used' USING ERRCODE = '22023'; END IF;
      IF _method = 'other' AND coalesce(trim(_notes),'') = '' THEN RAISE EXCEPTION 'Describe the method' USING ERRCODE = '22023'; END IF;
      _to := 'in_progress';
      UPDATE public.chromebook_records SET reset_status = _to, reset_method = _method, reset_started_by = auth.uid(), reset_started_at = now() WHERE id = r.id;
    WHEN 'complete' THEN
      IF r.reset_status <> 'in_progress' THEN RAISE EXCEPTION 'Reset is not in progress' USING ERRCODE = '23514'; END IF;
      _to := 'technician_completed';
      UPDATE public.chromebook_records SET reset_status = _to, reset_completed_at = now() WHERE id = r.id;
    WHEN 'evidence' THEN
      IF r.reset_status NOT IN ('technician_completed','evidence_collected') THEN RAISE EXCEPTION 'Complete the reset first' USING ERRCODE = '23514'; END IF;
      IF coalesce(trim(_notes),'') = '' THEN RAISE EXCEPTION 'Describe the evidence collected' USING ERRCODE = '22023'; END IF;
      _to := 'evidence_collected';
      UPDATE public.chromebook_records SET reset_status = _to WHERE id = r.id;
    WHEN 'fail' THEN
      IF r.reset_status NOT IN ('authorized','in_progress') THEN RAISE EXCEPTION 'Only an authorized or running reset can fail' USING ERRCODE = '23514'; END IF;
      IF coalesce(trim(_notes),'') = '' THEN RAISE EXCEPTION 'Describe what happened' USING ERRCODE = '22023'; END IF;
      _to := 'failed_interrupted';
      UPDATE public.chromebook_records SET reset_status = _to WHERE id = r.id;
    ELSE RAISE EXCEPTION 'Unknown reset action' USING ERRCODE = '22023';
  END CASE;
  PERFORM public._cb_event(r, 'reset_' || _action, r.reset_status, _to, 'technician_observation', _notes,
    jsonb_build_object('method', _method));
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_online_setup_check(_record uuid, _online boolean, _enrollment_prompt boolean, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records; _mgmt text; _res text;
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  IF r.reset_status NOT IN ('technician_completed','evidence_collected') THEN
    RAISE EXCEPTION 'Check setup after the reset is completed' USING ERRCODE = '23514';
  END IF;
  IF NOT coalesce(_online,false) THEN
    RAISE EXCEPTION 'An offline setup screen is not evidence: connect to the internet and check again' USING ERRCODE = '23514';
  END IF;
  IF _enrollment_prompt THEN
    _mgmt := 'blocked'; _res := 'enrollment_prompt_shown';
  ELSE
    IF r.management_status IN ('management_observed','deprovision_requested','blocked') THEN
      RAISE EXCEPTION 'Management was observed: record the administrator''s deprovisioning report before this check' USING ERRCODE = '23514';
    END IF;
    _mgmt := 'online_setup_checked'; _res := 'no_enrollment_prompt';
  END IF;
  UPDATE public.chromebook_records SET management_status = _mgmt, online_setup_result = _res, online_setup_checked_at = now() WHERE id = r.id;
  PERFORM public._cb_event(r, 'online_setup_check', r.management_status, _mgmt, 'technician_observation', _notes,
    jsonb_build_object('online', _online, 'enrollment_prompt', _enrollment_prompt));
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_record_diagnostics(_record uuid, _results jsonb, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records; k text; v text; _status text := 'passed'; _clean jsonb := '{}'::jsonb;
  _keys text[] := ARRAY['display','touchscreen','keyboard','touchpad','battery','charging','wifi','camera','microphone','speakers','ports','hinges'];
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin','technician']::public.org_role[]);
  FOREACH k IN ARRAY _keys LOOP
    v := coalesce(_results->>k, 'not_tested');
    IF v NOT IN ('pass','fail','not_fitted','not_tested') THEN RAISE EXCEPTION 'Invalid result for %', k USING ERRCODE = '22023'; END IF;
    _clean := _clean || jsonb_build_object(k, v);
    IF v = 'not_tested' THEN _status := 'in_progress';
    ELSIF v = 'fail' AND _status <> 'in_progress' THEN _status := 'exceptions'; END IF;
  END LOOP;
  IF _status = 'in_progress' AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(_clean) WHERE value <> 'not_tested') THEN _status := 'not_started'; END IF;
  UPDATE public.chromebook_records SET diagnostics = _clean || jsonb_build_object('notes', nullif(trim(_notes),''), 'method', 'manual'),
    diagnostics_status = _status WHERE id = r.id;
  PERFORM public._cb_event(r, 'diagnostics', r.diagnostics_status, _status, 'technician_observation', _notes, _clean);
END $$;

CREATE OR REPLACE FUNCTION public.chromebook_review(_record uuid, _decision text, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.chromebook_records;
BEGIN
  r := public._cb_load(_record, ARRAY['owner','admin']::public.org_role[]);
  IF _decision = 'resale_ready' THEN
    IF r.is_synthetic THEN RAISE EXCEPTION 'Synthetic test records can never be released for resale' USING ERRCODE = '23514'; END IF;
    IF r.ownership_status <> 'recorded' THEN RAISE EXCEPTION 'Ownership authorization is missing' USING ERRCODE = '23514'; END IF;
    IF r.management_status <> 'online_setup_checked' OR r.online_setup_result <> 'no_enrollment_prompt' THEN
      RAISE EXCEPTION 'Managed or unresolved device: an online setup check without enrollment prompt is required' USING ERRCODE = '23514';
    END IF;
    IF r.reset_status NOT IN ('technician_completed','evidence_collected') THEN RAISE EXCEPTION 'Reset is not completed' USING ERRCODE = '23514'; END IF;
    IF r.diagnostics_status NOT IN ('passed','exceptions') THEN RAISE EXCEPTION 'Diagnostics are incomplete' USING ERRCODE = '23514'; END IF;
    IF r.diagnostics_status = 'exceptions' AND coalesce(trim(_notes),'') = '' THEN RAISE EXCEPTION 'Explain the diagnostic exceptions' USING ERRCODE = '22023'; END IF;
    UPDATE public.chromebook_records SET release_decision = 'resale_ready', reset_status = 'reviewed',
      reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(trim(_notes),'') WHERE id = r.id;
  ELSIF _decision = 'quarantined' THEN
    IF coalesce(trim(_notes),'') = '' THEN RAISE EXCEPTION 'Give a reason for quarantine' USING ERRCODE = '22023'; END IF;
    UPDATE public.chromebook_records SET release_decision = 'quarantined',
      reviewed_by = auth.uid(), reviewed_at = now(), review_notes = trim(_notes) WHERE id = r.id;
  ELSE RAISE EXCEPTION 'Unknown decision' USING ERRCODE = '22023';
  END IF;
  PERFORM public._cb_event(r, 'review', r.release_decision, _decision, 'technician_observation', _notes, '{}');
END $$;

REVOKE EXECUTE ON FUNCTION public._cb_load(uuid, public.org_role[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._cb_event(public.chromebook_records, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.chromebook_register(uuid, text, text, text, text, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chromebook_start_for_device(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chromebook_update_identity(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chromebook_record_ownership(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chromebook_set_management(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chromebook_reset_step(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chromebook_online_setup_check(uuid, boolean, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chromebook_record_diagnostics(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chromebook_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chromebook_register(uuid, text, text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chromebook_start_for_device(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chromebook_update_identity(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chromebook_record_ownership(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chromebook_set_management(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chromebook_reset_step(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chromebook_online_setup_check(uuid, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chromebook_record_diagnostics(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chromebook_review(uuid, text, text) TO authenticated;
