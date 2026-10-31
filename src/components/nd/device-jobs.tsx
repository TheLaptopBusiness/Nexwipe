import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, CheckCircle2, FileText, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingBlock, Mono, errorMessage } from "@/components/nd/page";
import { JOB_STATUS, OUTCOME, SimulatedBadge, StatusBadge, ToneBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { JOB_LIST_COLUMNS, formatBytes, formatDateTime, usePolicies } from "@/lib/queries";
import { deviceClearance, jobLabel, type JobStatus } from "@/lib/jobs";

function useDeviceJobs(deviceId: string) {
  return useQuery({
    queryKey: ["device-jobs", deviceId],
    refetchInterval: 6000,
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select(JOB_LIST_COLUMNS).eq("device_id", deviceId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

function useActiveDrives(deviceId: string) {
  return useQuery({
    queryKey: ["device-drives", deviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("device_drive_associations")
        .select("id, slot, attached_at, detached_at, drives(id, serial, manufacturer, model, interface, capacity_bytes, hardware_verified, source)")
        .eq("device_id", deviceId)
        .order("attached_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function DeviceJobs({ deviceId, isSimulated }: { deviceId: string; isSimulated: boolean }) {
  const { role } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const jobs = useDeviceJobs(deviceId);
  const assoc = useActiveDrives(deviceId);
  const policies = usePolicies();
  const [open, setOpen] = useState(false);
  const [driveId, setDriveId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [busy, setBusy] = useState(false);

  if (jobs.isLoading || assoc.isLoading) return <LoadingBlock />;
  const active = (assoc.data ?? []).filter((a) => !a.detached_at && a.drives);
  const clearance = deviceClearance(
    active.map((a) => ({ associationId: a.id, serial: a.drives!.serial })),
    (jobs.data ?? []).map((j) => ({ associationId: j.association_id, status: j.status as JobStatus, createdAt: j.created_at })),
  );
  const usablePolicies = (policies.data ?? []).filter((p) => !p.is_archived && (isSimulated || !p.is_simulator));

  async function create() {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_job", { _device: deviceId, _drive: driveId, _policy: policyId });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    qc.invalidateQueries({ queryKey: ["device-jobs", deviceId] });
    setOpen(false);
    navigate({ to: "/app/jobs/$jobId", params: { jobId: data as string } });
  }

  return (
    <div className="space-y-5">
      <div className={`flex flex-wrap items-start gap-3 rounded-lg border p-4 text-sm ${clearance.ready ? "border-success/30 bg-success-soft text-success" : "border-border bg-card text-foreground"}`}>
        {clearance.ready ? <CheckCircle2 className="mt-0.5 size-4" /> : <ShieldAlert className="mt-0.5 size-4 text-warning" />}
        <div className="flex-1">
          <p className="font-medium">{clearance.ready ? "Every attached drive has an approved job." : "Not ready: the laptop can only be marked processed when every attached drive has an approved job."}</p>
          {!clearance.ready && clearance.perDrive.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {clearance.perDrive.map((d) => (
                <li key={d.serial}><Mono>{d.serial}</Mono>: {d.status ? JOB_STATUS[d.status]?.label : "no job yet"}</li>
              ))}
            </ul>
          )}
        </div>
        {can(role, "jobs.operate") && active.length > 0 && <Button size="sm" onClick={() => { setDriveId(active[0]!.drives!.id); setPolicyId(usablePolicies[0]?.id ?? ""); setOpen(true); }}><Plus /> Create job</Button>}
      </div>

      {(jobs.data ?? []).length === 0 ? (
        <EmptyState icon={Activity} title="No erasure jobs" description="Create one job per attached drive. No erasure has been performed on this device by NextDrive." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2.5 font-medium">Job</th><th className="px-4 py-2.5 font-medium">Drive</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Execution</th><th className="px-4 py-2.5 font-medium">Verification</th><th className="px-4 py-2.5 font-medium">Created</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.data!.map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-2.5"><Link to="/app/jobs/$jobId" params={{ jobId: j.id }} className="font-mono font-medium hover:underline">{jobLabel(j.job_number)}</Link>{j.is_simulated && <SimulatedBadge className="ml-2" />}</td>
                  <td className="px-4 py-2.5"><Mono>{j.target_drive_serial}</Mono></td>
                  <td className="px-4 py-2.5"><StatusBadge map={JOB_STATUS} value={j.status} /></td>
                  <td className="px-4 py-2.5"><StatusBadge map={OUTCOME} value={j.execution_outcome} /></td>
                  <td className="px-4 py-2.5"><StatusBadge map={OUTCOME} value={j.verification_outcome} /></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create erasure job</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Drive</Label>
              <Select value={driveId} onValueChange={setDriveId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{active.map((a) => <SelectItem key={a.drives!.id} value={a.drives!.id}>{a.drives!.serial} · {a.drives!.model ?? a.drives!.interface} · {formatBytes(a.drives!.capacity_bytes)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Policy (current version is used and kept on the job)</Label>
              <Select value={policyId} onValueChange={setPolicyId}>
                <SelectTrigger><SelectValue placeholder={usablePolicies.length ? "Select policy" : "No policies yet"} /></SelectTrigger>
                <SelectContent>{usablePolicies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · v{p.latest?.version}{p.is_simulator ? " (SIMULATED)" : ""}</SelectItem>)}</SelectContent>
              </Select>
              {usablePolicies.length === 0 && <p className="text-xs text-muted-foreground">An owner or administrator must <Link to="/app/policies" className="underline">create a policy</Link> first.</p>}
            </div>
            <p className="text-xs text-muted-foreground">If the policy does not cover this laptop or drive, the job is created as Unsupported.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || !driveId || !policyId} onClick={create}>Create draft job</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DeviceEvidence({ deviceId }: { deviceId: string }) {
  const ev = useQuery({
    queryKey: ["device-evidence", deviceId],
    queryFn: async () => {
      const { data, error } = await supabase.from("evidence_objects").select("id, job_id, filename, kind, size_bytes, sha256, is_simulated, created_at, jobs!inner(device_id, job_number)").eq("jobs.device_id", deviceId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  if (ev.isLoading) return <LoadingBlock />;
  if ((ev.data ?? []).length === 0) return <EmptyState icon={FileText} title="No evidence" description="Agents upload evidence while a job runs. Binary evidence storage and signed records arrive in Phase 3." />;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {ev.data!.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
          <FileText className="size-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{e.filename}</span>
          {e.is_simulated && <SimulatedBadge />}
          <ToneBadge tone="neutral">{e.kind.replace("_", " ")}</ToneBadge>
          <Mono className="text-xs text-muted-foreground">sha256 {e.sha256.slice(0, 16)}…</Mono>
          <Link to="/app/jobs/$jobId" params={{ jobId: e.job_id }} className="ml-auto font-mono text-xs hover:underline">{jobLabel(e.jobs.job_number)}</Link>
        </li>
      ))}
    </ul>
  );
}
