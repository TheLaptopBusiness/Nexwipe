-- 1) Server-side MFA: owner/admin privileges only count in an AAL2 (two-step verified) session.
CREATE OR REPLACE FUNCTION public.current_aal()
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org uuid, _roles public.org_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN public.organizations o ON o.id = m.org_id
    WHERE m.org_id = _org AND m.user_id = auth.uid()
      AND m.status = 'active' AND o.status = 'active'
      AND m.role = ANY(_roles)
      AND (m.role NOT IN ('owner','admin') OR public.current_aal() = 'aal2')
  )
$$;

-- Membership itself (used only to read the organization row) does not require AAL2,
-- so an owner/admin can still see which organization asks them to complete two-step verification.
CREATE OR REPLACE FUNCTION public.is_org_member(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    JOIN public.organizations o ON o.id = m.org_id
    WHERE m.org_id = _org AND m.user_id = auth.uid() AND m.status = 'active' AND o.status = 'active'
  )
$$;

-- 2) Read-only milestone: technicians turn a station discovery into an inventory record.
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS inventory_requested_at timestamptz;

CREATE OR REPLACE FUNCTION public.create_device_from_discovery(_discovery uuid, _asset_tag text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_d public.agent_discoveries; v_dev uuid; r record; v_ser text; v_drive uuid; v_if public.drive_interface; v_cap bigint;
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

  INSERT INTO public.devices(org_id, asset_tag, manufacturer, model, system_serial, cpu, notes)
  VALUES (v_d.org_id, trim(_asset_tag),
    left(nullif(trim(v_d.payload #>> '{system,manufacturer}'), ''), 80),
    left(nullif(trim(v_d.payload #>> '{system,model}'), ''), 120),
    v_d.system_serial,
    left(nullif(trim(v_d.payload #>> '{system,cpu}'), ''), 120),
    'Created from station discovery ' || to_char(v_d.reported_at, 'YYYY-MM-DD HH24:MI') || ' UTC. Verified once the station re-reports it.')
  RETURNING id INTO v_dev;

  FOR r IN SELECT x FROM jsonb_array_elements(coalesce(v_d.payload->'drives', '[]'::jsonb)) x LOOP
    v_ser := nullif(trim(r.x->>'serial'), '');
    CONTINUE WHEN v_ser IS NULL;
    v_if := CASE WHEN r.x->>'interface' IN ('sata_hdd','sata_ssd','nvme_ssd') THEN (r.x->>'interface')::public.drive_interface ELSE 'unsupported_other' END;
    v_cap := CASE WHEN (r.x->>'capacity_bytes') ~ '^[0-9]{1,19}$' AND (r.x->>'capacity_bytes')::numeric > 0 THEN (r.x->>'capacity_bytes')::bigint END;
    SELECT id INTO v_drive FROM public.drives WHERE org_id = v_d.org_id AND NOT is_simulated AND upper(serial) = upper(v_ser) LIMIT 1;
    IF v_drive IS NULL THEN
      INSERT INTO public.drives(org_id, serial, model, interface, capacity_bytes, firmware_version)
      VALUES (v_d.org_id, left(v_ser, 128), left(nullif(r.x->>'model', ''), 120), v_if, v_cap, left(nullif(r.x->>'firmware', ''), 60))
      RETURNING id INTO v_drive;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.device_drive_associations WHERE drive_id = v_drive AND detached_at IS NULL) THEN
      INSERT INTO public.device_drive_associations(org_id, device_id, drive_id) VALUES (v_d.org_id, v_dev, v_drive);
    END IF;
  END LOOP;

  UPDATE public.agent_discoveries SET device_id = v_dev WHERE id = v_d.id;
  -- Ask the station to re-report so the server (not the browser) can mark the identities agent-verified.
  UPDATE public.agents SET inventory_requested_at = now() WHERE id = v_d.agent_id AND status = 'active';
  RETURN v_dev;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_device_from_discovery(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_device_from_discovery(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.agent_heartbeat(_agent uuid, _state text, _version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_queued integer; v_req timestamptz;
BEGIN
  UPDATE public.agents SET last_heartbeat_at = now(), last_state = left(coalesce(_state, 'idle'), 40),
    agent_version = coalesce(left(_version, 40), agent_version)
    WHERE id = _agent AND status = 'active' RETURNING org_id, inventory_requested_at INTO v_org, v_req;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  PERFORM public._sweep_jobs(v_org);
  SELECT count(*) INTO v_queued FROM public.jobs WHERE agent_id = _agent AND status = 'queued';
  RETURN jsonb_build_object('server_time', now(), 'queued_jobs', v_queued, 'heartbeat_timeout_seconds', 180,
    'inventory_requested', v_req IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.agent_report_inventory(_agent uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ag public.agents; v_sys text; v_device uuid; v_tag text; r record; v_ser text; v_drive uuid; v_att boolean;
  v_out jsonb := '[]'::jsonb; v_disc uuid;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  UPDATE public.agents SET inventory_requested_at = NULL WHERE id = _agent;
  v_sys := nullif(trim(_payload #>> '{system,serial}'), '');
  IF v_sys IS NOT NULL THEN
    SELECT id, asset_tag INTO v_device, v_tag FROM public.devices
      WHERE org_id = v_ag.org_id AND is_simulated = v_ag.is_simulated AND upper(system_serial) = upper(v_sys)
      ORDER BY received_at DESC LIMIT 1;
  END IF;
  INSERT INTO public.agent_discoveries(org_id, agent_id, device_id, system_serial, payload, is_simulated)
  VALUES (v_ag.org_id, v_ag.id, v_device, v_sys, _payload, v_ag.is_simulated) RETURNING id INTO v_disc;
  FOR r IN SELECT x FROM jsonb_array_elements(coalesce(_payload->'drives', '[]'::jsonb)) x LOOP
    v_ser := nullif(trim(r.x->>'serial'), '');
    v_drive := NULL; v_att := false;
    IF v_ser IS NOT NULL THEN
      SELECT d.id INTO v_drive FROM public.drives d
        WHERE d.org_id = v_ag.org_id AND d.is_simulated = v_ag.is_simulated AND upper(d.serial) = upper(v_ser) LIMIT 1;
      IF v_drive IS NOT NULL AND v_device IS NOT NULL THEN
        v_att := EXISTS (SELECT 1 FROM public.device_drive_associations WHERE drive_id = v_drive AND device_id = v_device AND detached_at IS NULL);
      END IF;
      IF v_att AND NOT v_ag.is_simulated THEN
        UPDATE public.drives SET hardware_verified = true, source = 'agent_reported',
          firmware_version = coalesce(nullif(left(r.x->>'firmware', 60), ''), firmware_version) WHERE id = v_drive;
      END IF;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object('serial', v_ser, 'drive_id', v_drive, 'attached_to_device', v_att));
  END LOOP;
  IF v_device IS NOT NULL AND NOT v_ag.is_simulated THEN
    UPDATE public.devices SET hardware_verified = true, source = 'agent_reported' WHERE id = v_device;
  END IF;
  RETURN jsonb_build_object('discovery_id', v_disc, 'device_id', v_device, 'asset_tag', v_tag, 'drives', v_out);
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_report_inventory(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_report_inventory(uuid, jsonb) TO service_role;

-- Internal helpers are not callable through the Data API by signed-out visitors.
REVOKE EXECUTE ON FUNCTION public.current_aal() FROM anon;