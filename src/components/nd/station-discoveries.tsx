import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Cpu, FlaskConical, HardDrive, Plus, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingBlock, Mono, errorMessage } from "@/components/nd/page";
import { SimulatedBadge, ToneBadge } from "@/components/nd/status-badge";
import { HardwareOriginBadge } from "@/components/nd/hardware-origin-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatBytes, formatDateTime } from "@/lib/queries";
import { reviewFlags, summarizeDiscovery, type DiscoveryPayload } from "@/lib/discovery";

export function StationDiscoveries() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ id: string; serial: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["discoveries", orgId],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_discoveries")
        .select("id, agent_id, device_id, system_serial, payload, is_simulated, is_read_only_test, reported_at, last_reported_at, report_count, review_flags, hardware_origin, hardware_origin_reason, agents(name), devices(asset_tag, hardware_verified, hardware_origin, source)")
        .eq("org_id", orgId)
        .order("last_reported_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data;
    },
  });

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) return;
    const tag = String(new FormData(e.currentTarget).get("asset_tag") ?? "").trim();
    setBusy(true);
    const { error } = await supabase.rpc("create_device_from_discovery", { _discovery: target.id, _asset_tag: tag });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Added to inventory. It is marked station-reported when the station reports again (synthetic test hardware stays marked synthetic).");
    setTarget(null);
    qc.invalidateQueries({ queryKey: ["discoveries", orgId] });
    qc.invalidateQueries({ queryKey: ["devices", orgId] });
  }

  return (
    <section className="space-y-3" aria-labelledby="disc-h">
      <div>
        <h2 id="disc-h" className="font-display text-lg font-semibold text-foreground">Hardware reported by stations</h2>
        <p className="text-sm text-muted-foreground">Read-only hardware discovery uploaded by enrolled stations. Reporting hardware never starts an erasure. A station’s sign-in proves which station sent a report, not that the hardware physically exists.</p>
      </div>
      {q.isLoading ? <LoadingBlock /> : (q.data ?? []).length === 0 ? (
        <EmptyState icon={ScanSearch} title="No reports yet" description="When an enrolled station boots a laptop, the laptop and its drives appear here." />
      ) : (
        <ul className="space-y-2">
          {q.data!.map((d) => {
            const s = summarizeDiscovery(d.payload as DiscoveryPayload);
            const flags = reviewFlags(d.review_flags);
            return (
              <li key={d.id} className="rounded-lg border border-border bg-card p-4 shadow-card">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Cpu className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium text-foreground">{s.title}</span>
                  {d.system_serial && <Mono className="text-xs text-muted-foreground">S/N {d.system_serial}</Mono>}
                  {d.is_simulated && <SimulatedBadge />}
                  {d.is_read_only_test && <ToneBadge tone="info">Read-only test station</ToneBadge>}
                  {!d.is_simulated && d.hardware_origin === "synthetic" && <span title={d.hardware_origin_reason ?? undefined}><ToneBadge tone="warning" icon={FlaskConical}>Synthetic test hardware</ToneBadge></span>}
                  {flags.length > 0 && <ToneBadge tone="warning" icon={AlertTriangle}>Needs review</ToneBadge>}
                  <span className="text-xs text-muted-foreground">
                    from {d.agents?.name ?? "station"} · last {formatDateTime(d.last_reported_at)}
                    {d.report_count > 1 ? ` · reported ${d.report_count} times` : ""}
                  </span>
                  <span className="ml-auto">
                    {d.device_id ? (
                      <span className="inline-flex items-center gap-2">
                        <Link to="/app/inventory/$deviceId" params={{ deviceId: d.device_id }} className="font-mono text-sm hover:underline">{d.devices?.asset_tag}</Link>
                        {d.is_simulated ? <ToneBadge tone="warning">Simulated record</ToneBadge> : d.devices ? <HardwareOriginBadge record={d.devices} /> : null}
                      </span>
                    ) : !d.is_simulated && can(role, "inventory.write") && d.system_serial ? (
                      <Button size="sm" variant="outline" onClick={() => setTarget({ id: d.id, serial: d.system_serial! })}><Plus /> Add to inventory</Button>
                    ) : (
                      <ToneBadge tone="neutral">Not in inventory</ToneBadge>
                    )}
                  </span>
                </div>
                {flags.length > 0 && (
                  <ul className="mt-2 space-y-0.5 pl-6 text-xs text-warning">
                    {flags.map((f, i) => <li key={`${f.code}-${i}`}>{f.label}{f.target ? `: ${f.target}` : ""}{f.detail ? ` (${f.detail})` : ""}</li>)}
                  </ul>
                )}
                {s.drives.length > 0 && (
                  <ul className="mt-2 grid gap-1 pl-6 text-xs text-muted-foreground sm:grid-cols-2">
                    {s.drives.map((dr, i) => (
                      <li key={`${dr.serial}-${i}`} className="flex items-center gap-1.5">
                        <HardDrive className="size-3.5" aria-hidden />
                        <Mono className="text-foreground">{dr.serial ?? "no serial"}</Mono>
                        <span>· {dr.model ?? "unknown model"} · {dr.interfaceLabel}{dr.capacity ? ` · ${formatBytes(dr.capacity)}` : ""}</span>
                        {dr.ignored && <ToneBadge tone="neutral">Station boot medium · not recorded</ToneBadge>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add reported laptop to inventory</DialogTitle>
            <DialogDescription>System serial <span className="font-mono">{target?.serial}</span>. The laptop and its reported drives are recorded; they are marked station-reported when the station reports them again. Synthetic test hardware stays marked synthetic.</DialogDescription>
          </DialogHeader>
          <form id="disc-add" onSubmit={onAdd} className="space-y-1.5">
            <Label htmlFor="asset_tag">Asset tag *</Label>
            <Input id="asset_tag" name="asset_tag" required maxLength={64} autoFocus />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button type="submit" form="disc-add" disabled={busy}>Add to inventory</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
