ALTER TABLE public.job_events ADD COLUMN response jsonb;

REVOKE EXECUTE ON FUNCTION public.device_all_drives_approved(uuid) FROM authenticated;

-- ===== Internal helpers (not callable by app users) =====
CREATE OR REPLACE FUNCTION public._log_job_event(
  _org uuid, _job uuid, _source text, _type text, _from public.job_status, _to public.job_status,
  _message text, _payload jsonb, _actor uuid, _agent uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.job_events(org_id, job_id, source, event_type, from_status, to_status, message, payload, actor_id, agent_id)
  VALUES (_org, _job, _source, _type, _from, _to, _message, coalesce(_payload, '{}'::jsonb), _actor, _agent)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.manufacturer_allowed(_mfr text, _allowed text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _mfr IS NOT NULL AND trim(_mfr) <> '' AND EXISTS (
    SELECT 1 FROM unnest(_allowed) m
    WHERE lower(trim(_mfr)) LIKE lower(trim(m)) || '%'
       OR (lower(trim(m)) = 'hp' AND lower(trim(_mfr)) LIKE 'hewlett%'))
$$;

CREATE OR REPLACE FUNCTION public._policy_support_reason(_pv public.policy_versions, _mfr text, _iface public.drive_interface)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF _iface = 'unsupported_other' THEN
    RETURN 'Drive interface is outside the supported scope (RAID, USB bridges, eMMC and similar are not supported).';
  END IF;
  IF NOT (_iface = ANY (_pv.allowed_interfaces)) THEN
    RETURN format('Policy version %s does not permit %s drives.', _pv.version, _iface);
  END IF;
  IF NOT public.manufacturer_allowed(_mfr, _pv.allowed_manufacturers) THEN
    RETURN format('Device manufacturer "%s" is not permitted by policy version %s.', coalesce(nullif(trim(_mfr), ''), 'unknown'), _pv.version);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._sync_device_after_job(_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.jobs; v_status public.device_status;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = _job;
  SELECT status INTO v_status FROM public.devices WHERE id = v_job.device_id FOR UPDATE;
  IF v_job.status = 'running' AND v_status IN ('received','awaiting_processing') THEN
    UPDATE public.devices SET status = 'in_processing' WHERE id = v_job.device_id;
  ELSIF v_job.status = 'quarantined' AND v_status <> 'quarantined' THEN
    UPDATE public.devices SET status = 'quarantined' WHERE id = v_job.device_id;
  ELSIF v_job.status = 'unsupported' AND v_status NOT IN ('quarantined','referred_manual') THEN
    UPDATE public.devices SET status = 'referred_manual' WHERE id = v_job.device_id;
  ELSIF v_job.status = 'approved' AND v_status NOT IN ('processed','released','quarantined')
        AND public.device_all_drives_approved(v_job.device_id) THEN
    UPDATE public.devices SET status = 'processed' WHERE id = v_job.device_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._insert_policy_version(_org uuid, _policy uuid, _version integer, _rules jsonb, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_ifaces public.drive_interface[]; v_methods public.erasure_method[]; v_mfrs text[];
  v_roles public.org_role[]; v_m public.erasure_method; v_i public.drive_interface; v_vm text; v_pct integer;
BEGIN
  IF jsonb_typeof(_rules) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Policy rules must be a JSON object' USING ERRCODE = 'ND422';
  END IF;
  v_mfrs := ARRAY(SELECT DISTINCT trim(x) FROM jsonb_array_elements_text(coalesce(_rules->'allowed_manufacturers', '[]'::jsonb)) x WHERE trim(x) <> '');
  v_ifaces := ARRAY(SELECT DISTINCT x::public.drive_interface FROM jsonb_array_elements_text(coalesce(_rules->'allowed_interfaces', '[]'::jsonb)) x);
  v_methods := ARRAY(SELECT DISTINCT x::public.erasure_method FROM jsonb_array_elements_text(coalesce(_rules->'allowed_methods', '[]'::jsonb)) x);
  v_roles := ARRAY(SELECT DISTINCT x::public.org_role FROM jsonb_array_elements_text(coalesce(_rules->'reviewer_roles', '["owner","admin"]'::jsonb)) x);
  IF cardinality(v_mfrs) = 0 THEN RAISE EXCEPTION 'Select at least one permitted manufacturer' USING ERRCODE = 'ND422'; END IF;
  IF cardinality(v_ifaces) = 0 THEN RAISE EXCEPTION 'Select at least one permitted drive interface' USING ERRCODE = 'ND422'; END IF;
  IF cardinality(v_methods) = 0 THEN RAISE EXCEPTION 'Select at least one permitted method' USING ERRCODE = 'ND422'; END IF;
  IF cardinality(v_roles) = 0 THEN RAISE EXCEPTION 'Select at least one reviewer role' USING ERRCODE = 'ND422'; END IF;
  FOREACH v_m IN ARRAY v_methods LOOP
    IF NOT EXISTS (SELECT 1 FROM unnest(v_ifaces) i WHERE public.method_fits_interface(v_m, i)) THEN
      RAISE EXCEPTION 'Method % does not apply to any selected drive interface', v_m USING ERRCODE = 'ND422';
    END IF;
  END LOOP;
  FOREACH v_i IN ARRAY v_ifaces LOOP
    IF NOT EXISTS (SELECT 1 FROM unnest(v_methods) m WHERE public.method_fits_interface(m, v_i)) THEN
      RAISE EXCEPTION 'No permitted method applies to % drives', v_i USING ERRCODE = 'ND422';
    END IF;
  END LOOP;
  v_vm := coalesce(_rules->>'verification_method', 'full_read');
  v_pct := CASE WHEN v_vm = 'sample_read' THEN nullif(_rules->>'verification_sample_pct', '')::integer END;
  INSERT INTO public.policy_versions(org_id, policy_id, version, allowed_manufacturers, allowed_interfaces, allowed_methods,
    verification_method, verification_sample_pct, require_evidence, reviewer_roles, require_separate_reviewer,
    on_execution_failure, on_verification_failure, authorization_ttl_minutes, change_note, created_by)
  VALUES (_org, _policy, _version, v_mfrs, v_ifaces, v_methods, v_vm, v_pct,
    coalesce((_rules->>'require_evidence')::boolean, true), v_roles,
    coalesce((_rules->>'require_separate_reviewer')::boolean, true),
    coalesce((_rules->>'on_execution_failure')::public.failure_action, 'quarantine'),
    coalesce((_rules->>'on_verification_failure')::public.failure_action, 'quarantine'),
    coalesce((_rules->>'authorization_ttl_minutes')::integer, 30),
    nullif(trim(_note), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Expire unused authorizations and mark jobs with lost heartbeats as interrupted (never as success).
CREATE OR REPLACE FUNCTION public._sweep_jobs(_org uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT a.id AS auth_id, j.id AS job_id, j.org_id FROM public.job_authorizations a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.org_id = _org AND a.consumed_at IS NULL AND a.revoked_at IS NULL AND a.expires_at < now() AND j.status = 'queued'
    FOR UPDATE OF j
  LOOP
    UPDATE public.job_authorizations SET revoked_at = now(), revoke_reason = 'expired' WHERE id = r.auth_id;
    UPDATE public.jobs SET status = 'awaiting_authorization', agent_id = NULL, current_phase = NULL,
      exception_code = 'authorization_expired',
      exception_detail = 'The authorization expired before the agent started. A technician must confirm the target again.'
      WHERE id = r.job_id;
    PERFORM public._log_job_event(r.org_id, r.job_id, 'system', 'authorization_expired', 'queued', 'awaiting_authorization',
      'Authorization expired unused', '{}'::jsonb, NULL, NULL);
    n := n + 1;
  END LOOP;
  FOR r IN
    SELECT j.id AS job_id, j.org_id, j.status FROM public.jobs j
    JOIN public.agents ag ON ag.id = j.agent_id
    WHERE j.org_id = _org AND j.status IN ('running','verifying')
      AND greatest(coalesce(ag.last_heartbeat_at, '-infinity'::timestamptz), coalesce(j.last_event_at, '-infinity'::timestamptz)) < now() - interval '3 minutes'
    FOR UPDATE OF j
  LOOP
    UPDATE public.jobs SET status = 'interrupted', current_phase = 'Interrupted: outcome unknown',
      exception_code = 'heartbeat_lost',
      exception_detail = 'No heartbeat or event from the agent for more than 3 minutes. The outcome is unknown and is never treated as success.'
      WHERE id = r.job_id;
    PERFORM public._log_job_event(r.org_id, r.job_id, 'system', 'heartbeat_lost', r.status, 'interrupted',
      'Agent heartbeat lost; job marked interrupted', '{}'::jsonb, NULL, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public._revoke_agent(_agent uuid, _reason text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agent public.agents; r record;
BEGIN
  SELECT * INTO v_agent FROM public.agents WHERE id = _agent FOR UPDATE;
  IF v_agent.status = 'revoked' THEN RETURN; END IF;
  UPDATE public.agents SET status = 'revoked', revoked_at = now(), revoked_by = _actor, revoke_reason = nullif(trim(_reason), '') WHERE id = _agent;
  UPDATE public.agent_credentials SET revoked_at = now() WHERE agent_id = _agent AND revoked_at IS NULL;
  FOR r IN SELECT id, org_id, status FROM public.jobs WHERE agent_id = _agent AND status IN ('queued','running','verifying') FOR UPDATE LOOP
    IF r.status = 'queued' THEN
      UPDATE public.job_authorizations SET revoked_at = now(), revoke_reason = 'agent_revoked'
        WHERE job_id = r.id AND consumed_at IS NULL AND revoked_at IS NULL;
      UPDATE public.jobs SET status = 'awaiting_authorization', agent_id = NULL, current_phase = NULL,
        exception_code = 'agent_revoked', exception_detail = 'The assigned agent was revoked before starting. Authorize again with another agent.'
        WHERE id = r.id;
      PERFORM public._log_job_event(r.org_id, r.id, 'system', 'agent_revoked', 'queued', 'awaiting_authorization', 'Agent revoked; authorization withdrawn', '{}'::jsonb, _actor, _agent);
    ELSE
      UPDATE public.jobs SET status = 'interrupted', current_phase = 'Interrupted: agent revoked',
        exception_code = 'agent_revoked', exception_detail = 'The agent was revoked while the job was active. The outcome is unknown.'
        WHERE id = r.id;
      PERFORM public._log_job_event(r.org_id, r.id, 'system', 'agent_revoked', r.status, 'interrupted', 'Agent revoked during job', '{}'::jsonb, _actor, _agent);
    END IF;
  END LOOP;
END $$;

-- ===== App-user RPCs =====
CREATE OR REPLACE FUNCTION public.create_policy(_org uuid, _name text, _description text, _rules jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_policy uuid;
BEGIN
  IF NOT public.has_org_role(_org, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only owners and administrators can manage policies' USING ERRCODE = 'ND403';
  END IF;
  INSERT INTO public.policies(org_id, name, description, created_by)
    VALUES (_org, trim(_name), nullif(trim(_description), ''), auth.uid()) RETURNING id INTO v_policy;
  PERFORM public._insert_policy_version(_org, v_policy, 1, _rules, 'Initial version');
  RETURN v_policy;
END $$;

CREATE OR REPLACE FUNCTION public.create_policy_version(_policy uuid, _rules jsonb, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p public.policies; v_next integer;
BEGIN
  SELECT * INTO v_p FROM public.policies WHERE id = _policy FOR UPDATE;
  IF NOT FOUND OR NOT public.has_org_role(v_p.org_id, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only owners and administrators can manage policies' USING ERRCODE = 'ND403';
  END IF;
  IF v_p.is_archived THEN RAISE EXCEPTION 'Restore the policy before creating a new version' USING ERRCODE = 'ND422'; END IF;
  IF v_p.is_simulator THEN RAISE EXCEPTION 'The simulator policy is managed by the simulator' USING ERRCODE = 'ND422'; END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.policy_versions WHERE policy_id = _policy;
  UPDATE public.policies SET updated_at = now() WHERE id = _policy;
  RETURN public._insert_policy_version(v_p.org_id, _policy, v_next, _rules, _note);
END $$;

CREATE OR REPLACE FUNCTION public.set_policy_archived(_policy uuid, _archived boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.policies WHERE id = _policy;
  IF v_org IS NULL OR NOT public.has_org_role(v_org, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only owners and administrators can manage policies' USING ERRCODE = 'ND403';
  END IF;
  UPDATE public.policies SET is_archived = _archived WHERE id = _policy;
END $$;

CREATE OR REPLACE FUNCTION public.create_job(_device uuid, _drive uuid, _policy uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_d public.devices; v_dr public.drives; v_a public.device_drive_associations; v_p public.policies;
  v_pv public.policy_versions; v_job uuid; v_reason text;
BEGIN
  SELECT * INTO v_d FROM public.devices WHERE id = _device;
  IF NOT FOUND OR NOT public.has_org_role(v_d.org_id, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only technicians, administrators and owners can create jobs' USING ERRCODE = 'ND403';
  END IF;
  SELECT * INTO v_a FROM public.device_drive_associations
    WHERE org_id = v_d.org_id AND device_id = v_d.id AND drive_id = _drive AND detached_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This drive is not currently attached to the laptop' USING ERRCODE = 'ND422'; END IF;
  SELECT * INTO v_dr FROM public.drives WHERE id = _drive AND org_id = v_d.org_id;
  SELECT * INTO v_p FROM public.policies WHERE id = _policy AND org_id = v_d.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Policy not found' USING ERRCODE = 'ND404'; END IF;
  IF v_p.is_archived THEN RAISE EXCEPTION 'This policy is archived' USING ERRCODE = 'ND422'; END IF;
  IF v_p.is_simulator AND NOT v_d.is_simulated THEN
    RAISE EXCEPTION 'The simulator policy can only be used for simulated devices' USING ERRCODE = 'ND422';
  END IF;
  IF EXISTS (SELECT 1 FROM public.jobs WHERE drive_id = _drive AND NOT public.job_is_terminal(status)) THEN
    RAISE EXCEPTION 'This drive already has an open job' USING ERRCODE = 'ND409';
  END IF;
  SELECT * INTO v_pv FROM public.policy_versions WHERE policy_id = v_p.id ORDER BY version DESC LIMIT 1;
  INSERT INTO public.jobs(org_id, device_id, drive_id, association_id, policy_version_id, is_simulated,
    target_asset_tag, target_system_serial, target_drive_serial, target_drive_model, target_drive_interface,
    target_drive_capacity_bytes, created_by)
  VALUES (v_d.org_id, v_d.id, v_dr.id, v_a.id, v_pv.id, v_d.is_simulated,
    v_d.asset_tag, nullif(trim(v_d.system_serial), ''), v_dr.serial, v_dr.model, v_dr.interface,
    v_dr.capacity_bytes, auth.uid())
  RETURNING id INTO v_job;
  PERFORM public._log_job_event(v_d.org_id, v_job, 'user', 'created', NULL, 'draft',
    format('Job created under policy "%s" version %s', v_p.name, v_pv.version),
    jsonb_build_object('policy_version_id', v_pv.id), auth.uid(), NULL);
  v_reason := public._policy_support_reason(v_pv, v_d.manufacturer, v_dr.interface);
  IF v_reason IS NOT NULL THEN
    UPDATE public.jobs SET status = 'unsupported', execution_outcome = 'not_run', verification_outcome = 'not_run',
      exception_code = 'policy_unsupported_hardware', exception_detail = v_reason, current_phase = 'Unsupported', finished_at = now()
      WHERE id = v_job;
    PERFORM public._log_job_event(v_d.org_id, v_job, 'system', 'unsupported', 'draft', 'unsupported', v_reason, '{}'::jsonb, NULL, NULL);
    PERFORM public._sync_device_after_job(v_job);
  END IF;
  RETURN v_job;
END $$;

CREATE OR REPLACE FUNCTION public.submit_job(_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.jobs;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR NOT public.has_org_role(v_job.org_id, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only technicians, administrators and owners can submit jobs' USING ERRCODE = 'ND403';
  END IF;
  IF v_job.status <> 'draft' THEN RAISE EXCEPTION 'Only draft jobs can be submitted (job is %)', v_job.status USING ERRCODE = 'ND409'; END IF;
  UPDATE public.jobs SET status = 'awaiting_authorization', current_phase = 'Awaiting technician authorization' WHERE id = _job;
  PERFORM public._log_job_event(v_job.org_id, _job, 'user', 'submitted', 'draft', 'awaiting_authorization', 'Submitted for authorization', '{}'::jsonb, auth.uid(), NULL);
END $$;

CREATE OR REPLACE FUNCTION public.authorize_job(_job uuid, _agent uuid, _confirm_asset_tag text, _confirm_drive_serial text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.jobs; v_ag public.agents; v_pv public.policy_versions; v_auth uuid;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR NOT public.is_org_staff(v_job.org_id) THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'ND404'; END IF;
  IF NOT public.has_org_role(v_job.org_id, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only technicians, administrators and owners can authorize jobs' USING ERRCODE = 'ND403';
  END IF;
  IF v_job.status <> 'awaiting_authorization' THEN
    RAISE EXCEPTION 'Only jobs awaiting authorization can be authorized (job is %)', v_job.status USING ERRCODE = 'ND409';
  END IF;
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent AND org_id = v_job.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent not found' USING ERRCODE = 'ND404'; END IF;
  IF v_ag.status <> 'active' THEN RAISE EXCEPTION 'This agent has been revoked' USING ERRCODE = 'ND409'; END IF;
  IF v_ag.is_simulated <> v_job.is_simulated THEN
    RAISE EXCEPTION '%', CASE WHEN v_job.is_simulated THEN 'Simulated jobs can only be assigned to a simulator agent'
      ELSE 'A simulator agent cannot be assigned a real job' END USING ERRCODE = 'ND422';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.device_drive_associations WHERE id = v_job.association_id AND detached_at IS NULL) THEN
    RAISE EXCEPTION 'The drive is no longer attached to this laptop. Cancel this job and create a new one.' USING ERRCODE = 'ND409';
  END IF;
  IF (SELECT serial FROM public.drives WHERE id = v_job.drive_id) IS DISTINCT FROM v_job.target_drive_serial THEN
    RAISE EXCEPTION 'The drive record changed since the job was created. Cancel this job and create a new one.' USING ERRCODE = 'ND409';
  END IF;
  IF upper(trim(coalesce(_confirm_asset_tag, ''))) <> upper(v_job.target_asset_tag)
     OR upper(trim(coalesce(_confirm_drive_serial, ''))) <> upper(v_job.target_drive_serial) THEN
    RAISE EXCEPTION 'Confirmation does not match the job target. Read the asset tag and drive serial from the physical laptop and drive.' USING ERRCODE = 'ND422';
  END IF;
  SELECT * INTO v_pv FROM public.policy_versions WHERE id = v_job.policy_version_id;
  INSERT INTO public.job_authorizations(org_id, job_id, agent_id, device_id, drive_id, association_id, policy_version_id,
    confirmed_asset_tag, confirmed_drive_serial, authorized_by, expires_at)
  VALUES (v_job.org_id, v_job.id, v_ag.id, v_job.device_id, v_job.drive_id, v_job.association_id, v_job.policy_version_id,
    upper(trim(_confirm_asset_tag)), upper(trim(_confirm_drive_serial)), auth.uid(),
    now() + make_interval(mins => v_pv.authorization_ttl_minutes))
  RETURNING id INTO v_auth;
  UPDATE public.jobs SET status = 'queued', agent_id = v_ag.id, current_phase = 'Waiting for agent',
    exception_code = NULL, exception_detail = NULL WHERE id = v_job.id;
  PERFORM public._log_job_event(v_job.org_id, v_job.id, 'user', 'authorized', 'awaiting_authorization', 'queued',
    format('Target confirmed and authorized for agent "%s" (expires in %s min)', v_ag.name, v_pv.authorization_ttl_minutes),
    jsonb_build_object('authorization_id', v_auth, 'agent_id', v_ag.id), auth.uid(), v_ag.id);
  RETURN v_auth;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_job(_job uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.jobs;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR NOT public.has_org_role(v_job.org_id, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only technicians, administrators and owners can cancel jobs' USING ERRCODE = 'ND403';
  END IF;
  IF v_job.status NOT IN ('draft','awaiting_authorization','queued') THEN
    RAISE EXCEPTION 'Jobs can only be cancelled before execution starts (job is %)', v_job.status USING ERRCODE = 'ND409';
  END IF;
  UPDATE public.job_authorizations SET revoked_at = now(), revoke_reason = 'job_cancelled'
    WHERE job_id = _job AND consumed_at IS NULL AND revoked_at IS NULL;
  UPDATE public.jobs SET status = 'cancelled', execution_outcome = 'not_run', verification_outcome = 'not_run',
    current_phase = 'Cancelled', exception_code = 'cancelled', exception_detail = nullif(trim(_reason), ''), finished_at = now()
    WHERE id = _job;
  PERFORM public._log_job_event(v_job.org_id, _job, 'user', 'cancelled', v_job.status, 'cancelled', coalesce(nullif(trim(_reason), ''), 'Cancelled'), '{}'::jsonb, auth.uid(), NULL);
END $$;

CREATE OR REPLACE FUNCTION public.review_job(_job uuid, _approve boolean, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.jobs; v_pv public.policy_versions;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR NOT public.is_org_staff(v_job.org_id) THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'ND404'; END IF;
  IF v_job.status <> 'awaiting_validation' THEN
    RAISE EXCEPTION 'Only jobs awaiting validation can be reviewed (job is %)', v_job.status USING ERRCODE = 'ND409';
  END IF;
  SELECT * INTO v_pv FROM public.policy_versions WHERE id = v_job.policy_version_id;
  IF NOT public.has_org_role(v_job.org_id, v_pv.reviewer_roles) THEN
    RAISE EXCEPTION 'Your role cannot review jobs under this policy version' USING ERRCODE = 'ND403';
  END IF;
  IF v_pv.require_separate_reviewer AND EXISTS (
      SELECT 1 FROM public.job_authorizations WHERE job_id = _job AND consumed_at IS NOT NULL AND authorized_by = auth.uid()) THEN
    RAISE EXCEPTION 'This policy requires a reviewer other than the technician who authorized the job' USING ERRCODE = 'ND403';
  END IF;
  IF NOT _approve AND coalesce(trim(_notes), '') = '' THEN
    RAISE EXCEPTION 'A rejection needs a reason' USING ERRCODE = 'ND422';
  END IF;
  IF _approve THEN
    IF v_pv.require_evidence AND NOT EXISTS (SELECT 1 FROM public.evidence_objects WHERE job_id = _job) THEN
      RAISE EXCEPTION 'This policy requires evidence; none is attached' USING ERRCODE = 'ND422';
    END IF;
    UPDATE public.jobs SET review_decision = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      review_notes = nullif(trim(_notes), ''), status = 'approved', current_phase = 'Approved', finished_at = now()
      WHERE id = _job;
  ELSE
    UPDATE public.jobs SET review_decision = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      review_notes = trim(_notes), status = 'quarantined', current_phase = 'Rejected by reviewer',
      exception_code = 'reviewer_rejected', exception_detail = trim(_notes), finished_at = now()
      WHERE id = _job;
  END IF;
  PERFORM public._log_job_event(v_job.org_id, _job, 'user', CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    'awaiting_validation', CASE WHEN _approve THEN 'approved'::public.job_status ELSE 'quarantined'::public.job_status END,
    coalesce(nullif(trim(_notes), ''), CASE WHEN _approve THEN 'Approved by reviewer' ELSE 'Rejected by reviewer' END), '{}'::jsonb, auth.uid(), NULL);
  PERFORM public._sync_device_after_job(_job);
END $$;

CREATE OR REPLACE FUNCTION public.create_enrollment_token(_org uuid, _label text, _site uuid, _ttl_hours integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_token text;
BEGIN
  IF NOT public.has_org_role(_org, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only owners and administrators can enroll agents' USING ERRCODE = 'ND403';
  END IF;
  IF _ttl_hours IS NULL OR _ttl_hours < 1 OR _ttl_hours > 168 THEN
    RAISE EXCEPTION 'Token lifetime must be between 1 and 168 hours' USING ERRCODE = 'ND422';
  END IF;
  v_token := 'ndenr_' || encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.enrollment_tokens(org_id, site_id, label, token_hash, is_simulated, created_by, expires_at)
  VALUES (_org, _site, trim(_label), encode(extensions.digest(v_token, 'sha256'), 'hex'), false, auth.uid(), now() + make_interval(hours => _ttl_hours));
  RETURN v_token;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_enrollment_token(_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.enrollment_tokens WHERE id = _token;
  IF v_org IS NULL OR NOT public.has_org_role(v_org, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'ND403';
  END IF;
  UPDATE public.enrollment_tokens SET revoked_at = now() WHERE id = _token AND used_at IS NULL AND revoked_at IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_agent(_agent uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ag public.agents;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent;
  IF NOT FOUND OR NOT (
      public.has_org_role(v_ag.org_id, ARRAY['owner','admin']::public.org_role[])
      OR (v_ag.is_simulated AND public.has_org_role(v_ag.org_id, ARRAY['technician']::public.org_role[]))) THEN
    RAISE EXCEPTION 'Only owners and administrators can revoke agents' USING ERRCODE = 'ND403';
  END IF;
  PERFORM public._revoke_agent(_agent, _reason, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.sweep_jobs(_org uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_org_staff(_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'ND403'; END IF;
  RETURN public._sweep_jobs(_org);
END $$;

-- Creates clearly labelled simulated inventory + a simulated enrollment token for one simulator run.
CREATE OR REPLACE FUNCTION public.simulator_prepare(_org uuid, _scenario text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_suffix text; v_policy uuid; v_device uuid; v_drive uuid; v_drives jsonb := '[]'::jsonb; v_token text;
  v_count integer; i integer; v_iface public.drive_interface; v_serial text;
BEGIN
  IF NOT public.has_org_role(_org, ARRAY['owner','admin','technician']::public.org_role[]) THEN
    RAISE EXCEPTION 'Only technicians, administrators and owners can run the simulator' USING ERRCODE = 'ND403';
  END IF;
  IF _scenario NOT IN ('success','unsupported_drive','execution_failure','verification_failure','network_interruption',
                       'duplicate_events','revoked_credentials','identity_mismatch','multi_drive_mixed') THEN
    RAISE EXCEPTION 'Unknown simulator scenario' USING ERRCODE = 'ND422';
  END IF;
  PERFORM set_config('nextdrive.simulator', 'on', true);
  v_suffix := upper(encode(extensions.gen_random_bytes(3), 'hex'));

  SELECT id INTO v_policy FROM public.policies WHERE org_id = _org AND is_simulator AND NOT is_archived ORDER BY created_at LIMIT 1;
  IF v_policy IS NULL THEN
    INSERT INTO public.policies(org_id, name, description, is_simulator, created_by)
    VALUES (_org, 'Simulator test policy', 'SIMULATED. Used only by the NextDrive agent simulator; cannot be applied to real devices.', true, auth.uid())
    RETURNING id INTO v_policy;
    PERFORM public._insert_policy_version(_org, v_policy, 1, jsonb_build_object(
      'allowed_manufacturers', jsonb_build_array('Dell','HP','Lenovo'),
      'allowed_interfaces', jsonb_build_array('nvme_ssd','sata_ssd','sata_hdd'),
      'allowed_methods', jsonb_build_array('nvme_sanitize_crypto','nvme_sanitize_block','ata_sanitize_crypto','ata_sanitize_block','ata_enhanced_secure_erase','overwrite_single_pass'),
      'verification_method', 'full_read', 'require_evidence', true,
      'reviewer_roles', jsonb_build_array('owner','admin','technician'), 'require_separate_reviewer', false,
      'on_execution_failure', 'quarantine', 'on_verification_failure', 'quarantine', 'authorization_ttl_minutes', 30),
      'Simulator baseline');
  END IF;

  INSERT INTO public.devices(org_id, asset_tag, manufacturer, model, system_serial, cpu, ram_gb, intake_condition, notes, is_simulated)
  VALUES (_org, 'SIM-' || v_suffix, 'Dell', 'SIMULATED Latitude 5420', 'SIMSYS' || v_suffix, 'Simulated CPU', 16, 'good',
    'SIMULATED DEVICE created by the NextDrive agent simulator (scenario: ' || _scenario || '). No real hardware exists and no erasure was performed.', true)
  RETURNING id INTO v_device;

  v_count := CASE WHEN _scenario = 'multi_drive_mixed' THEN 2 ELSE 1 END;
  FOR i IN 1..v_count LOOP
    v_iface := CASE WHEN i = 2 OR _scenario = 'unsupported_drive' THEN 'sata_ssd'::public.drive_interface ELSE 'nvme_ssd'::public.drive_interface END;
    v_serial := 'SIMDRV' || v_suffix || i;
    INSERT INTO public.drives(org_id, serial, manufacturer, model, interface, capacity_bytes, firmware_version, notes, is_simulated)
    VALUES (_org, v_serial, 'Simulated', CASE WHEN v_iface = 'nvme_ssd' THEN 'SIMULATED NVMe SSD 512GB' ELSE 'SIMULATED SATA SSD 256GB' END,
      v_iface, CASE WHEN v_iface = 'nvme_ssd' THEN 512110190592 ELSE 256060514304 END, 'SIM-FW1', 'SIMULATED DRIVE', true)
    RETURNING id INTO v_drive;
    INSERT INTO public.device_drive_associations(org_id, device_id, drive_id, slot) VALUES (_org, v_device, v_drive, 'Simulated slot ' || i);
    v_drives := v_drives || jsonb_build_array(jsonb_build_object('drive_id', v_drive, 'serial', v_serial, 'interface', v_iface));
  END LOOP;

  v_token := 'ndenr_' || encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.enrollment_tokens(org_id, label, token_hash, is_simulated, created_by, expires_at)
  VALUES (_org, 'SIMULATED · ' || _scenario, encode(extensions.digest(v_token, 'sha256'), 'hex'), true, auth.uid(), now() + interval '1 hour');

  RETURN jsonb_build_object('device_id', v_device, 'asset_tag', 'SIM-' || v_suffix, 'system_serial', 'SIMSYS' || v_suffix,
    'drives', v_drives, 'policy_id', v_policy, 'enrollment_token', v_token);
END $$;

-- ===== Agent RPCs (service role only; the HTTP layer authenticates every request first) =====
CREATE OR REPLACE FUNCTION public.agent_enroll(_token text, _name text, _version text, _platform text, _hostname text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_t public.enrollment_tokens; v_cred text; v_agent uuid; v_name text;
BEGIN
  SELECT * INTO v_t FROM public.enrollment_tokens WHERE token_hash = encode(extensions.digest(coalesce(_token, ''), 'sha256'), 'hex') FOR UPDATE;
  IF NOT FOUND OR v_t.revoked_at IS NOT NULL OR v_t.used_at IS NOT NULL OR v_t.expires_at < now() THEN
    RAISE EXCEPTION 'Enrollment token is invalid, already used, revoked or expired' USING ERRCODE = 'ND401';
  END IF;
  v_name := left(coalesce(nullif(trim(_name), ''), 'Unnamed station'), 100);
  IF v_t.is_simulated AND v_name NOT ILIKE 'SIMULATED%' THEN v_name := 'SIMULATED · ' || v_name; END IF;
  v_cred := 'ndagt_' || encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.agents(org_id, site_id, name, is_simulated, agent_version, platform, hostname, credential_prefix, enrollment_token_id, last_heartbeat_at, last_state)
  VALUES (v_t.org_id, v_t.site_id, v_name, v_t.is_simulated, left(_version, 40), left(_platform, 80), left(_hostname, 120), left(v_cred, 14), v_t.id, now(), 'enrolled')
  RETURNING id INTO v_agent;
  INSERT INTO public.agent_credentials(org_id, agent_id, credential_hash) VALUES (v_t.org_id, v_agent, encode(extensions.digest(v_cred, 'sha256'), 'hex'));
  UPDATE public.enrollment_tokens SET used_at = now(), used_by_agent = v_agent WHERE id = v_t.id;
  RETURN jsonb_build_object('agent_id', v_agent, 'org_id', v_t.org_id, 'credential', v_cred, 'is_simulated', v_t.is_simulated, 'name', v_name);
END $$;

CREATE OR REPLACE FUNCTION public.agent_authenticate(_credential text, _nonce text, _timestamp timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_ag public.agents;
BEGIN
  IF _credential IS NULL OR _credential NOT LIKE 'ndagt\_%' THEN
    RAISE EXCEPTION 'Missing or malformed agent credential' USING ERRCODE = 'ND401';
  END IF;
  SELECT a.* INTO v_ag FROM public.agent_credentials c JOIN public.agents a ON a.id = c.agent_id
    WHERE c.credential_hash = encode(extensions.digest(_credential, 'sha256'), 'hex') AND c.revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agent credential is invalid or has been revoked' USING ERRCODE = 'ND401'; END IF;
  IF v_ag.status <> 'active' THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  IF _timestamp IS NULL OR abs(extract(epoch FROM (now() - _timestamp))) > 300 THEN
    RAISE EXCEPTION 'Request timestamp is outside the allowed 5-minute window' USING ERRCODE = 'ND401';
  END IF;
  IF _nonce IS NULL OR _nonce !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'Missing or malformed request nonce' USING ERRCODE = 'ND401';
  END IF;
  DELETE FROM public.agent_request_nonces WHERE agent_id = v_ag.id AND seen_at < now() - interval '15 minutes';
  BEGIN
    INSERT INTO public.agent_request_nonces(agent_id, nonce) VALUES (v_ag.id, _nonce);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Replayed request: this nonce was already used' USING ERRCODE = 'ND409';
  END;
  RETURN jsonb_build_object('agent_id', v_ag.id, 'org_id', v_ag.org_id, 'is_simulated', v_ag.is_simulated, 'name', v_ag.name);
END $$;

CREATE OR REPLACE FUNCTION public.agent_heartbeat(_agent uuid, _state text, _version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_queued integer;
BEGIN
  UPDATE public.agents SET last_heartbeat_at = now(), last_state = left(coalesce(_state, 'idle'), 40),
    agent_version = coalesce(left(_version, 40), agent_version)
    WHERE id = _agent AND status = 'active' RETURNING org_id INTO v_org;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Agent has been revoked' USING ERRCODE = 'ND401'; END IF;
  PERFORM public._sweep_jobs(v_org);
  SELECT count(*) INTO v_queued FROM public.jobs WHERE agent_id = _agent AND status = 'queued';
  RETURN jsonb_build_object('server_time', now(), 'queued_jobs', v_queued, 'heartbeat_timeout_seconds', 180);
END $$;

CREATE OR REPLACE FUNCTION public.agent_report_inventory(_agent uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ag public.agents; v_sys text; v_device uuid; v_tag text; r record; v_ser text; v_drive uuid; v_att boolean;
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_ag FROM public.agents WHERE id = _agent;
  v_sys := nullif(trim(_payload #>> '{system,serial}'), '');
  IF v_sys IS NOT NULL THEN
    SELECT id, asset_tag INTO v_device, v_tag FROM public.devices
      WHERE org_id = v_ag.org_id AND is_simulated = v_ag.is_simulated AND upper(system_serial) = upper(v_sys)
      ORDER BY received_at DESC LIMIT 1;
  END IF;
  INSERT INTO public.agent_discoveries(org_id, agent_id, device_id, system_serial, payload, is_simulated)
  VALUES (v_ag.org_id, v_ag.id, v_device, v_sys, _payload, v_ag.is_simulated);
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
        UPDATE public.drives SET hardware_verified = true,
          firmware_version = coalesce(nullif(left(r.x->>'firmware', 60), ''), firmware_version) WHERE id = v_drive;
      END IF;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object('serial', v_ser, 'drive_id', v_drive, 'attached_to_device', v_att));
  END LOOP;
  IF v_device IS NOT NULL AND NOT v_ag.is_simulated THEN
    UPDATE public.devices SET hardware_verified = true WHERE id = v_device;
  END IF;
  RETURN jsonb_build_object('device_id', v_device, 'asset_tag', v_tag, 'drives', v_out);
END $$;

CREATE OR REPLACE FUNCTION public.agent_list_jobs(_agent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_out jsonb;
BEGIN
  SELECT org_id INTO v_org FROM public.agents WHERE id = _agent;
  PERFORM public._sweep_jobs(v_org);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'job_id', j.id, 'job_number', j.job_number, 'status', j.status, 'is_simulated', j.is_simulated,
      'next_seq', j.last_agent_seq + 1,
      'authorization', CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', a.id, 'expires_at', a.expires_at, 'local_confirmation_required', a.local_confirmation_required) END,
      'target', jsonb_build_object('asset_tag', j.target_asset_tag, 'system_serial', j.target_system_serial,
        'drive_serial', j.target_drive_serial, 'drive_model', j.target_drive_model,
        'drive_interface', j.target_drive_interface, 'drive_capacity_bytes', j.target_drive_capacity_bytes),
      'policy', jsonb_build_object('policy_version_id', pv.id, 'version', pv.version,
        'allowed_methods', (SELECT coalesce(jsonb_agg(m), '[]'::jsonb) FROM unnest(pv.allowed_methods) m WHERE public.method_fits_interface(m, j.target_drive_interface)),
        'verification_method', pv.verification_method, 'verification_sample_pct', pv.verification_sample_pct,
        'require_evidence', pv.require_evidence),
      'local_confirmation', jsonb_build_object('serial_suffix_length', 4,
        'instruction', 'Display the asset tag and full drive serial on the local console. The operator must confirm and type the last 4 characters of the drive serial before acknowledging.')
    ) ORDER BY j.created_at), '[]'::jsonb)
  INTO v_out
  FROM public.jobs j
  JOIN public.policy_versions pv ON pv.id = j.policy_version_id
  LEFT JOIN public.job_authorizations a ON a.job_id = j.id AND a.consumed_at IS NULL AND a.revoked_at IS NULL
  WHERE j.agent_id = _agent AND j.status IN ('queued','running','verifying','interrupted');
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.agent_job_event(_agent uuid, _job uuid, _type text, _seq integer, _idem text, _payload jsonb, _occurred_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_job public.jobs; v_pv public.policy_versions; v_auth public.job_authorizations; v_ev public.job_events;
  v_hash text; v_from public.job_status; v_to public.job_status; v_msg text; v_resp jsonb := '{"ok":true}'::jsonb;
  v_lc jsonb; v_obs_drive text; v_obs_sys text; v_pct numeric; v_outcome text; v_m public.erasure_method;
  v_vm text; v_vpct integer; v_code text; v_detail text; v_eid bigint; v_payload jsonb := coalesce(_payload, '{}'::jsonb);
BEGIN
  IF _type NOT IN ('ack','progress','log','unsupported','execution_result','verification_result','interrupted','resume') THEN
    RAISE EXCEPTION 'Unknown event type %', _type USING ERRCODE = 'ND422';
  END IF;
  IF _idem IS NULL OR char_length(_idem) < 8 OR char_length(_idem) > 128 THEN
    RAISE EXCEPTION 'idempotency_key must be 8-128 characters' USING ERRCODE = 'ND422';
  END IF;
  SELECT * INTO v_job FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR v_job.agent_id IS DISTINCT FROM _agent THEN
    RAISE EXCEPTION 'Job not found for this agent' USING ERRCODE = 'ND404';
  END IF;
  v_hash := encode(extensions.digest(_type || ':' || coalesce(_seq::text, '') || ':' || v_payload::text, 'sha256'), 'hex');
  SELECT * INTO v_ev FROM public.job_events WHERE job_id = _job AND idempotency_key = _idem;
  IF FOUND THEN
    IF v_ev.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'This idempotency key was already used for a different request' USING ERRCODE = 'ND409';
    END IF;
    RETURN coalesce(v_ev.response, '{}'::jsonb) || jsonb_build_object('duplicate', true, 'event_id', v_ev.id,
      'job_status', v_job.status, 'last_seq', v_job.last_agent_seq);
  END IF;
  IF public.job_is_terminal(v_job.status) THEN
    RAISE EXCEPTION 'Job is closed (%)', v_job.status USING ERRCODE = 'ND409';
  END IF;
  IF _seq IS NULL OR _seq <> v_job.last_agent_seq + 1 THEN
    RAISE EXCEPTION 'Sequence conflict: expected seq %, received %', v_job.last_agent_seq + 1, coalesce(_seq::text, 'none')
      USING ERRCODE = 'ND409', HINT = 'expected_seq=' || (v_job.last_agent_seq + 1);
  END IF;
  SELECT * INTO v_pv FROM public.policy_versions WHERE id = v_job.policy_version_id;
  v_from := v_job.status; v_to := v_job.status;
  UPDATE public.jobs SET last_agent_seq = _seq, last_event_at = now() WHERE id = _job;

  IF _type = 'ack' THEN
    IF v_job.status <> 'queued' THEN
      RAISE EXCEPTION 'Acknowledgement is only valid for queued jobs (job is %)', v_job.status USING ERRCODE = 'ND409';
    END IF;
    SELECT * INTO v_auth FROM public.job_authorizations WHERE id = nullif(v_payload->>'authorization_id', '')::uuid AND job_id = _job;
    IF NOT FOUND THEN RAISE EXCEPTION 'Authorization not found for this job' USING ERRCODE = 'ND404'; END IF;
    IF v_auth.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'Authorization has already been used' USING ERRCODE = 'ND409'; END IF;
    IF v_auth.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Authorization was revoked (%)', coalesce(v_auth.revoke_reason, 'revoked') USING ERRCODE = 'ND409'; END IF;
    IF v_auth.agent_id <> _agent THEN RAISE EXCEPTION 'Authorization is bound to a different agent' USING ERRCODE = 'ND403'; END IF;
    IF v_auth.expires_at < now() THEN
      UPDATE public.job_authorizations SET revoked_at = now(), revoke_reason = 'expired' WHERE id = v_auth.id;
      v_to := 'awaiting_authorization';
      UPDATE public.jobs SET status = v_to, agent_id = NULL, current_phase = NULL, exception_code = 'authorization_expired',
        exception_detail = 'The authorization expired before the agent started. A technician must authorize again.' WHERE id = _job;
      v_msg := 'Authorization expired before acknowledgement';
      v_resp := jsonb_build_object('ok', false, 'proceed', false, 'error', 'authorization_expired', 'http_status', 410);
    ELSE
      v_lc := v_payload->'local_confirmation';
      IF v_auth.local_confirmation_required AND (
           coalesce((v_lc->>'confirmed')::boolean, false) = false
           OR upper(coalesce(v_lc->>'typed_serial_suffix', '')) <> upper(right(v_job.target_drive_serial, 4))) THEN
        RAISE EXCEPTION 'Local operator confirmation is required: confirm on the station and type the last 4 characters of the drive serial'
          USING ERRCODE = 'ND422';
      END IF;
      v_obs_drive := upper(nullif(trim(v_payload #>> '{observed,drive_serial}'), ''));
      v_obs_sys := upper(nullif(trim(v_payload #>> '{observed,system_serial}'), ''));
      IF v_obs_drive IS DISTINCT FROM upper(v_job.target_drive_serial)
         OR (v_job.target_system_serial IS NOT NULL AND v_obs_sys IS DISTINCT FROM upper(v_job.target_system_serial))
         OR NOT EXISTS (SELECT 1 FROM public.device_drive_associations WHERE id = v_job.association_id AND detached_at IS NULL) THEN
        UPDATE public.job_authorizations SET revoked_at = now(), revoke_reason = 'drive_identity_mismatch' WHERE id = v_auth.id;
        v_to := 'quarantined';
        v_detail := format('Agent observed drive %s on system %s; the authorization was for drive %s on system %s. Execution was blocked.',
          coalesce(v_obs_drive, '(none)'), coalesce(v_obs_sys, '(none)'), v_job.target_drive_serial, coalesce(v_job.target_system_serial, '(none)'));
        UPDATE public.jobs SET status = 'quarantined', execution_outcome = 'not_run', verification_outcome = 'not_run',
          exception_code = 'drive_identity_mismatch', exception_detail = v_detail, current_phase = 'Blocked: drive identity mismatch',
          finished_at = now() WHERE id = _job;
        v_msg := 'Drive identity mismatch; execution blocked';
        v_resp := jsonb_build_object('ok', false, 'proceed', false, 'error', 'drive_identity_mismatch', 'http_status', 409, 'message', v_detail);
      ELSE
        UPDATE public.job_authorizations SET consumed_at = now(), local_confirmation = v_lc WHERE id = v_auth.id;
        v_to := 'running';
        UPDATE public.jobs SET status = 'running', started_at = now(), current_phase = 'Starting', progress_pct = NULL,
          progress_measured = false WHERE id = _job;
        v_msg := 'Agent confirmed target locally; authorization consumed; execution may start';
        v_resp := jsonb_build_object('ok', true, 'proceed', true,
          'allowed_methods', (SELECT coalesce(jsonb_agg(m), '[]'::jsonb) FROM unnest(v_pv.allowed_methods) m WHERE public.method_fits_interface(m, v_job.target_drive_interface)));
      END IF;
    END IF;

  ELSIF _type = 'progress' THEN
    IF v_job.status NOT IN ('running','verifying') THEN
      RAISE EXCEPTION 'Progress is only accepted while running or verifying (job is %)', v_job.status USING ERRCODE = 'ND409';
    END IF;
    v_pct := CASE WHEN coalesce((v_payload->>'measured')::boolean, false) THEN (v_payload->>'progress_pct')::numeric END;
    IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN RAISE EXCEPTION 'progress_pct must be 0-100' USING ERRCODE = 'ND422'; END IF;
    UPDATE public.jobs SET current_phase = coalesce(left(nullif(v_payload->>'phase', ''), 120), current_phase),
      progress_pct = v_pct, progress_measured = (v_pct IS NOT NULL) WHERE id = _job;
    v_msg := coalesce(left(v_payload->>'message', 500), v_payload->>'phase', 'Progress');

  ELSIF _type = 'log' THEN
    v_msg := coalesce(left(v_payload->>'message', 500), 'Log entry');

  ELSIF _type = 'unsupported' THEN
    IF v_job.status NOT IN ('queued','running') THEN
      RAISE EXCEPTION 'Unsupported can only be reported before or during execution (job is %)', v_job.status USING ERRCODE = 'ND409';
    END IF;
    IF v_job.status = 'running' AND v_job.execution_outcome <> 'pending' THEN
      RAISE EXCEPTION 'Execution already has an outcome' USING ERRCODE = 'ND409';
    END IF;
    UPDATE public.job_authorizations SET revoked_at = now(), revoke_reason = 'unsupported'
      WHERE job_id = _job AND consumed_at IS NULL AND revoked_at IS NULL;
    v_to := 'unsupported';
    v_detail := left(coalesce(nullif(v_payload->>'reason', ''), 'The agent reported that no permitted method is available for this drive.'), 1000);
    UPDATE public.jobs SET status = 'unsupported', execution_outcome = 'not_run', verification_outcome = 'not_run',
      exception_code = 'drive_capability_unsupported', exception_detail = v_detail, current_phase = 'Unsupported', finished_at = now()
      WHERE id = _job;
    v_msg := v_detail;

  ELSIF _type = 'execution_result' THEN
    IF NOT (v_job.status = 'running' OR (v_job.status = 'interrupted' AND v_job.execution_outcome = 'pending')) THEN
      RAISE EXCEPTION 'Execution result is not valid now (job is %)', v_job.status USING ERRCODE = 'ND409';
    END IF;
    v_outcome := v_payload->>'outcome';
    IF v_outcome IS NULL OR v_outcome NOT IN ('succeeded','failed') THEN
      RAISE EXCEPTION 'outcome must be succeeded or failed' USING ERRCODE = 'ND422';
    END IF;
    v_m := nullif(v_payload->>'method', '')::public.erasure_method;
    IF v_outcome = 'succeeded' AND (v_m IS NULL OR NOT (v_m = ANY (v_pv.allowed_methods)) OR NOT public.method_fits_interface(v_m, v_job.target_drive_interface)) THEN
      v_to := 'quarantined';
      v_detail := format('Agent reported method %s, which policy version %s does not permit for %s drives.', coalesce(v_m::text, '(none)'), v_pv.version, v_job.target_drive_interface);
      UPDATE public.jobs SET status = 'quarantined', method = v_m, execution_outcome = 'failed', verification_outcome = 'not_run',
        execution_detail = v_payload->'detail', exception_code = 'method_not_permitted', exception_detail = v_detail,
        current_phase = 'Blocked: method not permitted', execution_finished_at = now(), finished_at = now() WHERE id = _job;
      v_msg := v_detail;
    ELSIF v_outcome = 'succeeded' THEN
      v_to := 'verifying';
      UPDATE public.jobs SET status = 'verifying', method = v_m, execution_outcome = 'succeeded', execution_detail = v_payload->'detail',
        execution_finished_at = now(), current_phase = 'Verifying', progress_pct = NULL, progress_measured = false,
        exception_code = NULL, exception_detail = NULL WHERE id = _job;
      v_msg := format('Execution reported successful using %s', v_m);
    ELSE
      v_to := CASE WHEN v_pv.on_execution_failure = 'quarantine' THEN 'quarantined'::public.job_status ELSE 'failed'::public.job_status END;
      v_detail := left(coalesce(v_payload #>> '{detail,error}', v_payload->>'message', 'Execution failed'), 1000);
      UPDATE public.jobs SET status = v_to, method = v_m, execution_outcome = 'failed', verification_outcome = 'not_run',
        execution_detail = v_payload->'detail', exception_code = 'execution_failed', exception_detail = v_detail,
        current_phase = 'Execution failed', execution_finished_at = now(), finished_at = now() WHERE id = _job;
      v_msg := 'Execution failed: ' || v_detail;
    END IF;

  ELSIF _type = 'verification_result' THEN
    IF NOT (v_job.status = 'verifying' OR (v_job.status = 'interrupted' AND v_job.execution_outcome = 'succeeded')) THEN
      RAISE EXCEPTION 'Verification result is not valid now (job is %)', v_job.status USING ERRCODE = 'ND409';
    END IF;
    v_outcome := v_payload->>'outcome';
    IF v_outcome IS NULL OR v_outcome NOT IN ('passed','failed') THEN
      RAISE EXCEPTION 'outcome must be passed or failed' USING ERRCODE = 'ND422';
    END IF;
    v_vm := v_payload->>'method';
    v_vpct := nullif(v_payload->>'sample_pct', '')::integer;
    v_code := NULL;
    IF v_outcome = 'passed' AND NOT (
         v_vm = 'full_read'
         OR (v_pv.verification_method = 'sample_read' AND v_vm = 'sample_read' AND coalesce(v_vpct, 0) >= v_pv.verification_sample_pct)) THEN
      v_outcome := 'failed';
      v_code := 'verification_insufficient';
      v_detail := format('Policy version %s requires %s verification%s; the agent reported %s%s.', v_pv.version, v_pv.verification_method,
        CASE WHEN v_pv.verification_method = 'sample_read' THEN ' of at least ' || v_pv.verification_sample_pct || '%' ELSE '' END,
        coalesce(v_vm, 'no method'), CASE WHEN v_vpct IS NOT NULL THEN ' (' || v_vpct || '%)' ELSE '' END);
    END IF;
    IF v_outcome = 'passed' AND v_pv.require_evidence AND NOT EXISTS (SELECT 1 FROM public.evidence_objects WHERE job_id = _job) THEN
      RAISE EXCEPTION 'This policy requires evidence before verification can pass; upload evidence first' USING ERRCODE = 'ND422';
    END IF;
    IF v_outcome = 'passed' THEN
      v_to := 'awaiting_validation';
      UPDATE public.jobs SET status = 'awaiting_validation', verification_outcome = 'passed', verification_detail = v_payload,
        verification_finished_at = now(), current_phase = 'Awaiting reviewer approval', progress_pct = NULL, progress_measured = false,
        exception_code = NULL, exception_detail = NULL WHERE id = _job;
      v_msg := 'Verification reported passed; awaiting reviewer approval (not approved automatically)';
    ELSE
      v_to := CASE WHEN v_pv.on_verification_failure = 'quarantine' THEN 'quarantined'::public.job_status ELSE 'failed'::public.job_status END;
      v_detail := coalesce(v_detail, left(coalesce(v_payload #>> '{detail,error}', v_payload->>'message', 'Verification failed'), 1000));
      UPDATE public.jobs SET status = v_to, verification_outcome = 'failed', verification_detail = v_payload,
        exception_code = coalesce(v_code, 'verification_failed'), exception_detail = v_detail,
        current_phase = 'Verification failed', verification_finished_at = now(), finished_at = now() WHERE id = _job;
      v_msg := 'Verification failed: ' || v_detail;
    END IF;

  ELSIF _type = 'interrupted' THEN
    IF v_job.status NOT IN ('running','verifying') THEN
      RAISE EXCEPTION 'Interruption is only valid while running or verifying (job is %)', v_job.status USING ERRCODE = 'ND409';
    END IF;
    v_to := 'interrupted';
    v_detail := left(coalesce(nullif(v_payload->>'reason', ''), 'The agent reported an interruption.'), 1000);
    UPDATE public.jobs SET status = 'interrupted', current_phase = 'Interrupted: outcome unknown',
      exception_code = 'agent_reported_interruption', exception_detail = v_detail WHERE id = _job;
    v_msg := v_detail;

  ELSIF _type = 'resume' THEN
    IF v_job.status <> 'interrupted' THEN
      RAISE EXCEPTION 'Resume is only valid for interrupted jobs (job is %)', v_job.status USING ERRCODE = 'ND409';
    END IF;
    v_to := CASE WHEN v_job.execution_outcome = 'succeeded' THEN 'verifying'::public.job_status ELSE 'running'::public.job_status END;
    UPDATE public.jobs SET status = v_to, current_phase = CASE WHEN v_to = 'verifying' THEN 'Verifying (resumed)' ELSE 'Running (resumed)' END,
      exception_code = NULL, exception_detail = NULL WHERE id = _job;
    v_msg := 'Agent reconnected and resumed: ' || left(coalesce(v_payload->>'reason', 'operation still in progress on the station'), 500);
  END IF;

  INSERT INTO public.job_events(org_id, job_id, source, event_type, agent_seq, idempotency_key, request_hash, from_status, to_status,
    message, payload, agent_id, occurred_at, response)
  VALUES (v_job.org_id, _job, 'agent', _type, _seq, _idem, v_hash, v_from, v_to, v_msg, v_payload, _agent, _occurred_at, v_resp)
  RETURNING id INTO v_eid;
  IF v_to IS DISTINCT FROM v_from THEN PERFORM public._sync_device_after_job(_job); END IF;
  RETURN v_resp || jsonb_build_object('duplicate', false, 'event_id', v_eid, 'job_status', v_to, 'last_seq', _seq);
END $$;

CREATE OR REPLACE FUNCTION public.agent_upload_evidence(_agent uuid, _job uuid, _idem text, _kind text, _filename text, _content_type text, _content text, _sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_job public.jobs; v_ex public.evidence_objects; v_calc text; v_size integer; v_id uuid;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR v_job.agent_id IS DISTINCT FROM _agent THEN RAISE EXCEPTION 'Job not found for this agent' USING ERRCODE = 'ND404'; END IF;
  SELECT * INTO v_ex FROM public.evidence_objects WHERE job_id = _job AND idempotency_key = _idem;
  IF FOUND THEN
    IF v_ex.sha256 <> lower(coalesce(_sha256, '')) THEN
      RAISE EXCEPTION 'This idempotency key was already used for different evidence' USING ERRCODE = 'ND409';
    END IF;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'evidence_id', v_ex.id, 'sha256', v_ex.sha256);
  END IF;
  IF v_job.status NOT IN ('running','verifying','interrupted') THEN
    RAISE EXCEPTION 'Evidence can only be uploaded while the job is running, verifying or interrupted (job is %)', v_job.status USING ERRCODE = 'ND409';
  END IF;
  v_size := octet_length(convert_to(coalesce(_content, ''), 'UTF8'));
  IF v_size > 262144 THEN RAISE EXCEPTION 'Evidence exceeds 256 KB' USING ERRCODE = 'ND422'; END IF;
  v_calc := encode(extensions.digest(convert_to(coalesce(_content, ''), 'UTF8'), 'sha256'), 'hex');
  IF v_calc <> lower(coalesce(_sha256, '')) THEN
    RAISE EXCEPTION 'SHA-256 mismatch: the content does not match the declared hash' USING ERRCODE = 'ND422';
  END IF;
  INSERT INTO public.evidence_objects(org_id, job_id, agent_id, kind, filename, content_type, size_bytes, sha256, content, is_simulated, idempotency_key)
  VALUES (v_job.org_id, _job, _agent, _kind, left(_filename, 200), coalesce(left(_content_type, 100), 'text/plain'), v_size, v_calc, _content, v_job.is_simulated, _idem)
  RETURNING id INTO v_id;
  PERFORM public._log_job_event(v_job.org_id, _job, 'agent', 'evidence_uploaded', v_job.status, v_job.status,
    format('Evidence %s (%s, %s bytes, sha256 %s…)', left(_filename, 200), _kind, v_size, left(v_calc, 12)),
    jsonb_build_object('evidence_id', v_id, 'kind', _kind, 'sha256', v_calc, 'size_bytes', v_size), NULL, _agent);
  UPDATE public.jobs SET last_event_at = now() WHERE id = _job;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'evidence_id', v_id, 'sha256', v_calc);
END $$;

CREATE OR REPLACE FUNCTION public.agent_reconcile(_agent uuid, _jobs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_out jsonb := '[]'::jsonb; r record; v_agent_seq integer; v_instr text;
BEGIN
  UPDATE public.agents SET last_heartbeat_at = now(), last_state = 'reconciling' WHERE id = _agent RETURNING org_id INTO v_org;
  PERFORM public._sweep_jobs(v_org);
  FOR r IN
    SELECT j.id, j.status, j.last_agent_seq, j.execution_outcome,
      EXISTS (SELECT 1 FROM public.job_authorizations a WHERE a.job_id = j.id AND a.consumed_at IS NULL AND a.revoked_at IS NULL) AS auth_live
    FROM public.jobs j
    WHERE j.agent_id = _agent AND (NOT public.job_is_terminal(j.status)
      OR j.id IN (SELECT (x->>'job_id')::uuid FROM jsonb_array_elements(coalesce(_jobs, '[]'::jsonb)) x WHERE x ? 'job_id'))
  LOOP
    SELECT (x->>'agent_last_seq')::integer INTO v_agent_seq FROM jsonb_array_elements(coalesce(_jobs, '[]'::jsonb)) x
      WHERE x->>'job_id' = r.id::text LIMIT 1;
    v_instr := CASE
      WHEN public.job_is_terminal(r.status) THEN 'stop'
      WHEN r.status = 'queued' THEN 'ack_required'
      WHEN r.status = 'interrupted' THEN 'report_state'
      WHEN v_agent_seq IS NOT NULL AND v_agent_seq > r.last_agent_seq THEN 'replay_from_server_seq'
      ELSE 'continue' END;
    v_out := v_out || jsonb_build_array(jsonb_build_object('job_id', r.id, 'status', r.status, 'server_last_seq', r.last_agent_seq,
      'next_seq', r.last_agent_seq + 1, 'agent_last_seq', v_agent_seq, 'authorization_live', r.auth_live,
      'execution_outcome', r.execution_outcome, 'instruction', v_instr));
  END LOOP;
  RETURN jsonb_build_object('server_time', now(), 'jobs', v_out);
END $$;

-- ===== Execute privileges =====
REVOKE EXECUTE ON FUNCTION public._log_job_event(uuid, uuid, text, text, public.job_status, public.job_status, text, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._policy_support_reason(public.policy_versions, text, public.drive_interface) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sync_device_after_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._insert_policy_version(uuid, uuid, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sweep_jobs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._revoke_agent(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_enroll(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_authenticate(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_report_inventory(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_list_jobs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_job_event(uuid, uuid, text, integer, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_upload_evidence(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.agent_reconcile(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_enroll(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_authenticate(text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_heartbeat(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_report_inventory(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_list_jobs(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_job_event(uuid, uuid, text, integer, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_upload_evidence(uuid, uuid, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_reconcile(uuid, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_policy(uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_policy_version(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_policy_archived(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_job(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_job(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.authorize_job(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_job(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.review_job(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_enrollment_token(uuid, text, uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_enrollment_token(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_agent(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sweep_jobs(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.simulator_prepare(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_policy(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_policy_version(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_policy_archived(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_job(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_job(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_job(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_job(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_enrollment_token(uuid, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_enrollment_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_agent(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_jobs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.simulator_prepare(uuid, text) TO authenticated;