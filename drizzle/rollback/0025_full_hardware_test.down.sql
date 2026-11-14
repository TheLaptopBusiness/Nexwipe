-- UNDO for drizzle/migrations/0025_full_hardware_test.sql.
-- Restores request_diagnostic and agent_report_diagnostic exactly as defined in 0024 (keyboard test
-- via the Windows helper only) and the keyboard-only test constraints.
-- Data note: full hardware test results ('full' rows in diagnostic_results) are deleted, because the
-- 0024 constraint does not allow them. They are technician test records, not part of any erasure
-- outcome. The append-only trigger is paused only for that delete, inside this script.

ALTER TABLE public.diagnostic_results DISABLE TRIGGER diagnostic_results_append_only;
DELETE FROM public.diagnostic_results WHERE test = 'full';
ALTER TABLE public.diagnostic_results ENABLE TRIGGER diagnostic_results_append_only;
UPDATE public.agents SET diagnostic_test = NULL, diagnostic_status = NULL, diagnostic_detail = NULL,
  diagnostic_status_at = NULL, diagnostic_requested_at = NULL, diagnostic_requested_by = NULL
  WHERE diagnostic_test = 'full';

ALTER TABLE public.diagnostic_results DROP CONSTRAINT IF EXISTS diagnostic_results_test_check;
ALTER TABLE public.diagnostic_results ADD CONSTRAINT diagnostic_results_test_check CHECK (test IN ('keyboard'));
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_diagnostic_test_chk;
ALTER TABLE public.agents ADD CONSTRAINT agents_diagnostic_test_chk
  CHECK (diagnostic_test IS NULL OR diagnostic_test IN ('keyboard'));

CREATE OR REPLACE FUNCTION public.request_diagnostic(_agent uuid, _test text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ag public.agents;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent FOR UPDATE;
  -- Owners/admins only count in an AAL2 session (has_org_role); auditors and viewers cannot act.
  IF NOT FOUND OR NOT public.has_org_role(v_ag.org_id, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Station not found or not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_ag.status <> 'active' THEN RAISE EXCEPTION 'This station has been revoked' USING ERRCODE = '22023'; END IF;
  IF _test IS DISTINCT FROM 'keyboard' THEN RAISE EXCEPTION 'Unknown diagnostic test' USING ERRCODE = '22023'; END IF;
  -- The keyboard test runs in the Windows helper's own window; the boot-stick station has no desktop.
  IF NOT public._agent_is_windows_helper(v_ag.platform) THEN
    RAISE EXCEPTION 'Diagnostics run on laptops using the Windows helper' USING ERRCODE = '22023';
  END IF;
  IF v_ag.is_simulated THEN RAISE EXCEPTION 'Simulated stations cannot run diagnostics' USING ERRCODE = '22023'; END IF;
  IF v_ag.diagnostic_status IN ('requested','delivered') AND v_ag.diagnostic_status_at > now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'A diagnostic is already in progress for this station' USING ERRCODE = '22023';
  END IF;
  UPDATE public.agents SET diagnostic_requested_at = now(), diagnostic_test = _test, diagnostic_requested_by = auth.uid(),
    diagnostic_status = 'requested', diagnostic_detail = NULL, diagnostic_status_at = now() WHERE id = _agent;
  INSERT INTO public.audit_events(org_id, actor_id, action, entity_type, entity_id, details)
  VALUES (v_ag.org_id, auth.uid(), 'agents.diagnostic_requested', 'agents', _agent,
    jsonb_build_object('station', v_ag.name, 'test', _test));
  RETURN jsonb_build_object('ok', true, 'test', _test);
END $$;
REVOKE EXECUTE ON FUNCTION public.request_diagnostic(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_diagnostic(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.agent_report_diagnostic(_agent uuid, _test text, _outcome text, _result jsonb, _detail text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ag public.agents; v_code text; v_device uuid;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  IF _test IS DISTINCT FROM 'keyboard' THEN RAISE EXCEPTION 'Unknown diagnostic test' USING ERRCODE = 'ND422'; END IF;
  IF _outcome NOT IN ('pass','fail','incomplete') THEN RAISE EXCEPTION 'Unknown diagnostic outcome' USING ERRCODE = 'ND422'; END IF;
  -- Only a diagnostic this station was actually handed can be reported on.
  IF v_ag.diagnostic_status IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION 'No diagnostic was delivered to this station' USING ERRCODE = 'ND409';
  END IF;
  -- Identify which laptop this is from the agent's most recent discovery.
  SELECT device_code, device_id INTO v_code, v_device FROM public.agent_discoveries
    WHERE agent_id = _agent ORDER BY reported_at DESC LIMIT 1;
  IF v_code IS NULL THEN RAISE EXCEPTION 'This station has not reported a laptop yet' USING ERRCODE = 'ND409'; END IF;

  INSERT INTO public.diagnostic_results(org_id, agent_id, device_code, device_id, test, outcome, result, detail, is_simulated)
  VALUES (v_ag.org_id, _agent, v_code, v_device, _test, _outcome, coalesce(_result, '{}'::jsonb),
    left(nullif(trim(_detail), ''), 300), v_ag.is_simulated);

  UPDATE public.agents SET diagnostic_status = CASE WHEN _outcome = 'incomplete' THEN 'failed' ELSE 'done' END,
    diagnostic_detail = left(nullif(trim(_detail), ''), 300), diagnostic_status_at = now(),
    diagnostic_requested_at = NULL WHERE id = _agent;

  INSERT INTO public.audit_events(org_id, actor_id, action, entity_type, entity_id, details)
  VALUES (v_ag.org_id, NULL, 'agents.diagnostic_' || _test || '_' || _outcome, 'agents', _agent,
    jsonb_build_object('station', v_ag.name, 'device_code', v_code, 'outcome', _outcome));
  RETURN jsonb_build_object('ok', true, 'outcome', _outcome);
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_report_diagnostic(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_report_diagnostic(uuid, text, text, jsonb, text) TO service_role;
