-- ===== 1) Read-only test stations: physical stations cannot be authorized for erasure =====
ALTER TABLE public.enrollment_tokens ADD COLUMN IF NOT EXISTS read_only boolean NOT NULL DEFAULT true;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS read_only boolean NOT NULL DEFAULT false;
UPDATE public.enrollment_tokens SET read_only = NOT is_simulated;
UPDATE public.agents SET read_only = NOT is_simulated;
COMMENT ON COLUMN public.agents.read_only IS 'Read-only test station: may enroll, heartbeat and report inventory only. Changed only by trusted server code (platform), never by app users.';

CREATE OR REPLACE FUNCTION public.agents_set_read_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_simulated THEN
    NEW.read_only := false;
  ELSE
    NEW.read_only := coalesce((SELECT t.read_only FROM public.enrollment_tokens t WHERE t.id = NEW.enrollment_token_id), true);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agents_set_read_only ON public.agents;
CREATE TRIGGER agents_set_read_only BEFORE INSERT ON public.agents FOR EACH ROW EXECUTE FUNCTION public.agents_set_read_only();

CREATE OR REPLACE FUNCTION public.block_read_only_station_work()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.agent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.agents WHERE id = NEW.agent_id AND read_only) THEN
    RAISE EXCEPTION 'This is a read-only test station; it cannot be authorized for, or report on, erasure jobs' USING ERRCODE = 'ND403';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS job_authorizations_not_read_only ON public.job_authorizations;
CREATE TRIGGER job_authorizations_not_read_only BEFORE INSERT ON public.job_authorizations FOR EACH ROW EXECUTE FUNCTION public.block_read_only_station_work();
DROP TRIGGER IF EXISTS job_events_not_read_only ON public.job_events;
CREATE TRIGGER job_events_not_read_only BEFORE INSERT ON public.job_events FOR EACH ROW EXECUTE FUNCTION public.block_read_only_station_work();
DROP TRIGGER IF EXISTS evidence_not_read_only ON public.evidence_objects;
CREATE TRIGGER evidence_not_read_only BEFORE INSERT ON public.evidence_objects FOR EACH ROW EXECUTE FUNCTION public.block_read_only_station_work();

-- ===== 2) Credential expiry and rotation =====
ALTER TABLE public.agent_credentials ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '90 days');
UPDATE public.agent_credentials SET expires_at = now() + interval '90 days' WHERE expires_at IS NULL;
ALTER TABLE public.agent_credentials ADD COLUMN IF NOT EXISTS replaced_by uuid;

