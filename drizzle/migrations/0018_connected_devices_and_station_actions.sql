-- Connected devices: a stable barcode code per reported laptop, and two station actions requested
-- from the app (Rescan, Reboot into NexWipe). Builds on agent_discoveries and agents.inventory_requested_at.
-- Neither action can touch storage: rescan re-reads hardware identity; reboot_to_usb only asks a
-- Windows helper to set a one-time firmware boot entry and restart. There is deliberately no wipe action.

-- ===== 1) Device code (barcode) =====
ALTER TABLE public.agent_discoveries ADD COLUMN IF NOT EXISTS device_code text;

CREATE OR REPLACE FUNCTION public._new_device_code()
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public, extensions AS $$
DECLARE
  -- Crockford base32: no I, L, O, U, so codes read back unambiguously from a printed label.
  a constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b bytea := extensions.gen_random_bytes(5);  -- 40 bits = 8 base32 characters
  bits bigint := 0; out text := ''; i int;
BEGIN
  FOR i IN 0..4 LOOP bits := (bits << 8) | get_byte(b, i); END LOOP;
  FOR i IN REVERSE 7..0 LOOP out := out || substr(a, ((bits >> (i * 5)) & 31)::int + 1, 1); END LOOP;
  RETURN 'NW-' || out;
END $$;
REVOKE EXECUTE ON FUNCTION public._new_device_code() FROM PUBLIC, anon, authenticated;

-- One laptop keeps one code: a new discovery reuses the code of an earlier discovery in the same
-- company with the same system serial (another station, or the Windows helper and the boot stick).
-- The code is set by the database only and never changes afterwards.
CREATE OR REPLACE FUNCTION public.set_discovery_device_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; n int := 0;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.device_code := OLD.device_code;
    RETURN NEW;
  END IF;
  IF NEW.system_serial IS NOT NULL THEN
    SELECT device_code INTO v_code FROM public.agent_discoveries
      WHERE org_id = NEW.org_id AND is_simulated = NEW.is_simulated AND upper(system_serial) = upper(NEW.system_serial)
        AND device_code IS NOT NULL
      ORDER BY reported_at LIMIT 1;
  END IF;
  WHILE v_code IS NULL LOOP
    n := n + 1;
    IF n > 20 THEN RAISE EXCEPTION 'Could not allocate a unique device code'; END IF;
    v_code := public._new_device_code();
    IF EXISTS (SELECT 1 FROM public.agent_discoveries WHERE device_code = v_code) THEN v_code := NULL; END IF;
  END LOOP;
  NEW.device_code := v_code;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_discovery_device_code() FROM PUBLIC, anon, authenticated;

-- Backfill existing reports, oldest first so the earliest report of a laptop defines its code.
DO $$
DECLARE r record; v_code text;
BEGIN
  FOR r IN SELECT id, org_id, is_simulated, system_serial FROM public.agent_discoveries WHERE device_code IS NULL ORDER BY reported_at LOOP
    v_code := NULL;
    IF r.system_serial IS NOT NULL THEN
      SELECT device_code INTO v_code FROM public.agent_discoveries
        WHERE org_id = r.org_id AND is_simulated = r.is_simulated AND upper(system_serial) = upper(r.system_serial) AND device_code IS NOT NULL LIMIT 1;
    END IF;
    WHILE v_code IS NULL LOOP
      v_code := public._new_device_code();
      IF EXISTS (SELECT 1 FROM public.agent_discoveries WHERE device_code = v_code) THEN v_code := NULL; END IF;
    END LOOP;
    UPDATE public.agent_discoveries SET device_code = v_code WHERE id = r.id;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS agent_discoveries_device_code ON public.agent_discoveries;
CREATE TRIGGER agent_discoveries_device_code BEFORE INSERT OR UPDATE ON public.agent_discoveries
  FOR EACH ROW EXECUTE FUNCTION public.set_discovery_device_code();
ALTER TABLE public.agent_discoveries ALTER COLUMN device_code SET NOT NULL;
ALTER TABLE public.agent_discoveries DROP CONSTRAINT IF EXISTS agent_discoveries_device_code_chk;
ALTER TABLE public.agent_discoveries ADD CONSTRAINT agent_discoveries_device_code_chk CHECK (device_code ~ '^NW-[0-9A-HJKMNP-TV-Z]{8}$');
CREATE INDEX IF NOT EXISTS agent_discoveries_device_code_idx ON public.agent_discoveries(org_id, device_code);

-- ===== 2) Station actions =====
-- Rescan reuses agents.inventory_requested_at (already returned by heartbeat as inventory_requested).
-- Reboot into NexWipe: requested -> delivered (handed to the helper exactly once by heartbeat)
-- -> done/failed (reported by the helper), or expired if no heartbeat picked it up within 2 minutes.
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS reboot_requested_at timestamptz;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS reboot_requested_by uuid;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS reboot_status text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS reboot_detail text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS reboot_status_at timestamptz;
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_reboot_status_chk;
ALTER TABLE public.agents ADD CONSTRAINT agents_reboot_status_chk
  CHECK (reboot_status IS NULL OR reboot_status IN ('requested','delivered','done','failed','expired'));

