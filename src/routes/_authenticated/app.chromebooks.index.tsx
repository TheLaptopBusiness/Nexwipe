import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Laptop, Plus, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, PageHeader, errorMessage } from "@/components/nd/page";
import { ALL, FilterSelect } from "@/components/nd/filter-select";
import { ToneBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { useBatches, useChromebooks, useProjects } from "@/lib/queries";
import { MANAGEMENT_LABEL, RESET_LABEL, nextStep, type ManagementStatus, type ResetStatus } from "@/lib/chromebook";

export const Route = createFileRoute("/_authenticated/app/chromebooks/")({
  head: () => ({ meta: [{ title: "Chromebook processing — NexWipe" }] }),
  component: Chromebooks,
});

const RELEASE: Record<string, { label: string; tone: "neutral" | "success" | "danger" }> = {
  pending: { label: "Pending", tone: "neutral" },
  resale_ready: { label: "Resale-ready", tone: "success" },
  quarantined: { label: "Quarantined", tone: "danger" },
};

function Chromebooks() {
  const { role } = useOrg();
  const list = useChromebooks();
  const navigate = useNavigate();
  const canOperate = can(role, "chromebooks.operate");
  const [scan, setScan] = useState("");
  const [registerSerial, setRegisterSerial] = useState<string | null>(null);
  const [mgmt, setMgmt] = useState(ALL);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => scanRef.current?.focus(), []);

  const rows = useMemo(
    () => (list.data ?? []).filter((r) => mgmt === ALL || r.management_status === mgmt),
    [list.data, mgmt],
  );

  function onScan(e: React.FormEvent) {
    e.preventDefault();
    const q = scan.trim().toLowerCase();
    if (!q) return;
    const hit = (list.data ?? []).find(
      (r) => r.devices?.system_serial?.toLowerCase() === q || r.devices?.asset_tag.toLowerCase() === q,
    );
    setScan("");
    if (hit) navigate({ to: "/app/chromebooks/$recordId", params: { recordId: hit.id } });
    else if (canOperate) setRegisterSerial(scan.trim());
    else toast.error("No Chromebook with that serial or asset tag");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Chromebook processing"
        description="Guided workflow for receiving, deprovisioning checks, reset records, diagnostics and release. NexWipe records what technicians and administrators did and saw; it does not reset or deprovision devices itself."
        actions={canOperate && <Button onClick={() => setRegisterSerial("")}><Plus /> Receive Chromebook</Button>}
      />

      <div className="rounded-lg border border-border bg-card p-4">
        <form onSubmit={onScan} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="cb-scan">Scan serial number or asset tag</Label>
            <div className="relative mt-1">
              <ScanBarcode className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
              <Input id="cb-scan" ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} className="pl-8 font-mono" autoComplete="off" placeholder="Scan or type, then Enter" />
            </div>
          </div>
          <Button type="submit" variant="outline">Open</Button>
          <FilterSelect
            label="Management"
            value={mgmt}
            onChange={setMgmt}
            options={Object.entries(MANAGEMENT_LABEL).map(([value, m]) => ({ value, label: m.label }))}
          />
        </form>
        <p className="mt-2 text-xs text-muted-foreground">An unknown serial opens the receive form for the next Chromebook in the batch.</p>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock error={list.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Laptop} title="No Chromebooks yet" description="Scan a serial number or use Receive Chromebook to start a processing record." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Asset</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Serial</th>
                <th className="px-3 py-2">Management</th>
                <th className="px-3 py-2">Reset</th>
                <th className="px-3 py-2">Release</th>
                <th className="px-3 py-2">Next step</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = MANAGEMENT_LABEL[r.management_status as ManagementStatus];
                const rs = RESET_LABEL[r.reset_status as ResetStatus];
                const rel = RELEASE[r.release_decision] ?? RELEASE["pending"]!;
                return (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link to="/app/chromebooks/$recordId" params={{ recordId: r.id }} className="font-medium text-foreground underline-offset-2 hover:underline">
                        {r.devices?.asset_tag}
                      </Link>
                      {r.is_synthetic && <ToneBadge tone="warning" className="ml-2">Synthetic</ToneBadge>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{[r.devices?.manufacturer, r.devices?.model].filter(Boolean).join(" ") || "Unknown"}</td>
                    <td className="px-3 py-2"><Mono>{r.devices?.system_serial ?? "Unknown"}</Mono></td>
                    <td className="px-3 py-2"><ToneBadge tone={m?.tone ?? "neutral"}>{m?.label ?? r.management_status}</ToneBadge></td>
                    <td className="px-3 py-2"><ToneBadge tone={rs?.tone ?? "neutral"}>{rs?.label ?? r.reset_status}</ToneBadge></td>
                    <td className="px-3 py-2"><ToneBadge tone={rel.tone}>{rel.label}</ToneBadge></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{nextStep(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {registerSerial !== null && (
        <RegisterDialog
          initialSerial={registerSerial}
          onClose={() => {
            setRegisterSerial(null);
            setTimeout(() => scanRef.current?.focus(), 0);
          }}
        />
      )}
    </div>
  );
}

function RegisterDialog({ initialSerial, onClose }: { initialSerial: string; onClose: () => void }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projects = useProjects();
  const [project, setProject] = useState(() => sessionStorage.getItem("nd.cb.project") ?? ALL);
  const batches = useBatches(project === ALL ? undefined : project);
  const [batch, setBatch] = useState(() => sessionStorage.getItem("nd.cb.batch") ?? ALL);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>, openAfter: boolean) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    setBusy(true);
    const { data, error } = await supabase.rpc("chromebook_register", {
      _org: orgId,
      _asset_tag: v("asset_tag"),
      _manufacturer: v("manufacturer"),
      _model: v("model"),
      _serial: v("serial"),
      ...(project === ALL ? {} : { _project: project }),
      ...(batch === ALL || project === ALL ? {} : { _batch: batch }),
    });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    sessionStorage.setItem("nd.cb.project", project);
    sessionStorage.setItem("nd.cb.batch", batch);
    await qc.invalidateQueries({ queryKey: ["chromebooks", orgId] });
    toast.success(`Received ${v("asset_tag")}`);
    onClose();
    if (openAfter && data) navigate({ to: "/app/chromebooks/$recordId", params: { recordId: data } });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive Chromebook</DialogTitle>
          <DialogDescription>Record what is printed on the device label. Leave unknown values empty — they stay unknown.</DialogDescription>
        </DialogHeader>
        <form
          id="cb-register"
          onSubmit={(e) => submit(e, (e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-open") === "1")}
          className="grid gap-3 sm:grid-cols-2"
        >
          <div className="sm:col-span-2"><Label htmlFor="cb-serial">Serial number</Label><Input id="cb-serial" name="serial" defaultValue={initialSerial} className="font-mono" autoFocus={!initialSerial} /></div>
          <div className="sm:col-span-2"><Label htmlFor="cb-tag">Asset tag</Label><Input id="cb-tag" name="asset_tag" required className="font-mono" autoFocus={!!initialSerial} /></div>
          <div><Label htmlFor="cb-mfr">Manufacturer</Label><Input id="cb-mfr" name="manufacturer" placeholder="HP, Lenovo, ASUS…" /></div>
          <div><Label htmlFor="cb-model">Exact model</Label><Input id="cb-model" name="model" placeholder="Chromebook 11 G5" /></div>
          <FilterSelect label="Project" value={project} onChange={(p) => { setProject(p); setBatch(ALL); }} allLabel="No project" options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
          <FilterSelect label="Batch" value={batch} onChange={setBatch} allLabel="No batch" options={project === ALL ? [] : (batches.data ?? []).map((b) => ({ value: b.id, label: b.name }))} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="cb-register" variant="outline" loading={busy} data-open="0">Save and scan next</Button>
          <Button type="submit" form="cb-register" loading={busy} data-open="1">Save and open</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
