import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Activity, CheckCircle2, FileText, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, errorMessage } from "@/components/nd/page";
import { JOB_STATUS, OUTCOME, SimulatedBadge, StatusBadge, ToneBadge } from "@/components/nd/status-badge";
import { PolicyVersionSummary, rulesFromVersion } from "@/components/nd/policy-form";
import { useOrg } from "@/lib/org-context";
import { can, type OrgRole } from "@/lib/permissions";
import { AGENT_COLUMNS, formatBytes, formatDateTime, memberName, useMembers } from "@/lib/queries";
import { INTERFACE_LABELS, METHOD_LABELS, PIPELINE, heartbeatState, isTerminal, jobLabel, relativeTime, type JobStatus } from "@/lib/jobs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Erasure job · NexWipe" }] }),
  component: JobDetail,
});

function useJob(jobId: string) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["job", jobId],
    refetchInterval: (q) => (q.state.data && isTerminal(q.state.data.status as JobStatus) ? false : 4000),
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("*, policy_versions(*, policies(id, name)), devices(id, manufacturer, model, status)").eq("id", jobId).eq("org_id", orgId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function JobDetail() {
  const { jobId } = Route.useParams();
  const job = useJob(jobId);
  const members = useMembers();
  const memberById = new Map((members.data ?? []).map((m) => [m.user_id, m]));
  const live = job.data && !isTerminal(job.data.status as JobStatus);

  const events = useQuery({
    queryKey: ["job-events", jobId],
    refetchInterval: live ? 4000 : false,
    queryFn: async () => {
      const { data, error } = await supabase.from("job_events").select("id, source, event_type, agent_seq, from_status, to_status, message, actor_id, received_at, occurred_at").eq("job_id", jobId).order("id", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const auths = useQuery({
    queryKey: ["job-auths", jobId],
    refetchInterval: live ? 4000 : false,
    queryFn: async () => {
      const { data, error } = await supabase.from("job_authorizations").select("*").eq("job_id", jobId).order("authorized_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const evidence = useQuery({
    queryKey: ["job-evidence", jobId],
    refetchInterval: live ? 4000 : false,
    queryFn: async () => {
      const { data, error } = await supabase.from("evidence_objects").select("*").eq("job_id", jobId).order("created_at");
      if (error) throw error;
      return data;
    },
  });
  const agent = useQuery({
    queryKey: ["agent", job.data?.agent_id],
    enabled: !!job.data?.agent_id,
    refetchInterval: live ? 5000 : false,
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select(AGENT_COLUMNS).eq("id", job.data!.agent_id!).single();
      if (error) throw error;
      return data;
    },
  });
  const [viewEvidence, setViewEvidence] = useState<string | null>(null);

  if (job.isLoading) return <LoadingBlock />;
  if (job.error) return <ErrorBlock error={job.error} />;
  if (!job.data) return <EmptyState icon={Activity} title="Job not found" description="It may belong to another organization." />;
  const j = job.data;
  const pv = j.policy_versions!;
  const status = j.status as JobStatus;
  const hb = heartbeatState(agent.data?.last_heartbeat_at);
  const ev = evidence.data?.find((e) => e.id === viewEvidence);

  return (
    <div className="space-y-5">
      <Link to="/app/jobs" search={{ view: "open" }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Jobs</Link>

      {j.is_simulated && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm text-warning" role="note">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p><strong className="font-semibold">SIMULATED JOB.</strong> Created by the agent simulator. No disk was touched. Simulated jobs can never produce an erasure record, certificate or usage charge.</p>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="font-mono text-sm text-muted-foreground">{jobLabel(j.job_number)}</p>
          <h1 className="text-2xl font-semibold text-foreground">
            Drive <Mono className="text-2xl">{j.target_drive_serial}</Mono> in{" "}
            <Link to="/app/inventory/$deviceId" params={{ deviceId: j.device_id }} className="hover:underline"><Mono className="text-2xl">{j.target_asset_tag}</Mono></Link>
          </h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge map={JOB_STATUS} value={status} />
            {j.is_simulated && <SimulatedBadge />}
            {j.billable_unit && <ToneBadge tone="info">Billable unit (billing not built yet)</ToneBadge>}
          </div>
        </div>
        <Actions job={j} />
      </div>

      <Pipeline status={status} />

      <div className="grid gap-4 lg:grid-cols-3">
        <OutcomeCard title="Execution" outcome={j.execution_outcome} lines={[j.method ? METHOD_LABELS[j.method] ?? j.method : "No method reported", j.execution_finished_at ? `Reported ${formatDateTime(j.execution_finished_at)}` : null]} />
        <OutcomeCard title="Verification" outcome={j.verification_outcome === "pending" ? "pending" : j.verification_outcome} lines={[pv.verification_method === "full_read" ? "Policy: full read-back" : `Policy: sampled ≥ ${pv.verification_sample_pct}%`, j.verification_finished_at ? `Reported ${formatDateTime(j.verification_finished_at)}` : null]} />
        <div className="rounded-lg border border-border bg-card p-4 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviewer approval</p>
          <div className="mt-2">
            {j.review_decision === "approved" ? <ToneBadge tone="success" icon={CheckCircle2}>Approved</ToneBadge> : j.review_decision === "rejected" ? <ToneBadge tone="danger" icon={XCircle}>Rejected</ToneBadge> : <ToneBadge tone="neutral">{status === "awaiting_validation" ? "Awaiting reviewer" : "Not reviewed"}</ToneBadge>}
          </div>
          {j.reviewed_by && <p className="mt-2 text-sm text-foreground">{memberName(memberById.get(j.reviewed_by))} · {formatDateTime(j.reviewed_at)}</p>}
          {j.review_notes && <p className="mt-1 text-sm text-muted-foreground">{j.review_notes}</p>}
        </div>
      </div>

      {j.exception_code && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert">
          <p className="font-semibold">Exception: <Mono>{j.exception_code}</Mono></p>
          {j.exception_detail && <p className="mt-1">{j.exception_detail}</p>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-border bg-card p-5 shadow-card lg:col-span-2">
          <h2 className="mb-3 font-semibold text-foreground">Live status</h2>
          <p className="text-sm text-muted-foreground">Current phase</p>
          <p className="text-lg font-medium text-foreground">{j.current_phase ?? JOB_STATUS[status]?.label}</p>
          {j.progress_measured && j.progress_pct != null ? (
            <div className="mt-3 space-y-1">
              <Progress value={Number(j.progress_pct)} aria-label="Measured progress" />
              <p className="text-xs text-muted-foreground tabular">{Number(j.progress_pct).toFixed(0)}% measured by the agent</p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No measured progress reported. Only the current phase is shown.</p>
          )}
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Agent</dt><dd className="mt-0.5 text-foreground">{agent.data?.name ?? "Not assigned"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Last heartbeat</dt><dd className="mt-0.5">{agent.data ? <ToneBadge tone={hb === "online" ? "success" : hb === "stale" ? "warning" : "danger"}>{relativeTime(agent.data.last_heartbeat_at)}</ToneBadge> : "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Last agent event</dt><dd className="mt-0.5 text-foreground">{relativeTime(j.last_event_at)} · seq {j.last_agent_seq}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Refreshes every 4 seconds. If the agent goes silent for 3 minutes the job becomes Interrupted; it is never treated as success.</p>
        </section>
        <section className="rounded-lg border border-border bg-card p-5 shadow-card">
          <h2 className="mb-3 font-semibold text-foreground">Target (fixed at creation)</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Asset tag</dt><dd><Mono>{j.target_asset_tag}</Mono></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">System serial</dt><dd><Mono>{j.target_system_serial ?? "—"}</Mono></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Drive serial</dt><dd><Mono>{j.target_drive_serial}</Mono></dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Drive</dt><dd className="text-right">{j.target_drive_model ?? "—"} · {INTERFACE_LABELS[j.target_drive_interface]} · {formatBytes(j.target_drive_capacity_bytes)}</dd></div>
          </dl>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-card">
        <h2 className="mb-3 font-semibold text-foreground">
          Policy: <Link to="/app/policies/$policyId" params={{ policyId: pv.policies!.id }} className="hover:underline">{pv.policies!.name}</Link> <span className="font-mono">v{pv.version}</span>
        </h2>
        <PolicyVersionSummary v={rulesFromVersion(pv)} />
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-foreground">Authorizations</h2>
        {(auths.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-2 font-medium">Authorized by</th><th className="px-4 py-2 font-medium">Confirmed target</th><th className="px-4 py-2 font-medium">Expires</th><th className="px-4 py-2 font-medium">State</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auths.data!.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">{memberName(memberById.get(a.authorized_by))}<p className="text-xs text-muted-foreground">{formatDateTime(a.authorized_at)}</p></td>
                    <td className="px-4 py-2"><Mono>{a.confirmed_asset_tag}</Mono> · <Mono>{a.confirmed_drive_serial}</Mono></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{formatDateTime(a.expires_at)}</td>
                    <td className="px-4 py-2">
                      {a.consumed_at ? <ToneBadge tone="success">Used {formatDateTime(a.consumed_at)} · confirmed on station</ToneBadge> : a.revoked_at ? <ToneBadge tone="neutral">Withdrawn: {a.revoke_reason}</ToneBadge> : <ToneBadge tone="info">Live, single use</ToneBadge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-foreground">Evidence</h2>
        {(evidence.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No evidence uploaded.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {evidence.data!.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <FileText className="size-4 text-muted-foreground" />
                <span className="font-medium text-foreground">{e.filename}</span>
                {e.is_simulated && <SimulatedBadge />}
                <span className="text-muted-foreground">{e.kind.replace("_", " ")} · {formatBytes(e.size_bytes)}</span>
                <Mono className="text-xs text-muted-foreground">sha256 {e.sha256.slice(0, 16)}…</Mono>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setViewEvidence(e.id)}>View</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-foreground">Event history</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">Received</th><th className="px-4 py-2 font-medium">Source</th><th className="px-4 py-2 font-medium">Event</th><th className="px-4 py-2 font-medium">Transition</th><th className="px-4 py-2 font-medium">Detail</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(events.data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground tabular">{formatDateTime(e.received_at)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{e.source === "user" ? memberName(memberById.get(e.actor_id ?? "")) : e.source}{e.agent_seq != null && <Mono className="ml-1 text-xs">#{e.agent_seq}</Mono>}</td>
                  <td className="px-4 py-2"><Mono className="text-foreground">{e.event_type}</Mono></td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{e.from_status && e.to_status && e.from_status !== e.to_status ? `${JOB_STATUS[e.from_status]?.label} → ${JOB_STATUS[e.to_status]?.label}` : "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={!!ev} onOpenChange={(v) => !v && setViewEvidence(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{ev?.filename}</DialogTitle></DialogHeader>
          <p className="break-all font-mono text-xs text-muted-foreground">sha256 {ev?.sha256} · verified on upload</p>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground whitespace-pre-wrap">{ev?.content}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Pipeline({ status }: { status: JobStatus }) {
  const idx = PIPELINE.findIndex((p) => p.status === status);
  const off = idx === -1;
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Job pipeline">
      {PIPELINE.map((p, i) => (
        <li key={p.status} className={cn("rounded-md border px-2.5 py-1 text-xs", !off && i < idx ? "border-success/30 bg-success-soft text-success" : !off && i === idx ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")} aria-current={i === idx ? "step" : undefined}>
          {p.label}
        </li>
      ))}
      {off && <li className="rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">{JOB_STATUS[status]?.label}</li>}
    </ol>
  );
}

function OutcomeCard({ title, outcome, lines }: { title: string; outcome: string; lines: (string | null)[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-2"><StatusBadge map={OUTCOME} value={outcome} /></div>
      {lines.filter(Boolean).map((l) => <p key={l} className="mt-1.5 text-sm text-muted-foreground">{l}</p>)}
    </div>
  );
}

type JobRow = NonNullable<ReturnType<typeof useJob>["data"]>;

function Actions({ job }: { job: JobRow }) {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const status = job.status as JobStatus;
  const canOperate = can(role, "jobs.operate");
  const reviewerRoles = (job.policy_versions?.reviewer_roles ?? []) as OrgRole[];
  const canReview = reviewerRoles.includes(role);
  const [authOpen, setAuthOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    for (const k of [["job", job.id], ["job-events", job.id], ["job-auths", job.id], ["jobs", orgId], ["device-jobs", job.device_id]]) qc.invalidateQueries({ queryKey: k });
  };

  async function run(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success(ok);
    refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canOperate && status === "draft" && <Button disabled={busy} onClick={() => run(() => supabase.rpc("submit_job", { _job: job.id }), "Submitted for authorization")}>Request authorization</Button>}
      {canOperate && status === "awaiting_authorization" && <Button onClick={() => setAuthOpen(true)}><ShieldCheck /> Confirm target & authorize</Button>}
      {canOperate && ["draft", "awaiting_authorization", "queued"].includes(status) && (
        <Button variant="outline" disabled={busy} onClick={() => run(() => supabase.rpc("cancel_job", { _job: job.id, _reason: "Cancelled by technician" }), "Job cancelled")}>Cancel job</Button>
      )}
      {status === "awaiting_validation" && (canReview ? <Button onClick={() => setReviewOpen(true)}>Review</Button> : <ToneBadge tone="neutral">Your role cannot review under this policy</ToneBadge>)}
      {authOpen && <AuthorizeDialog job={job} onClose={() => setAuthOpen(false)} onDone={refresh} />}
      {reviewOpen && <ReviewDialog job={job} onClose={() => setReviewOpen(false)} onDone={refresh} />}
    </div>
  );
}

function AuthorizeDialog({ job, onClose, onDone }: { job: JobRow; onClose: () => void; onDone: () => void }) {
  const { orgId } = useOrg();
  const agents = useQuery({
    queryKey: ["agents-active", orgId, job.is_simulated],
    queryFn: async () => {
      const { data, error } = await supabase.from("agents").select(AGENT_COLUMNS).eq("org_id", orgId).eq("status", "active").eq("is_simulated", job.is_simulated);
      if (error) throw error;
      return data;
    },
  });
  const [agentId, setAgentId] = useState("");
  const [tag, setTag] = useState("");
  const [serial, setSerial] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const { error } = await supabase.rpc("authorize_job", { _job: job.id, _agent: agentId, _confirm_asset_tag: tag, _confirm_drive_serial: serial });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Authorized. The agent must also confirm the drive locally before starting.");
    onDone();
    onClose();
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Confirm target and authorize</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Read the asset tag from the physical laptop and the serial from the physical drive. The authorization is bound to this organization, agent, laptop, drive and policy version, is single use and expires after {job.policy_versions?.authorization_ttl_minutes} minutes.</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Agent / station</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger><SelectValue placeholder={agents.data?.length === 0 ? "No active agent" : "Select an agent"} /></SelectTrigger>
              <SelectContent>{(agents.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name} · {relativeTime(a.last_heartbeat_at)}</SelectItem>)}</SelectContent>
            </Select>
            {job.is_simulated && <p className="text-xs text-warning">Simulated jobs can only be assigned to simulator agents.</p>}
          </div>
          <div className="space-y-1.5"><Label htmlFor="c-tag">Asset tag on the laptop</Label><Input id="c-tag" className="font-mono" value={tag} onChange={(e) => setTag(e.target.value)} autoComplete="off" /></div>
          <div className="space-y-1.5"><Label htmlFor="c-serial">Serial on the drive</Label><Input id="c-serial" className="font-mono" value={serial} onChange={(e) => setSerial(e.target.value)} autoComplete="off" /></div>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <Checkbox checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} className="mt-0.5" />
            I have physically checked this laptop and drive. All data on this drive will be destroyed when the agent runs.
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !agentId || !tag || !serial || !confirm} onClick={submit}>Authorize</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ job, onClose, onDone }: { job: JobRow; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(approve: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc("review_job", { _job: job.id, _approve: approve, _notes: notes });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success(approve ? "Job approved" : "Job rejected and quarantined");
    onDone();
    onClose();
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reviewer decision</DialogTitle></DialogHeader>
        <ul className="space-y-1 text-sm text-foreground">
          <li>Execution: <strong>{job.execution_outcome}</strong> ({job.method ? METHOD_LABELS[job.method] : "—"})</li>
          <li>Verification: <strong>{job.verification_outcome}</strong></li>
          {job.is_simulated && <li className="text-warning">Simulated job: approval only exercises the workflow and never produces a record or charge.</li>}
        </ul>
        <div className="space-y-1.5"><Label htmlFor="notes">Notes (required to reject)</Label><Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy || !notes.trim()} onClick={() => decide(false)}>Reject</Button>
          <Button disabled={busy} onClick={() => decide(true)}>Approve</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
