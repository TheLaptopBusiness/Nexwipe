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
    -- Never record the station's own boot medium or removable media as a laptop drive.
    CONTINUE WHEN lower(coalesce(r.x->>'is_boot_medium', 'false')) = 'true' OR lower(coalesce(r.x->>'removable', 'false')) = 'true';
    v_if := CASE WHEN r.x->>'interface' IN ('sata_hdd','sata_ssd','nvme_ssd') THEN (r.x->>'interface')::public.drive_interface ELSE 'unsupported_other' END;
    v_cap := CASE WHEN (r.x->>'capacity_bytes') ~ '^[0-9]{1,18}$' AND (r.x->>'capacity_bytes')::numeric > 0 THEN (r.x->>'capacity_bytes')::bigint END;
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
  UPDATE public.agents SET inventory_requested_at = now() WHERE id = v_d.agent_id AND status = 'active';
  RETURN v_dev;
END $$;