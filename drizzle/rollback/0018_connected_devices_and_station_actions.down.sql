-- UNDO for drizzle/migrations/0018_connected_devices_and_station_actions.sql.
-- Run only if 0018 must be reverted. Restores the schema exactly as it was after 0017
-- (verified by comparing a full schema dump before 0018 and after 0018 + this file).
-- Data loss on undo: the device codes (barcodes) and the reboot request status are removed.
-- Station reports, stations, inventory and audit history are untouched.

DROP TRIGGER IF EXISTS agent_discoveries_device_code ON public.agent_discoveries;
DROP FUNCTION IF EXISTS public.set_discovery_device_code();
DROP FUNCTION IF EXISTS public._new_device_code();
DROP INDEX IF EXISTS public.agent_discoveries_device_code_idx;
ALTER TABLE public.agent_discoveries DROP CONSTRAINT IF EXISTS agent_discoveries_device_code_chk;
ALTER TABLE public.agent_discoveries DROP COLUMN IF EXISTS device_code;

DROP FUNCTION IF EXISTS public.request_station_action(uuid, text);
DROP FUNCTION IF EXISTS public.agent_report_action(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public._agent_is_windows_helper(text);
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_reboot_status_chk;
ALTER TABLE public.agents DROP COLUMN IF EXISTS reboot_requested_at;
ALTER TABLE public.agents DROP COLUMN IF EXISTS reboot_requested_by;
ALTER TABLE public.agents DROP COLUMN IF EXISTS reboot_status;
ALTER TABLE public.agents DROP COLUMN IF EXISTS reboot_detail;
ALTER TABLE public.agents DROP COLUMN IF EXISTS reboot_status_at;

-- Heartbeat exactly as defined in 0007_phase2b_mfa_enforcement_and_discovery_intake.sql
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
REVOKE EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) TO service_role;
