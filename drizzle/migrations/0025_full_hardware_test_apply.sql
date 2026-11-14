-- Full hardware test on the NexWipe boot stick (replaces the Windows-helper keyboard test).
--
-- Why: the keyboard test ran inside each laptop's own Windows (WinForms window), so it depended on
-- the Windows version, .NET, focus and drivers of every laptop and failed on many. The boot stick
-- runs the same Linux on every laptop and reads keys, touchpad, camera, microphone, speakers,
-- battery, charger and Wi-Fi directly (agent-handoff/station/nd_station/hwtest.py).
--
-- Changes ("Run complete test suite" in the app):
--  * New test value 'full' (one row per run; per-test outcomes in result->'tests').
--  * request_diagnostic: only 'full'. New 'keyboard' requests are refused; old results stay readable.
--  * Windows helper: lists the tests and permissions, asks the person at the laptop, then restarts
--    into the stick and reports outcome 'handoff' (closes its request, no result row) or
--    'incomplete' (declined / could not restart: recorded). It can never report test results.
--  * Boot-stick station: runs the suite (also when started at the laptop without a cloud request,
--    e.g. after the Windows hand-off) and reports the result; a delivered request is marked done/failed.
-- Safety is unchanged: a diagnostic never touches storage and never changes a grade.

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_diagnostic_test_chk;
ALTER TABLE public.agents ADD CONSTRAINT agents_diagnostic_test_chk
  CHECK (diagnostic_test IS NULL OR diagnostic_test IN ('keyboard','full'));
ALTER TABLE public.diagnostic_results DROP CONSTRAINT IF EXISTS diagnostic_results_test_check;
ALTER TABLE public.diagnostic_results ADD CONSTRAINT diagnostic_results_test_check
  CHECK (test IN ('keyboard','full'));

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
  IF _test IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'Unknown diagnostic test' USING ERRCODE = '22023'; END IF;
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
DECLARE v_ag public.agents; v_code text; v_device uuid; v_delivered boolean;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  IF _test NOT IN ('keyboard','full') OR _test IS NULL THEN RAISE EXCEPTION 'Unknown diagnostic test' USING ERRCODE = 'ND422'; END IF;
  IF _outcome NOT IN ('pass','fail','incomplete','handoff') OR _outcome IS NULL THEN RAISE EXCEPTION 'Unknown diagnostic outcome' USING ERRCODE = 'ND422'; END IF;
  -- coalesce: a station with no request has NULL status, and NOT NULL would let a keyboard result through.
  v_delivered := coalesce(v_ag.diagnostic_status = 'delivered' AND v_ag.diagnostic_test = _test, false);
  IF _test = 'full' AND public._agent_is_windows_helper(v_ag.platform) THEN
    -- The Windows helper only hands the suite over to the stick (or says why it could not).
    IF NOT v_delivered THEN RAISE EXCEPTION 'No diagnostic was delivered to this station' USING ERRCODE = 'ND409'; END IF;
    IF _outcome NOT IN ('handoff','incomplete') THEN
      RAISE EXCEPTION 'Test results are reported by the NexWipe stick only' USING ERRCODE = 'ND422';
    END IF;
    IF _outcome = 'handoff' THEN
      UPDATE public.agents SET diagnostic_status = 'done', diagnostic_status_at = now(), diagnostic_requested_at = NULL,
        diagnostic_detail = 'Restarting into the NexWipe stick; the test suite runs there' WHERE id = _agent;
      INSERT INTO public.audit_events(org_id, actor_id, action, entity_type, entity_id, details)
      VALUES (v_ag.org_id, NULL, 'agents.diagnostic_full_handoff', 'agents', _agent, jsonb_build_object('station', v_ag.name));
      RETURN jsonb_build_object('ok', true, 'outcome', 'handoff');
    END IF;
  ELSIF _outcome = 'handoff' THEN
    RAISE EXCEPTION 'Only the Windows helper hands a test suite over' USING ERRCODE = 'ND422';
  ELSIF _test = 'full' THEN
    NULL;  -- boot-stick station: may also report a suite started at the laptop, without a cloud request
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
