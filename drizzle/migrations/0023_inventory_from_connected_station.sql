-- Inventory from a connected station: "Add to inventory" now needs the laptop to be connected (it
-- queues a rescan whose report confirms the record), and copies RAM and battery health from the
-- station report onto the inventory record. Laptops added earlier get those two values filled in
-- where they are still empty; values a technician typed are never overwritten.

-- RAM in GB (binary, 1 decimal) from system.ram_bytes; NULL unless a plain positive integer.
CREATE OR REPLACE FUNCTION public._payload_ram_gb(_p jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN (_p #>> '{system,ram_bytes}') ~ '^[0-9]{1,18}$' AND (_p #>> '{system,ram_bytes}')::numeric > 0
    THEN round((_p #>> '{system,ram_bytes}')::numeric / 1073741824, 1) END
$$;
REVOKE EXECUTE ON FUNCTION public._payload_ram_gb(jsonb) FROM PUBLIC, anon, authenticated;

-- Battery health % of the first battery: reported health_pct, else full-charge / design capacity.
-- Capped at 100 (new packs can report slightly above design capacity).
CREATE OR REPLACE FUNCTION public._payload_battery_pct(_p jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  -- least() would turn "no value" into 100, so cap only a real value.
  SELECT CASE WHEN v IS NULL THEN NULL ELSE least(100, v)::integer END FROM (SELECT CASE
    WHEN (_p #>> '{batteries,0,health_pct}') ~ '^[0-9]{1,3}(\.[0-9]+)?$' THEN round((_p #>> '{batteries,0,health_pct}')::numeric)
    WHEN (_p #>> '{batteries,0,full_charge_capacity_mwh}') ~ '^[0-9]{1,9}$' AND (_p #>> '{batteries,0,design_capacity_mwh}') ~ '^[0-9]{1,9}$'
      AND (_p #>> '{batteries,0,design_capacity_mwh}')::numeric > 0
      THEN round((_p #>> '{batteries,0,full_charge_capacity_mwh}')::numeric * 100 / (_p #>> '{batteries,0,design_capacity_mwh}')::numeric)
  END AS v) s
$$;
REVOKE EXECUTE ON FUNCTION public._payload_battery_pct(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_device_from_discovery(_discovery uuid, _asset_tag text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_d public.agent_discoveries; v_dev uuid; r record; v_ser text; v_drive uuid; v_if public.drive_interface; v_cap bigint;
  v_origin text; v_hb timestamptz; v_st text;
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
  -- The laptop must be connected now: adding queues a rescan, and the station's next report is what
  -- confirms the record ("Station-reported identity"). 90 s matches the app's "Connected" indicator.
  SELECT status, last_heartbeat_at INTO v_st, v_hb FROM public.agents WHERE id = v_d.agent_id;
  IF v_st IS DISTINCT FROM 'active' OR v_hb IS NULL OR v_hb < now() - interval '90 seconds' THEN
    RAISE EXCEPTION 'The laptop is not connected to NexWipe. Start NexWipe on the laptop (or boot it from the NexWipe stick), then add it to inventory.'
      USING ERRCODE = '22023';
  END IF;
  v_origin := CASE WHEN v_d.hardware_origin = 'synthetic' THEN 'synthetic' ELSE 'not_station_reported' END;

  INSERT INTO public.devices(org_id, asset_tag, manufacturer, model, system_serial, cpu, ram_gb, battery_health_pct, notes, hardware_origin)
  VALUES (v_d.org_id, trim(_asset_tag),
    left(nullif(trim(v_d.payload #>> '{system,manufacturer}'), ''), 80),
    left(nullif(trim(v_d.payload #>> '{system,model}'), ''), 120),
    v_d.system_serial,
    left(nullif(trim(v_d.payload #>> '{system,cpu}'), ''), 120),
    public._payload_ram_gb(v_d.payload), public._payload_battery_pct(v_d.payload),
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

-- Fill RAM and battery health for laptops already added from a station report (latest report wins),
-- only where still empty. Runs as the migration owner, so the audit history records it with no actor.
UPDATE public.devices d SET
    ram_gb = coalesce(d.ram_gb, public._payload_ram_gb(x.payload)),
    battery_health_pct = coalesce(d.battery_health_pct, public._payload_battery_pct(x.payload))
  FROM (SELECT DISTINCT ON (device_id) device_id, payload FROM public.agent_discoveries
        WHERE device_id IS NOT NULL AND NOT is_simulated ORDER BY device_id, last_reported_at DESC) x
  WHERE d.id = x.device_id AND NOT d.is_simulated
    AND ((d.ram_gb IS NULL AND public._payload_ram_gb(x.payload) IS NOT NULL)
      OR (d.battery_health_pct IS NULL AND public._payload_battery_pct(x.payload) IS NOT NULL));