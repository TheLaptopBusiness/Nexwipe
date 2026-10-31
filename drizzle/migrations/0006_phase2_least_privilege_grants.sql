REVOKE ALL ON public.policies, public.policy_versions, public.agents, public.agent_credentials, public.enrollment_tokens,
  public.agent_request_nonces, public.agent_discoveries, public.jobs, public.job_authorizations, public.job_events,
  public.evidence_objects FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.policies, public.policy_versions, public.agents,
  public.enrollment_tokens, public.agent_discoveries, public.jobs, public.job_authorizations, public.job_events,
  public.evidence_objects FROM authenticated;
REVOKE ALL ON public.agent_credentials, public.agent_request_nonces FROM authenticated;
GRANT SELECT ON public.policies, public.policy_versions, public.agents, public.enrollment_tokens, public.agent_discoveries,
  public.jobs, public.job_authorizations, public.job_events, public.evidence_objects TO authenticated;
-- Helper functions with no reason to be callable directly.
REVOKE EXECUTE ON FUNCTION public.method_fits_interface(public.erasure_method, public.drive_interface) FROM anon;
REVOKE EXECUTE ON FUNCTION public.job_transition_allowed(public.job_status, public.job_status) FROM anon;
REVOKE EXECUTE ON FUNCTION public.job_is_terminal(public.job_status) FROM anon;
REVOKE EXECUTE ON FUNCTION public.manufacturer_allowed(text, text[]) FROM anon;