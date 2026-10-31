-- Station sign-in proves WHICH station sent a report, not that the hardware physically exists.
-- Track where reported hardware came from; synthetic/virtual hardware stays marked synthetic forever.
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS hardware_origin text NOT NULL DEFAULT 'not_station_reported';
ALTER TABLE public.drives ADD COLUMN IF NOT EXISTS hardware_origin text NOT NULL DEFAULT 'not_station_reported';
ALTER TABLE public.agent_discoveries ADD COLUMN IF NOT EXISTS hardware_origin text NOT NULL DEFAULT 'synthetic';
ALTER TABLE public.agent_discoveries ADD COLUMN IF NOT EXISTS hardware_origin_reason text;

CREATE OR REPLACE FUNCTION public._synthetic_pattern() RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '(qemu|kvm|vmware|virtualbox|vbox|innotek|xen|bochs|parallels|hyper-v|virtual machine|seabios|test data|synthetic|simulated|fixture|contract-test|refclient-test|pubcheck)'
$$;

CREATE OR REPLACE FUNCTION public._classify_hardware(_payload jsonb, _platform text)
RETURNS TABLE(origin text, reason text) LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_src text := lower(coalesce(_payload #>> '{station,hardware_source}', ''));
  v_ident text := lower(concat_ws(' ', _payload #>> '{system,manufacturer}', _payload #>> '{system,model}',
    _payload #>> '{system,sku}', _payload #>> '{system,serial}', _payload #>> '{system,bios_version}'));
  v_kernel text := lower(concat_ws(' ', _platform, _payload #>> '{station,kernel}'));
BEGIN
  IF v_src = 'synthetic' THEN
    origin := 'synthetic'; reason := 'Station declared synthetic test data (not read from a real machine)';
  ELSIF v_src = 'virtual' THEN
    origin := 'synthetic'; reason := 'Station declared a virtual machine';
  ELSIF v_src <> 'physical' THEN
    origin := 'synthetic'; reason := 'Station did not declare a hardware source (agent older than 0.2.1); treated as synthetic';
  ELSIF v_ident ~ public._synthetic_pattern() THEN
    origin := 'synthetic'; reason := 'Reported laptop identity looks virtual or like test data';
  ELSIF v_kernel ~ '(gvisor|microsoft-standard|wsl)' THEN
    origin := 'synthetic'; reason := 'Station is running in a sandbox or virtual kernel';
  ELSE
    origin := 'station_reported'; reason := 'Station declared physical hardware; not physically confirmed by a person';
  END IF;
  RETURN NEXT;
END $$;
REVOKE EXECUTE ON FUNCTION public._classify_hardware(jsonb, text) FROM PUBLIC, anon, authenticated;

-- Correct existing data: every report so far came from VMs, sandboxes or test fixtures.
UPDATE public.agent_discoveries d SET (hardware_origin, hardware_origin_reason) = (
  SELECT c.origin, c.reason FROM public.agents a, LATERAL public._classify_hardware(d.payload, a.platform) c WHERE a.id = d.agent_id);

UPDATE public.devices SET hardware_origin = 'synthetic', hardware_verified = false
  WHERE NOT is_simulated AND (source = 'agent_reported' OR hardware_verified
    OR id IN (SELECT device_id FROM public.agent_discoveries WHERE device_id IS NOT NULL AND hardware_origin = 'synthetic'));
UPDATE public.drives SET hardware_origin = 'synthetic', hardware_verified = false
  WHERE NOT is_simulated AND (source = 'agent_reported' OR hardware_verified
    OR id IN (SELECT a.drive_id FROM public.device_drive_associations a JOIN public.devices v ON v.id = a.device_id WHERE v.hardware_origin = 'synthetic'));

ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS devices_hardware_origin_chk;
ALTER TABLE public.devices ADD CONSTRAINT devices_hardware_origin_chk
  CHECK (hardware_origin IN ('not_station_reported','station_reported','synthetic') AND (hardware_origin <> 'synthetic' OR NOT hardware_verified));
ALTER TABLE public.drives DROP CONSTRAINT IF EXISTS drives_hardware_origin_chk;
ALTER TABLE public.drives ADD CONSTRAINT drives_hardware_origin_chk
  CHECK (hardware_origin IN ('not_station_reported','station_reported','synthetic') AND (hardware_origin <> 'synthetic' OR NOT hardware_verified));
ALTER TABLE public.agent_discoveries DROP CONSTRAINT IF EXISTS agent_discoveries_hardware_origin_chk;
ALTER TABLE public.agent_discoveries ADD CONSTRAINT agent_discoveries_hardware_origin_chk
  CHECK (hardware_origin IN ('station_reported','synthetic'));

CREATE OR REPLACE FUNCTION public.validate_device()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _project_client uuid; _batch_project uuid; _org_demo boolean;
BEGIN
  IF public.is_untrusted_caller() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.hardware_verified := false;
      IF NEW.source = 'agent_reported' THEN NEW.source := 'manual'; END IF;
      NEW.created_by := auth.uid();
      -- App users may only mark hardware synthetic, never station-reported.
      IF NEW.hardware_origin IS DISTINCT FROM 'synthetic' THEN NEW.hardware_origin := 'not_station_reported'; END IF;
    ELSE
      NEW.hardware_verified := OLD.hardware_verified;
      NEW.source := OLD.source;
      NEW.created_by := OLD.created_by;
      NEW.org_id := OLD.org_id;
      IF NEW.hardware_origin IS DISTINCT FROM 'synthetic' THEN NEW.hardware_origin := OLD.hardware_origin; END IF;
    END IF;
  END IF;
  -- Synthetic is permanent and never counts as station-reported identity.
  IF TG_OP = 'UPDATE' AND OLD.hardware_origin = 'synthetic' THEN NEW.hardware_origin := 'synthetic'; END IF;
  IF NEW.hardware_origin = 'synthetic' THEN NEW.hardware_verified := false; END IF;
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
      IF NEW.hardware_origin IS DISTINCT FROM 'synthetic' THEN NEW.hardware_origin := 'not_station_reported'; END IF;
    ELSE
      NEW.hardware_verified := OLD.hardware_verified;
      NEW.source := OLD.source;
      NEW.org_id := OLD.org_id;
      IF NEW.hardware_origin IS DISTINCT FROM 'synthetic' THEN NEW.hardware_origin := OLD.hardware_origin; END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.hardware_origin = 'synthetic' THEN NEW.hardware_origin := 'synthetic'; END IF;
  IF NEW.hardware_origin = 'synthetic' THEN NEW.hardware_verified := false; END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(current_setting('nextdrive.simulator', true), '') <> 'on' THEN NEW.is_simulated := false; END IF;
  ELSE
    NEW.is_simulated := OLD.is_simulated;
    IF NEW.serial IS DISTINCT FROM OLD.serial AND EXISTS (
      SELECT 1 FROM public.jobs j WHERE j.drive_id = NEW.id AND NOT public.job_is_terminal(j.status)) THEN
      RAISE EXCEPTION 'Drive serial cannot change while an erasure job is open' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Synthetic hardware can never get an erasure job (simulator jobs use simulated records, not synthetic ones).
CREATE OR REPLACE FUNCTION public.block_synthetic_hardware_jobs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.devices WHERE id = NEW.device_id AND hardware_origin = 'synthetic')
     OR EXISTS (SELECT 1 FROM public.drives WHERE id = NEW.drive_id AND hardware_origin = 'synthetic') THEN
    RAISE EXCEPTION 'Synthetic test hardware cannot have erasure jobs' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.block_synthetic_hardware_jobs() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS jobs_block_synthetic ON public.jobs;
CREATE TRIGGER jobs_block_synthetic BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.block_synthetic_hardware_jobs();

CREATE OR REPLACE FUNCTION public.agent_report_inventory(_agent uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_ag public.agents; v_sys text; v_device uuid; v_tag text; r record; v_ser text; v_drive uuid; v_att boolean;
  v_out jsonb := '[]'::jsonb; v_disc uuid; v_hash text; v_flags jsonb := '[]'::jsonb; v_count integer; v_other uuid;
  v_origin text; v_reason text; v_dorigin text;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  UPDATE public.agents SET inventory_requested_at = NULL WHERE id = _agent;
  v_sys := nullif(trim(_payload #>> '{system,serial}'), '');
  v_hash := encode(extensions.digest(convert_to(_payload::text, 'UTF8'), 'sha256'), 'hex');
  SELECT c.origin, c.reason INTO v_origin, v_reason FROM public._classify_hardware(_payload, v_ag.platform) c;

  IF jsonb_typeof(_payload->'review_flags') = 'array' THEN
    SELECT coalesce(jsonb_agg(f), '[]'::jsonb) INTO v_flags FROM (SELECT f FROM jsonb_array_elements(_payload->'review_flags') f LIMIT 50) s;
  END IF;
  IF v_sys IS NULL THEN v_flags := v_flags || jsonb_build_array(jsonb_build_object('code','system_serial_missing','source','server')); END IF;
  IF v_origin = 'synthetic' THEN
    v_flags := v_flags || jsonb_build_array(jsonb_build_object('code','synthetic_hardware','source','server','detail', v_reason));
  END IF;

  IF v_sys IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.devices WHERE org_id = v_ag.org_id AND is_simulated = v_ag.is_simulated AND upper(system_serial) = upper(v_sys);
    IF v_count > 1 THEN
      v_flags := v_flags || jsonb_build_array(jsonb_build_object('code','system_serial_matches_multiple_devices','source','server','detail', v_count || ' inventory records share this serial'));
    END IF;
    SELECT id, asset_tag INTO v_device, v_tag FROM public.devices
      WHERE org_id = v_ag.org_id AND is_simulated = v_ag.is_simulated AND upper(system_serial) = upper(v_sys)
      ORDER BY received_at DESC LIMIT 1;
  END IF;

  FOR r IN SELECT x FROM jsonb_array_elements(coalesce(_payload->'drives', '[]'::jsonb)) x LOOP
    v_ser := nullif(trim(r.x->>'serial'), '');
    v_drive := NULL; v_att := false;
    IF v_ser IS NULL THEN
      IF lower(coalesce(r.x->>'is_boot_medium','false')) <> 'true' AND lower(coalesce(r.x->>'removable','false')) <> 'true' THEN
        v_flags := v_flags || jsonb_build_array(jsonb_build_object('code','drive_serial_missing','source','server','target', coalesce(r.x->>'bus_path', r.x->>'model', 'unknown drive')));
      END IF;
    ELSE
      SELECT d.id INTO v_drive FROM public.drives d
        WHERE d.org_id = v_ag.org_id AND d.is_simulated = v_ag.is_simulated AND upper(d.serial) = upper(v_ser) LIMIT 1;
      IF v_drive IS NOT NULL THEN
        SELECT device_id INTO v_other FROM public.device_drive_associations WHERE drive_id = v_drive AND detached_at IS NULL LIMIT 1;
        v_att := v_device IS NOT NULL AND v_other = v_device;
        IF v_other IS NOT NULL AND v_other IS DISTINCT FROM v_device THEN
          v_flags := v_flags || jsonb_build_array(jsonb_build_object('code','drive_attached_to_other_device','source','server','target', v_ser));
        END IF;
      END IF;
      IF v_att AND NOT v_ag.is_simulated THEN
        v_dorigin := CASE WHEN v_origin = 'synthetic' OR lower(concat_ws(' ', r.x->>'model', v_ser)) ~ public._synthetic_pattern()
          THEN 'synthetic' ELSE 'station_reported' END;
        UPDATE public.drives SET hardware_origin = v_dorigin, hardware_verified = (v_dorigin = 'station_reported'), source = 'agent_reported',
          firmware_version = coalesce(nullif(left(r.x->>'firmware', 60), ''), firmware_version) WHERE id = v_drive;
      END IF;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object('serial', v_ser, 'drive_id', v_drive, 'attached_to_device', v_att));
  END LOOP;
  IF (SELECT count(*) FROM (SELECT upper(x->>'serial') s FROM jsonb_array_elements(coalesce(_payload->'drives','[]'::jsonb)) x
        WHERE nullif(trim(x->>'serial'),'') IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d) > 0 THEN
    v_flags := v_flags || jsonb_build_array(jsonb_build_object('code','duplicate_drive_serial','source','server'));
  END IF;
  SELECT coalesce(jsonb_agg(DISTINCT f), '[]'::jsonb) INTO v_flags FROM jsonb_array_elements(v_flags) f;

  IF v_device IS NOT NULL AND NOT v_ag.is_simulated THEN
    UPDATE public.devices SET hardware_origin = v_origin, hardware_verified = (v_origin = 'station_reported'), source = 'agent_reported'
      WHERE id = v_device;
  END IF;

  SELECT id INTO v_disc FROM public.agent_discoveries
    WHERE agent_id = _agent AND coalesce(system_serial, '') = coalesce(v_sys, '') AND (v_sys IS NOT NULL OR payload_sha256 = v_hash)
    ORDER BY last_reported_at DESC LIMIT 1 FOR UPDATE;
  IF v_disc IS NOT NULL THEN
    -- A discovery once synthetic stays synthetic.
    UPDATE public.agent_discoveries SET payload = _payload, payload_sha256 = v_hash, last_reported_at = now(),
      report_count = report_count + 1, device_id = coalesce(v_device, device_id), review_flags = v_flags,
      hardware_origin = CASE WHEN hardware_origin = 'synthetic' THEN 'synthetic' ELSE v_origin END,
      hardware_origin_reason = CASE WHEN hardware_origin = 'synthetic' THEN hardware_origin_reason ELSE v_reason END
      WHERE id = v_disc;
  ELSE
    INSERT INTO public.agent_discoveries(org_id, agent_id, device_id, system_serial, payload, is_simulated, payload_sha256, review_flags,
      is_read_only_test, hardware_origin, hardware_origin_reason)
    VALUES (v_ag.org_id, v_ag.id, v_device, v_sys, _payload, v_ag.is_simulated, v_hash, v_flags, v_ag.read_only, v_origin, v_reason)
    RETURNING id INTO v_disc;
  END IF;
  SELECT report_count INTO v_count FROM public.agent_discoveries WHERE id = v_disc;
  RETURN jsonb_build_object('discovery_id', v_disc, 'device_id', v_device, 'asset_tag', v_tag, 'drives', v_out,
    'review_flags', v_flags, 'report_count', v_count, 'hardware_origin', v_origin);
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_report_inventory(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_report_inventory(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_device_from_discovery(_discovery uuid, _asset_tag text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_d public.agent_discoveries; v_dev uuid; r record; v_ser text; v_drive uuid; v_if public.drive_interface; v_cap bigint;
  v_origin text;
BEGIN
  SELECT * INTO v_d FROM public.agent_discoveries WHERE id = _discovery FOR UPDATE;
  IF NOT FOUND OR NOT public.has_org_role(v_d.org_id, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Discovery not found or not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_d.is_simulated THEN RAISE EXCEPTION 'Simulated discoveries cannot be added to inventory' USING ERRCODE = '22023'; END IF;
  IF v_d.device_id IS NOT NULL THEN RAISE EXCEPTION 'This discovery is already linked to an inventory record' USING ERRCODE = '22023'; END IF;
  IF nullif(trim(_asset_tag), '') IS NULL THEN RAISE EXCEPTION 'Asset tag is required' USING ERRCODE = '22023'; END IF;
  IF v_d.system_serial IS NULL THEN RAISE EXCEPTION 'The station did not report a system serial' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.devices WHERE org_id = v_d.org_id AND NOT is_simulated AND upper(system_serial) = upper(v_d.system_serial)) THEN
    RAISE EXCEPTION 'A laptop with this system serial is already in inventory' USING ERRCODE = '23505';
  END IF;
  v_origin := CASE WHEN v_d.hardware_origin = 'synthetic' THEN 'synthetic' ELSE 'not_station_reported' END;

  INSERT INTO public.devices(org_id, asset_tag, manufacturer, model, system_serial, cpu, notes, hardware_origin)
  VALUES (v_d.org_id, trim(_asset_tag),
    left(nullif(trim(v_d.payload #>> '{system,manufacturer}'), ''), 80),
    left(nullif(trim(v_d.payload #>> '{system,model}'), ''), 120),
    v_d.system_serial,
    left(nullif(trim(v_d.payload #>> '{system,cpu}'), ''), 120),
    CASE WHEN v_origin = 'synthetic'
      THEN 'Created from station discovery ' || to_char(v_d.reported_at, 'YYYY-MM-DD HH24:MI') || ' UTC. SYNTHETIC test hardware: ' || coalesce(v_d.hardware_origin_reason, 'not a real machine') || '.'
      ELSE 'Created from station discovery ' || to_char(v_d.reported_at, 'YYYY-MM-DD HH24:MI') || ' UTC. Marked station-reported once the station re-reports it.' END,
    v_origin)
  RETURNING id INTO v_dev;

  FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v_d.payload->'drives', '[]'::jsonb)) x LOOP
    v_ser := nullif(trim(r.x->>'serial'), '');
    CONTINUE WHEN v_ser IS NULL;
    CONTINUE WHEN lower(coalesce(r.x->>'is_boot_medium', 'false')) = 'true' OR lower(coalesce(r.x->>'removable', 'false')) = 'true';
    v_if := CASE WHEN r.x->>'interface' IN ('sata_hdd','sata_ssd','nvme_ssd') THEN (r.x->>'interface')::public.drive_interface ELSE 'unsupported_other' END;
    v_cap := CASE WHEN (r.x->>'capacity_bytes') ~ '^[0-9]{1,18}$' AND (r.x->>'capacity_bytes')::numeric > 0 THEN (r.x->>'capacity_bytes')::bigint END;
    SELECT id INTO v_drive FROM public.drives WHERE org_id = v_d.org_id AND NOT is_simulated AND upper(serial) = upper(v_ser) LIMIT 1;
    IF v_drive IS NULL THEN
      INSERT INTO public.drives(org_id, serial, model, interface, capacity_bytes, firmware_version, hardware_origin)
      VALUES (v_d.org_id, left(v_ser, 128), left(nullif(r.x->>'model', ''), 120), v_if, v_cap, left(nullif(r.x->>'firmware', ''), 60), v_origin)
      RETURNING id INTO v_drive;
    ELSIF v_origin = 'synthetic' THEN
      UPDATE public.drives SET hardware_origin = 'synthetic' WHERE id = v_drive;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.device_drive_associations WHERE drive_id = v_drive AND detached_at IS NULL) THEN
      INSERT INTO public.device_drive_associations(org_id, device_id, drive_id) VALUES (v_d.org_id, v_dev, v_drive);
    END IF;
  END LOOP;

  UPDATE public.agent_discoveries SET device_id = v_dev WHERE id = v_d.id;
  UPDATE public.agents SET inventory_requested_at = now() WHERE id = v_d.agent_id AND status = 'active';
  RETURN v_dev;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_device_from_discovery(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_device_from_discovery(uuid, text) TO authenticated;
