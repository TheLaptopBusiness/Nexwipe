import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, DatabaseZap, Eraser, FlaskConical, Laptop, Plus, Power, RefreshCw, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, errorMessage } from "@/components/nd/page";
import { SimulatedBadge, ToneBadge } from "@/components/nd/status-badge";
import { HardwareOriginBadge } from "@/components/nd/hardware-origin-badge";
import { DeviceBarcode, OnlineDot, SectionCard } from "@/components/nd/connected-device";
import { AddToInventoryDialog, type AddTarget } from "@/components/nd/station-discoveries";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDateTime, useConnectedDevice } from "@/lib/queries";
import { canRebootToUsb, deviceSections, deviceSummary, isOnline, needsDbUpdate, stationContext } from "@/lib/connected-device";
import { reviewFlags } from "@/lib/discovery";
import { tagFields } from "@/lib/device-tag";
import { GradeAndTag } from "@/components/nd/device-tag-dialog";

export const Route = createFileRoute("/_authenticated/app/connected/$discoveryId")({
  component: ConnectedDevicePage,
});

const REBOOT_STATUS: Record<string, string> = {
  requested: "Waiting for the laptop to pick up the request…",
  delivered: "Laptop received the request",
  done: "Laptop is restarting into the NexWipe stick",
  failed: "Laptop could not restart into the stick",
  expired: "Request expired: the laptop did not check in within 2 minutes",
};

