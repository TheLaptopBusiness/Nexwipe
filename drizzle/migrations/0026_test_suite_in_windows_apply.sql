-- Complete test suite runs inside the laptop's own Windows (no restart).
--
-- Why: 0025 had the Windows helper restart the laptop into the NexWipe stick to test. Restarting is slow,
-- fails on laptops whose firmware will not boot the stick, and Linux lacks drivers for many newer
-- webcams. The helper now opens a local test page in Edge/Chrome (agent-handoff/windows-helper/
-- nexwipe-test.html), like retest.us, and reports the result itself.
--
-- Change: agent_report_diagnostic lets the Windows helper report a full test result (pass / fail /
-- incomplete), only for a suite request it was actually handed; the 'handoff' outcome from 0025 is gone.
-- The boot-stick station is unchanged (it still runs its own suite, also when started at the laptop).
-- Results still never change a grade, and app users still cannot write them.

CREATE OR REPLACE FUNCTION public.agent_report_diagnostic(_agent uuid, _test text, _outcome text, _result jsonb, _detail text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ag public.agents; v_code text; v_device uuid; v_delivered boolean;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  IF _test NOT IN ('keyboard','full') OR _test IS NULL THEN RAISE EXCEPTION 'Unknown diagnostic test' USING ERRCODE = 'ND422'; END IF;
  IF _outcome NOT IN ('pass','fail','incomplete') OR _outcome IS NULL THEN RAISE EXCEPTION 'Unknown diagnostic outcome' USING ERRCODE = 'ND422'; END IF;
  -- coalesce: a station with no request has NULL status, and NOT NULL would let a keyboard result through.
  v_delivered := coalesce(v_ag.diagnostic_status = 'delivered' AND v_ag.diagnostic_test = _test, false);
  IF _test = 'full' AND public._agent_is_windows_helper(v_ag.platform) THEN
    -- The Windows helper runs the suite in the laptop's own Windows, only when the app asked for it.
    IF NOT v_delivered THEN RAISE EXCEPTION 'No diagnostic was delivered to this station' USING ERRCODE = 'ND409'; END IF;
  ELSIF _test = 'full' THEN
    NULL;  -- boot-stick station: may also report a suite started at the laptop (key T), without a cloud request
  ELSIF NOT v_delivered THEN
    -- A keyboard result is only accepted for a keyboard test this station was actually handed.
    RAISE EXCEPTION 'No diagnostic was delivered to this station' USING ERRCODE = 'ND409';
  END IF;
  -- Identify which laptop this is from the agent's most recent discovery.
  SELECT device_code, device_id INTO v_code, v_device FROM public.agent_discoveries
    WHERE agent_id = _agent ORDER BY reported_at DESC LIMIT 1;
  IF v_code IS NULL THEN RAISE EXCEPTION 'This station has not reported a laptop yet' USING ERRCODE = 'ND409'; END IF;

  INSERT INTO public.diagnostic_results(org_id, agent_id, device_code, device_id, test, outcome, result, detail, is_simulated)
  VALUES (v_ag.org_id, _agent, v_code, v_device, _test, _outcome, coalesce(_result, '{}'::jsonb),
    left(nullif(trim(_detail), ''), 300), v_ag.is_simulated);

  IF v_delivered THEN
    UPDATE public.agents SET diagnostic_status = CASE WHEN _outcome = 'incomplete' THEN 'failed' ELSE 'done' END,
      diagnostic_detail = left(nullif(trim(_detail), ''), 300), diagnostic_status_at = now(),
      diagnostic_requested_at = NULL WHERE id = _agent;
  END IF;

  INSERT INTO public.audit_events(org_id, actor_id, action, entity_type, entity_id, details)
  VALUES (v_ag.org_id, NULL, 'agents.diagnostic_' || _test || '_' || _outcome, 'agents', _agent,
    jsonb_build_object('station', v_ag.name, 'device_code', v_code, 'outcome', _outcome, 'requested', v_delivered));
  RETURN jsonb_build_object('ok', true, 'outcome', _outcome);
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_report_diagnostic(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_report_diagnostic(uuid, text, text, jsonb, text) TO service_role;
