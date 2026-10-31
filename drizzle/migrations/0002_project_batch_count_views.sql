CREATE VIEW public.project_device_counts WITH (security_invoker = true) AS
SELECT d.org_id, d.project_id,
  count(*)::int AS received,
  count(*) FILTER (WHERE d.status IN ('processed','released'))::int AS processed,
  count(*) FILTER (WHERE d.status = 'quarantined')::int AS quarantined,
  count(*) FILTER (WHERE d.status = 'released')::int AS released
FROM public.devices d
WHERE d.project_id IS NOT NULL
GROUP BY d.org_id, d.project_id;

CREATE VIEW public.batch_device_counts WITH (security_invoker = true) AS
SELECT d.org_id, d.batch_id,
  count(*)::int AS received,
  count(*) FILTER (WHERE d.status IN ('processed','released'))::int AS processed,
  count(*) FILTER (WHERE d.status = 'quarantined')::int AS quarantined,
  count(*) FILTER (WHERE d.status = 'released')::int AS released
FROM public.devices d
WHERE d.batch_id IS NOT NULL
GROUP BY d.org_id, d.batch_id;

GRANT SELECT ON public.project_device_counts TO authenticated;
GRANT SELECT ON public.batch_device_counts TO authenticated;
GRANT SELECT ON public.project_device_counts TO service_role;
GRANT SELECT ON public.batch_device_counts TO service_role;