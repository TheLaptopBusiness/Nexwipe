import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Battery, DatabaseZap, Cpu, FlaskConical, HardDrive, Laptop, MemoryStick, MonitorCog, Plus, Usb } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, errorMessage } from "@/components/nd/page";
import { SimulatedBadge, ToneBadge } from "@/components/nd/status-badge";
import { HardwareOriginBadge } from "@/components/nd/hardware-origin-badge";
import { OnlineDot } from "@/components/nd/connected-device";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDateTime, useConnectedDevices } from "@/lib/queries";
import { deviceSummary, isOnline, needsDbUpdate, stationContext } from "@/lib/connected-device";
import { reviewFlags } from "@/lib/discovery";

/** Connected devices: one card per laptop reported by a NexWipe stick. Click a card for full details and the barcode. */
export function StationDiscoveries() {
  const { role } = useOrg();
  const [target, setTarget] = useState<{ id: string; serial: string } | null>(null);
  const q = useConnectedDevices();

  return (
    <section className="space-y-3" aria-labelledby="disc-h">
      <div>
        <h2 id="disc-h" className="font-display text-lg font-semibold text-foreground">Connected devices</h2>
        <p className="text-sm text-muted-foreground">Laptops reported by a NexWipe USB stick. Use Refresh at the top of the page to see new reports. Click a laptop for its full details and barcode. Reporting only reads hardware details: nothing on the laptop is changed and no erasure is started. A station’s sign-in proves which stick sent a report, not that the hardware physically exists.</p>
      </div>
      {q.isLoading ? <LoadingBlock /> : needsDbUpdate(q.error) ? <EmptyState icon={DatabaseZap} title="Waiting for a database update" description="Connected devices need database update 0018, which has not been applied to this database yet. The project owner applies it in Lovable; nothing is wrong with your data." /> : q.error ? <ErrorBlock error={q.error} /> : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Usb} title="No laptops reported yet" description="Plug a prepared NexWipe USB stick into a laptop and open Start NexWipe. The laptop appears here as soon as it reports." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data!.map((d) => {
            const s = deviceSummary(d.payload);
            const flags = reviewFlags(d.review_flags);
            const online = d.agents?.status === "active" && isOnline(d.agents?.last_heartbeat_at);
            const specs: Array<[typeof Cpu, string | null]> = [
              [Cpu, s.cpu], [MemoryStick, s.ram && `${s.ram} RAM`], [HardDrive, s.storage],
              [Battery, s.battery !== null ? `Battery health ${s.battery}%` : null], [MonitorCog, s.os],
            ];
            return (
              <li key={d.id} className="relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to="/app/connected/$discoveryId" params={{ discoveryId: d.id }}
                      className="font-medium text-foreground after:absolute after:inset-0 after:rounded-lg hover:underline">
                      <Laptop className="mr-1.5 inline size-4 text-muted-foreground" aria-hidden />{s.title}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <Mono>{d.device_code}</Mono>
                      {d.system_serial && <Mono>S/N {d.system_serial}</Mono>}
                    </p>
                  </div>
                  <OnlineDot online={online} />
                </div>

                {(d.is_simulated || d.hardware_origin === "synthetic" || flags.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {d.is_simulated && <SimulatedBadge />}
                    {!d.is_simulated && d.hardware_origin === "synthetic" && <span title={d.hardware_origin_reason ?? undefined}><ToneBadge tone="warning" icon={FlaskConical}>Synthetic test hardware</ToneBadge></span>}
                    {flags.length > 0 && <ToneBadge tone="warning" icon={AlertTriangle}>Needs review</ToneBadge>}
                  </div>
                )}

                <ul className="space-y-1 text-sm text-muted-foreground">
                  {specs.filter(([, v]) => v).map(([Icon, v]) => (
                    <li key={v} className="flex items-center gap-2"><Icon className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{v}</span></li>
                  ))}
                  {specs.every(([, v]) => !v) && <li>No details reported</li>}
                </ul>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span>{stationContext(d.agents?.platform)} · {d.agents?.name ?? "station"} · {formatDateTime(d.last_reported_at)}</span>
                  {/* relative z-10 keeps these above the card-wide link */}
                  <span className="relative z-10">
                    {d.device_id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Link to="/app/inventory/$deviceId" params={{ deviceId: d.device_id }} className="font-mono hover:underline">{d.devices?.asset_tag}</Link>
                        {d.is_simulated ? <ToneBadge tone="warning">Simulated record</ToneBadge> : d.devices ? <HardwareOriginBadge record={d.devices} /> : null}
                      </span>
                    ) : !d.is_simulated && can(role, "inventory.write") && d.system_serial ? (
                      <Button size="sm" variant="outline" onClick={() => setTarget({ id: d.id, serial: d.system_serial! })}><Plus /> Add to inventory</Button>
                    ) : (
                      <ToneBadge tone="neutral">Not in inventory</ToneBadge>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <AddToInventoryDialog target={target} onClose={() => setTarget(null)} />
    </section>
  );
}

/** Add a reported laptop to inventory (create_device_from_discovery). Shared with the device detail page. */
export function AddToInventoryDialog({ target, onClose }: { target: { id: string; serial: string } | null; onClose: () => void }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) return;
    const tag = String(new FormData(e.currentTarget).get("asset_tag") ?? "").trim();
    setBusy(true);
    const { error } = await supabase.rpc("create_device_from_discovery", { _discovery: target.id, _asset_tag: tag });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Added to inventory. It is marked station-reported when the station reports again (synthetic test hardware stays marked synthetic).");
    onClose();
    qc.invalidateQueries({ queryKey: ["connected-devices", orgId] });
    qc.invalidateQueries({ queryKey: ["connected-device", orgId] });
    qc.invalidateQueries({ queryKey: ["devices", orgId] });
  }

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
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
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="disc-add" disabled={busy}>Add to inventory</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
