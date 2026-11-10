-- Agent-run device diagnostics: first test is the keyboard. A technician at a connected laptop
-- runs a test the app requests; the Windows helper collects the result and reports it back.
--
-- Safety: a diagnostic NEVER touches storage. The keyboard test only reads key presses on the
-- laptop. The command path mirrors Reboot into NexWipe (0019): requested -> delivered (handed to
-- the helper exactly once by heartbeat) -> done/failed (reported), or expired if no heartbeat
-- picked it up within 2 minutes. Results are recorded only; they do not change a device grade.

-- ===== 1) Diagnostic command state on the agent (mirrors the reboot columns) =====
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS diagnostic_requested_at timestamptz;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS diagnostic_test text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS diagnostic_requested_by uuid;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS diagnostic_status text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS diagnostic_detail text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS diagnostic_status_at timestamptz;
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_diagnostic_status_chk;
ALTER TABLE public.agents ADD CONSTRAINT agents_diagnostic_status_chk
  CHECK (diagnostic_status IS NULL OR diagnostic_status IN ('requested','delivered','done','failed','expired'));
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_diagnostic_test_chk;
ALTER TABLE public.agents ADD CONSTRAINT agents_diagnostic_test_chk
  CHECK (diagnostic_test IS NULL OR diagnostic_test IN ('keyboard'));

-- ===== 2) Diagnostic results (append-only, agent-written) =====
-- device_code is the stable per-laptop identity (0019); device_id is set when the laptop is in
-- inventory. Both are resolved by trusted code from the agent's latest discovery, never by the app.
CREATE TABLE IF NOT EXISTS public.diagnostic_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  device_code text NOT NULL,
  device_id uuid,
  test text NOT NULL CHECK (test IN ('keyboard')),
  outcome text NOT NULL CHECK (outcome IN ('pass','fail','incomplete')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail text,
  is_simulated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, agent_id) REFERENCES public.agents(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, device_id) REFERENCES public.devices(org_id, id) ON DELETE SET NULL (device_id)
);
CREATE INDEX IF NOT EXISTS diagnostic_results_code_idx ON public.diagnostic_results(org_id, device_code, created_at DESC);
CREATE INDEX IF NOT EXISTS diagnostic_results_device_idx ON public.diagnostic_results(org_id, device_id, created_at DESC);

GRANT SELECT ON public.diagnostic_results TO authenticated;   -- no INSERT/UPDATE/DELETE for app users
GRANT ALL ON public.diagnostic_results TO service_role;
ALTER TABLE public.diagnostic_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read diagnostic results" ON public.diagnostic_results
  FOR SELECT TO authenticated USING (public.is_org_staff(org_id));

DROP TRIGGER IF EXISTS diagnostic_results_append_only ON public.diagnostic_results;
CREATE TRIGGER diagnostic_results_append_only BEFORE UPDATE OR DELETE ON public.diagnostic_results
  FOR EACH ROW EXECUTE FUNCTION public.append_only();

-- ===== 3) Request a diagnostic from the app (clone of request_station_action) =====
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

-- ===== 4) Heartbeat: deliver a pending diagnostic exactly once (adds to 0019 behaviour) =====
CREATE OR REPLACE FUNCTION public.agent_heartbeat(_agent uuid, _state text, _version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_queued integer; v_req timestamptz; v_reboot boolean := false;
  v_diag boolean := false; v_diag_test text; v_ag public.agents;
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
  IF v_ag.diagnostic_status = 'requested' THEN
    IF v_ag.diagnostic_status_at < now() - interval '2 minutes' THEN
      UPDATE public.agents SET diagnostic_status = 'expired', diagnostic_status_at = now(),
        diagnostic_detail = 'No heartbeat from the laptop within 2 minutes' WHERE id = _agent;
    ELSE
      UPDATE public.agents SET diagnostic_status = 'delivered', diagnostic_status_at = now() WHERE id = _agent;
      v_diag := true; v_diag_test := v_ag.diagnostic_test;
    END IF;
  END IF;
  PERFORM public._sweep_jobs(v_org);
  SELECT count(*) INTO v_queued FROM public.jobs WHERE agent_id = _agent AND status = 'queued';
  RETURN jsonb_build_object('server_time', now(), 'queued_jobs', v_queued, 'heartbeat_timeout_seconds', 180,
    'inventory_requested', v_req IS NOT NULL, 'reboot_to_usb_requested', v_reboot,
    'diagnostic_requested', v_diag, 'diagnostic_test', v_diag_test);
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) TO service_role;

-- ===== 5) The helper reports a finished diagnostic (service-role only) =====
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