function ConnectedDevicePage() {
  const { discoveryId } = Route.useParams();
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const q = useConnectedDevice(discoveryId);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReboot, setConfirmReboot] = useState(false);
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);

  if (q.isLoading) return <LoadingBlock />;
  if (needsDbUpdate(q.error)) return <EmptyState icon={DatabaseZap} title="Waiting for a database update" description="Connected devices need database update 0018, which has not been applied to this database yet. The project owner applies it in Lovable; nothing is wrong with your data." />;
  if (q.error) return <ErrorBlock error={q.error} />;
  if (!q.data)
    return (
      <EmptyState icon={Laptop} title="Device not found" description="It may belong to another organization."
        action={<Button asChild variant="outline"><Link to="/app/agents">Back to Agents & stations</Link></Button>} />
    );

  const d = q.data;
  const ag = d.agents;
  const s = deviceSummary(d.payload);
  const sections = deviceSections(d.payload);
  const flags = reviewFlags(d.review_flags);
  const online = ag?.status === "active" && isOnline(ag?.last_heartbeat_at);
  const mayAct = can(role, "stations.act") && ag?.status === "active";
  const rebootPending = ag?.reboot_status === "requested" || ag?.reboot_status === "delivered";

  async function act(action: "rescan" | "reboot_to_usb") {
    setBusy(action);
    const { error } = await supabase.rpc("request_station_action", { _agent: d.agent_id, _action: action });
    setBusy(null);
    setConfirmReboot(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success(action === "rescan" ? "Rescan requested. The laptop reports again on its next check-in." : "Reboot requested. The laptop shows a countdown that can be cancelled at the laptop.");
    qc.invalidateQueries({ queryKey: ["connected-device", orgId, discoveryId] });
  }

  return (
    <div className="max-w-6xl space-y-5">
      <Link to="/app/agents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Agents & stations
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0 space-y-2">
          <Mono className="text-sm text-muted-foreground">{d.device_code}</Mono>
          <h1 className="text-2xl font-semibold text-foreground">{s.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <OnlineDot online={online} />
            {d.is_simulated && <SimulatedBadge />}
            {d.is_read_only_test && <ToneBadge tone="info">Read-only station</ToneBadge>}
            {!d.is_simulated && d.hardware_origin === "synthetic" && <span title={d.hardware_origin_reason ?? undefined}><ToneBadge tone="warning" icon={FlaskConical}>Synthetic test hardware</ToneBadge></span>}
            {flags.length > 0 && <ToneBadge tone="warning" icon={AlertTriangle}>Needs review</ToneBadge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {stationContext(ag?.platform)} · {ag?.name ?? "station"} · first report {formatDateTime(d.reported_at)} · last {formatDateTime(d.last_reported_at)}
            {d.report_count > 1 ? ` · ${d.report_count} reports` : ""}
            <Button variant="ghost" size="sm" className="ml-1 h-6 px-2 text-xs" disabled={q.isFetching} title="Show the latest data NexWipe cloud has. Does not ask the laptop to rescan." onClick={() => q.refetch()}>
              <RotateCw /> Refresh
            </Button>
          </p>
        </div>
        <div className="space-y-1 text-center">
          <DeviceBarcode code={d.device_code} />
          <p className="text-xs text-muted-foreground">Unique NexWipe device code</p>
        </div>
      </div>

      <section aria-labelledby="actions-h" className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-card">
        <h2 id="actions-h" className="font-medium text-foreground">Actions</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!mayAct || busy !== null} onClick={() => act("rescan")}>
            <RefreshCw /> Rescan
          </Button>
          {canRebootToUsb(ag?.platform) && (
            <Button variant="outline" disabled={!mayAct || !online || rebootPending || busy !== null} onClick={() => setConfirmReboot(true)}>
              <Power /> Reboot into NexWipe
            </Button>
          )}
          <Button variant="outline" disabled title="Planned for v2">
            <Eraser /> Start wipe <ToneBadge tone="neutral">Planned · v2</ToneBadge>
          </Button>
          <span className="ml-auto">
            {d.device_id ? (
              <span className="inline-flex items-center gap-2 text-sm">
                In inventory as <Link to="/app/inventory/$deviceId" params={{ deviceId: d.device_id }} className="font-mono hover:underline">{d.devices?.asset_tag}</Link>
                {d.devices && <HardwareOriginBadge record={d.devices} />}
                <GradeAndTag deviceId={d.device_id} grade={d.devices?.grade ?? null} tag={tagFields(d.payload, d.device_code, d.devices?.grade ?? null)}
                  onSaved={() => { qc.invalidateQueries({ queryKey: ["connected-device", orgId, discoveryId] }); qc.invalidateQueries({ queryKey: ["device", d.device_id] }); }} />
              </span>
            ) : !d.is_simulated && can(role, "inventory.write") && d.system_serial ? (
              <span className="inline-flex flex-col items-end gap-1">
                <Button size="sm" disabled={!online} onClick={() => setAddTarget({ id: d.id, serial: d.system_serial!, code: d.device_code })}><Plus /> Add to inventory</Button>
                {!online && <span className="text-xs text-muted-foreground">Start NexWipe on the laptop first: adding re-scans it to confirm.</span>}
              </span>
            ) : (
              <ToneBadge tone="neutral">Not in inventory</ToneBadge>
            )}
          </span>
        </div>
        {ag?.reboot_status && (
          <p className={`text-sm ${ag.reboot_status === "failed" || ag.reboot_status === "expired" ? "text-warning" : "text-muted-foreground"}`}>
            Reboot into NexWipe: {REBOOT_STATUS[ag.reboot_status] ?? ag.reboot_status}
            {ag.reboot_detail ? ` (${ag.reboot_detail})` : ""} · {formatDateTime(ag.reboot_status_at)}
          </p>
        )}
        {!canRebootToUsb(ag?.platform) && (
          <p className="text-xs text-muted-foreground">This laptop is already running from the NexWipe stick, so there is nothing to reboot into.</p>
        )}
        {ag?.status !== "active" && <p className="text-xs text-warning">The station that reported this laptop has been revoked; actions are unavailable.</p>}
      </section>

      {flags.length > 0 && (
        <section className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm">
          <h2 className="mb-1 font-medium text-foreground">Needs review</h2>
          <ul className="space-y-0.5 text-warning">
            {flags.map((f, i) => <li key={`${f.code}-${i}`}>{f.label}{f.target ? `: ${f.target}` : ""}{f.detail ? ` (${f.detail})` : ""}</li>)}
          </ul>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((sec) => <SectionCard key={sec.title} section={sec} />)}
      </div>

      <details className="rounded-lg border border-border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium text-foreground">Raw report (as sent by the station)</summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">{JSON.stringify(d.payload, null, 2)}</pre>
      </details>

      <AlertDialog open={confirmReboot} onOpenChange={setConfirmReboot}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reboot this laptop into the NexWipe stick?</AlertDialogTitle>
            <AlertDialogDescription>
              {s.title}{d.system_serial ? ` (S/N ${d.system_serial})` : ""} will restart after a countdown on its screen, and boot once from the NexWipe stick.
              Unsaved work on the laptop is lost. Nothing is erased: the stick only reads hardware details. Someone at the laptop can cancel during the countdown.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); act("reboot_to_usb"); }} disabled={busy !== null}>Reboot into NexWipe</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AddToInventoryDialog target={addTarget} onClose={() => setAddTarget(null)} />
    </div>
  );
}

