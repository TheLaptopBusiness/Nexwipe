import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, PageHeader } from "@/components/nd/page";
import { JOB_STATUS, SimulatedBadge, StatusBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { JOB_LIST_COLUMNS } from "@/lib/queries";
import { ACTIVE, EXCEPTION, INTERFACE_LABELS, TERMINAL, jobLabel, relativeTime, type JobStatus } from "@/lib/jobs";
import { cn } from "@/lib/utils";

const VIEWS = {
  open: { label: "Open", statuses: ["draft", "awaiting_authorization", "queued", "running", "verifying", "interrupted", "awaiting_validation"] as JobStatus[] },
  authorization: { label: "Awaiting authorization", statuses: ["draft", "awaiting_authorization"] as JobStatus[] },
  live: { label: "Live", statuses: ACTIVE },
  review: { label: "Review queue", statuses: ["awaiting_validation"] as JobStatus[] },
  exceptions: { label: "Exceptions", statuses: EXCEPTION },
  closed: { label: "Closed", statuses: TERMINAL },
} as const;
type View = keyof typeof VIEWS;

export const Route = createFileRoute("/_authenticated/app/jobs/")({
  staticData: { sitemap: false },
  validateSearch: (s: Record<string, unknown>): { view: View } => ({
    view: (Object.keys(VIEWS) as View[]).includes(s["view"] as View) ? (s["view"] as View) : "open",
  }),
  head: () => ({ meta: [{ title: "Erasure jobs · NexWipe" }] }),
  component: JobsPage,
});

function JobsPage() {
  const { view } = Route.useSearch();
  const { orgId } = useOrg();
  useEffect(() => {
    // Expire stale authorizations and flag lost heartbeats before showing live state.
    void supabase.rpc("sweep_jobs", { _org: orgId });
  }, [orgId]);
  const jobs = useQuery({
    queryKey: ["jobs", orgId, view],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select(JOB_LIST_COLUMNS).eq("org_id", orgId).in("status", VIEWS[view].statuses).order("updated_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Erasure jobs" description="One job per drive. Status refreshes every 5 seconds. A browser never erases anything: jobs are executed only by an enrolled agent after a technician confirms the target." />
      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Job views">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link key={v} to="/app/jobs" search={{ view: v }} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", v === view ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {VIEWS[v].label}
          </Link>
        ))}
      </nav>
      {jobs.isLoading ? <LoadingBlock /> : jobs.error ? <ErrorBlock error={jobs.error} /> : jobs.data!.length === 0 ? (
        <EmptyState icon={Activity} title="No jobs here" description="Create jobs from a laptop's Job history tab, or run the agent simulator." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Job</th>
                <th className="px-4 py-2.5 font-medium">Laptop / drive</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Current phase</th>
                <th className="px-4 py-2.5 font-medium">Policy</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.data!.map((j) => (
                <tr key={j.id} className="hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <Link to="/app/jobs/$jobId" params={{ jobId: j.id }} className="font-mono font-medium text-foreground hover:underline">{jobLabel(j.job_number)}</Link>
                    {j.is_simulated && <SimulatedBadge className="ml-2" />}
                  </td>
                  <td className="px-4 py-2.5"><Mono className="text-foreground">{j.target_asset_tag}</Mono><span className="text-muted-foreground"> · </span><Mono className="text-muted-foreground">{j.target_drive_serial}</Mono><span className="ml-1 text-xs text-muted-foreground">({INTERFACE_LABELS[j.target_drive_interface]})</span></td>
                  <td className="px-4 py-2.5"><StatusBadge map={JOB_STATUS} value={j.status} /></td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {j.current_phase ?? "—"}
                    {j.progress_measured && j.progress_pct != null && <span className="ml-1 tabular text-foreground">{Number(j.progress_pct).toFixed(0)}%</span>}
                    {j.exception_code && <span className="ml-1 font-mono text-xs text-danger">{j.exception_code}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{j.policy_versions?.policies?.name} v{j.policy_versions?.version}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{relativeTime(j.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