/** Only Windows helpers can reboot into the stick; the boot-stick station is already running from it. */
CREATE OR REPLACE FUNCTION public._agent_is_windows_helper(_platform text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(lower(_platform) LIKE 'windows%', false)
$$;
REVOKE EXECUTE ON FUNCTION public._agent_is_windows_helper(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_station_action(_agent uuid, _action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ag public.agents;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent FOR UPDATE;
  -- Owners/admins only count in an AAL2 session (has_org_role); auditors and viewers cannot act on stations.
  IF NOT FOUND OR NOT public.has_org_role(v_ag.org_id, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Station not found or not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_ag.status <> 'active' THEN RAISE EXCEPTION 'This station has been revoked' USING ERRCODE = '22023'; END IF;
  IF _action = 'rescan' THEN
    UPDATE public.agents SET inventory_requested_at = now() WHERE id = _agent;
  ELSIF _action = 'reboot_to_usb' THEN
    IF NOT public._agent_is_windows_helper(v_ag.platform) THEN
      RAISE EXCEPTION 'Reboot into NexWipe is only for laptops running the Windows helper; this station is already running from the NexWipe stick'
        USING ERRCODE = '22023';
    END IF;
    IF v_ag.is_simulated THEN RAISE EXCEPTION 'Simulated stations cannot be rebooted' USING ERRCODE = '22023'; END IF;
    IF v_ag.reboot_status IN ('requested','delivered') AND v_ag.reboot_status_at > now() - interval '2 minutes' THEN
      RAISE EXCEPTION 'A reboot is already in progress for this station' USING ERRCODE = '22023';
    END IF;
    UPDATE public.agents SET reboot_requested_at = now(), reboot_requested_by = auth.uid(), reboot_status = 'requested',
      reboot_detail = NULL, reboot_status_at = now() WHERE id = _agent;
  ELSE
    RAISE EXCEPTION 'Unknown station action' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_events(org_id, actor_id, action, entity_type, entity_id, details)
  VALUES (v_ag.org_id, auth.uid(), 'agents.' || _action || '_requested', 'agents', _agent, jsonb_build_object('station', v_ag.name));
  RETURN jsonb_build_object('ok', true, 'action', _action);
END $$;
REVOKE EXECUTE ON FUNCTION public.request_station_action(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_station_action(uuid, text) TO authenticated;

-- Heartbeat: unchanged behaviour plus exactly-once delivery of a pending reboot request.
CREATE OR REPLACE FUNCTION public.agent_heartbeat(_agent uuid, _state text, _version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_queued integer; v_req timestamptz; v_reboot boolean := false; v_ag public.agents;
BEGIN
  UPDATE public.agents SET last_heartbeat_at = now(), last_state = left(coalesce(_state, 'idle'), 40),
    agent_version = coalesce(left(_version, 40), agent_version)
    WHERE id = _agent AND status = 'active' RETURNING * INTO v_ag;
  IF v_ag.id IS NULL THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  v_org := v_ag.org_id; v_req := v_ag.inventory_requested_at;
  IF v_ag.reboot_status = 'requested' THEN
    IF v_ag.reboot_status_at < now() - interval '2 minutes' THEN
      -- A late reboot is never delivered: the technician may have walked away.
      UPDATE public.agents SET reboot_status = 'expired', reboot_status_at = now(),
        reboot_detail = 'No heartbeat from the laptop within 2 minutes' WHERE id = _agent;
    ELSE
      UPDATE public.agents SET reboot_status = 'delivered', reboot_status_at = now() WHERE id = _agent;
      v_reboot := true;
    END IF;
  END IF;
  PERFORM public._sweep_jobs(v_org);
  SELECT count(*) INTO v_queued FROM public.jobs WHERE agent_id = _agent AND status = 'queued';
  RETURN jsonb_build_object('server_time', now(), 'queued_jobs', v_queued, 'heartbeat_timeout_seconds', 180,
    'inventory_requested', v_req IS NOT NULL, 'reboot_to_usb_requested', v_reboot);
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.agent_report_action(_agent uuid, _action text, _ok boolean, _detail text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ag public.agents;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  IF _action <> 'reboot_to_usb' THEN RAISE EXCEPTION 'Unknown station action' USING ERRCODE = 'ND422'; END IF;
  -- Only a reboot this station was actually handed can be reported on.
  IF v_ag.reboot_status IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION 'No reboot was delivered to this station' USING ERRCODE = 'ND409';
  END IF;
  UPDATE public.agents SET reboot_status = CASE WHEN _ok THEN 'done' ELSE 'failed' END,
    reboot_detail = left(nullif(trim(_detail), ''), 300), reboot_status_at = now() WHERE id = _agent;
  INSERT INTO public.audit_events(org_id, actor_id, action, entity_type, entity_id, details)
  VALUES (v_ag.org_id, NULL, 'agents.reboot_to_usb_' || CASE WHEN _ok THEN 'done' ELSE 'failed' END, 'agents', _agent,
    jsonb_build_object('station', v_ag.name, 'detail', left(_detail, 300)));
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN _ok THEN 'done' ELSE 'failed' END);
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_report_action(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_report_action(uuid, text, boolean, text) TO service_role;