CREATE OR REPLACE FUNCTION public.agent_authenticate(_credential text, _nonce text, _timestamp timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_ag public.agents; v_c public.agent_credentials;
BEGIN
  IF _credential IS NULL OR _credential NOT LIKE 'ndagt\_%' THEN
    RAISE EXCEPTION 'Missing or malformed agent credential' USING ERRCODE = 'ND401';
  END IF;
  SELECT * INTO v_c FROM public.agent_credentials WHERE credential_hash = encode(extensions.digest(_credential, 'sha256'), 'hex');
  IF NOT FOUND OR v_c.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Agent credential is invalid or has been revoked' USING ERRCODE = 'ND401';
  END IF;
  IF v_c.expires_at IS NOT NULL AND v_c.expires_at <= now() THEN
    RAISE EXCEPTION 'Agent credential has expired; rotate before expiry or re-enroll the station' USING ERRCODE = 'ND401';
  END IF;
  SELECT * INTO v_ag FROM public.agents WHERE id = v_c.agent_id;
  IF v_ag.status <> 'active' THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  IF _timestamp IS NULL OR abs(extract(epoch FROM (now() - _timestamp))) > 300 THEN
    RAISE EXCEPTION 'Request timestamp is outside the allowed 5-minute window' USING ERRCODE = 'ND401';
  END IF;
  IF _nonce IS NULL OR _nonce !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'Missing or malformed request nonce' USING ERRCODE = 'ND401';
  END IF;
  DELETE FROM public.agent_request_nonces WHERE agent_id = v_ag.id AND seen_at < now() - interval '15 minutes';
  BEGIN
    INSERT INTO public.agent_request_nonces(agent_id, nonce) VALUES (v_ag.id, _nonce);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Replayed request: this nonce was already used' USING ERRCODE = 'ND409';
  END;
  RETURN jsonb_build_object('agent_id', v_ag.id, 'org_id', v_ag.org_id, 'is_simulated', v_ag.is_simulated, 'name', v_ag.name,
    'read_only', v_ag.read_only, 'credential_id', v_c.id, 'credential_expires_at', v_c.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.agent_rotate_credential(_agent uuid, _credential_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_c public.agent_credentials; v_new text; v_id uuid; v_exp timestamptz := now() + interval '90 days'; v_grace timestamptz;
BEGIN
  SELECT * INTO v_c FROM public.agent_credentials WHERE id = _credential_id AND agent_id = _agent AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credential not found for this station' USING ERRCODE = 'ND401'; END IF;
  IF v_c.replaced_by IS NOT NULL THEN RAISE EXCEPTION 'This credential was already rotated; use the replacement' USING ERRCODE = 'ND409'; END IF;
  v_new := 'ndagt_' || encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.agent_credentials(org_id, agent_id, credential_hash, expires_at)
  VALUES (v_c.org_id, _agent, encode(extensions.digest(v_new, 'sha256'), 'hex'), v_exp) RETURNING id INTO v_id;
  v_grace := least(coalesce(v_c.expires_at, now() + interval '10 minutes'), now() + interval '10 minutes');
  UPDATE public.agent_credentials SET expires_at = v_grace, replaced_by = v_id WHERE id = v_c.id;
  UPDATE public.agents SET credential_prefix = left(v_new, 14) WHERE id = _agent;
  RETURN jsonb_build_object('credential', v_new, 'expires_at', v_exp, 'previous_valid_until', v_grace);
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_authenticate(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_rotate_credential(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_authenticate(text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_rotate_credential(uuid, uuid) TO service_role;

-- ===== 3) Discovery: one record per station + laptop (no duplicates on restart), review flags =====
ALTER TABLE public.agent_discoveries ADD COLUMN IF NOT EXISTS payload_sha256 text;
ALTER TABLE public.agent_discoveries ADD COLUMN IF NOT EXISTS report_count integer NOT NULL DEFAULT 1;
ALTER TABLE public.agent_discoveries ADD COLUMN IF NOT EXISTS last_reported_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.agent_discoveries ADD COLUMN IF NOT EXISTS review_flags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.agent_discoveries ADD COLUMN IF NOT EXISTS is_read_only_test boolean NOT NULL DEFAULT false;
UPDATE public.agent_discoveries SET last_reported_at = reported_at;
UPDATE public.agent_discoveries d SET is_read_only_test = a.read_only FROM public.agents a WHERE a.id = d.agent_id;

CREATE OR REPLACE FUNCTION public.agent_report_inventory(_agent uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_ag public.agents; v_sys text; v_device uuid; v_tag text; r record; v_ser text; v_drive uuid; v_att boolean;
  v_out jsonb := '[]'::jsonb; v_disc uuid; v_hash text; v_flags jsonb := '[]'::jsonb; v_count integer; v_other uuid;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  UPDATE public.agents SET inventory_requested_at = NULL WHERE id = _agent;
  v_sys := nullif(trim(_payload #>> '{system,serial}'), '');
  v_hash := encode(extensions.digest(convert_to(_payload::text, 'UTF8'), 'sha256'), 'hex');

  -- Station-reported review flags (bounded) plus server-side checks.
  IF jsonb_typeof(_payload->'review_flags') = 'array' THEN
    SELECT coalesce(jsonb_agg(f), '[]'::jsonb) INTO v_flags FROM (SELECT f FROM jsonb_array_elements(_payload->'review_flags') f LIMIT 50) s;
  END IF;
  IF v_sys IS NULL THEN v_flags := v_flags || jsonb_build_array(jsonb_build_object('code','system_serial_missing','source','server')); END IF;

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
        UPDATE public.drives SET hardware_verified = true, source = 'agent_reported',
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
    UPDATE public.devices SET hardware_verified = true, source = 'agent_reported' WHERE id = v_device;
  END IF;

  -- One discovery per station + laptop: a restart or repeat report updates it instead of adding a duplicate.
  SELECT id INTO v_disc FROM public.agent_discoveries
    WHERE agent_id = _agent AND coalesce(system_serial, '') = coalesce(v_sys, '') AND (v_sys IS NOT NULL OR payload_sha256 = v_hash)
    ORDER BY last_reported_at DESC LIMIT 1 FOR UPDATE;
  IF v_disc IS NOT NULL THEN
    UPDATE public.agent_discoveries SET payload = _payload, payload_sha256 = v_hash, last_reported_at = now(),
      report_count = report_count + 1, device_id = coalesce(v_device, device_id), review_flags = v_flags
      WHERE id = v_disc;
  ELSE
    INSERT INTO public.agent_discoveries(org_id, agent_id, device_id, system_serial, payload, is_simulated, payload_sha256, review_flags, is_read_only_test)
    VALUES (v_ag.org_id, v_ag.id, v_device, v_sys, _payload, v_ag.is_simulated, v_hash, v_flags, v_ag.read_only) RETURNING id INTO v_disc;
  END IF;
  SELECT report_count INTO v_count FROM public.agent_discoveries WHERE id = v_disc;
  RETURN jsonb_build_object('discovery_id', v_disc, 'device_id', v_device, 'asset_tag', v_tag, 'drives', v_out,
    'review_flags', v_flags, 'report_count', v_count);
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_report_inventory(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_report_inventory(uuid, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.agents_set_read_only() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_read_only_station_work() FROM PUBLIC, anon, authenticated;