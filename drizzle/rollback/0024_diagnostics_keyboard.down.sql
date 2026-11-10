-- UNDO for drizzle/migrations/0024_diagnostics_keyboard.sql.
-- Restores agent_heartbeat exactly as defined in 0019 (no diagnostic delivery), drops the two new
-- RPCs, the diagnostic_results table and the agents.diagnostic_* columns.
-- Data note: recorded diagnostic results are lost (the table is dropped). These are append-only
-- technician test records, not part of any erasure outcome.

DROP FUNCTION IF EXISTS public.agent_report_diagnostic(uuid, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.request_diagnostic(uuid, text);

-- Restore agent_heartbeat to its 0019 definition.
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

DROP TABLE IF EXISTS public.diagnostic_results;

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_diagnostic_test_chk;
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_diagnostic_status_chk;
ALTER TABLE public.agents DROP COLUMN IF EXISTS diagnostic_status_at;
ALTER TABLE public.agents DROP COLUMN IF EXISTS diagnostic_detail;
ALTER TABLE public.agents DROP COLUMN IF EXISTS diagnostic_status;
ALTER TABLE public.agents DROP COLUMN IF EXISTS diagnostic_requested_by;
ALTER TABLE public.agents DROP COLUMN IF EXISTS diagnostic_test;
ALTER TABLE public.agents DROP COLUMN IF EXISTS diagnostic_requested_at;
