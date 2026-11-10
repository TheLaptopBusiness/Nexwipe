import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowLeft,
  FileText,
  HardDrive,
  History,
  Plus,
  RefreshCw,
  RotateCw,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, errorMessage } from "@/components/nd/page";
import {
  DEVICE_STATUS,
  SimulatedBadge,
  StatusBadge,
  ToneBadge,
} from "@/components/nd/status-badge";
import { HardwareOriginBadge } from "@/components/nd/hardware-origin-badge";
import { DeviceEvidence, DeviceJobs } from "@/components/nd/device-jobs";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import {
  formatBytes,
  formatDateTime,
  memberName,
  useDeviceDiscovery,
  useDiagnosticResults,
  useMembers,
  useSites,
} from "@/lib/queries";
import { DiagnosticResultsCard } from "@/components/nd/diagnostics";
import { deviceSections, isOnline } from "@/lib/connected-device";
import { tagFields } from "@/lib/device-tag";
import { SectionCard } from "@/components/nd/connected-device";
import { GradeAndTag } from "@/components/nd/device-tag-dialog";
import { manufacturerInScope } from "@/lib/hardware";

export const Route = createFileRoute("/_authenticated/app/inventory/$deviceId")({
  staticData: { sitemap: false },
  component: DeviceDetail,
});

const NONE = "__none";
const INTERFACES = [
  { value: "sata_hdd", label: "SATA HDD" },
  { value: "sata_ssd", label: "SATA SSD" },
  { value: "nvme_ssd", label: "NVMe SSD" },
  { value: "unsupported_other", label: "Other / unsupported" },
];
const interfaceLabel = (v: string) => INTERFACES.find((i) => i.value === v)?.label ?? v;

function DeviceDetail() {
  const { deviceId } = Route.useParams();
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const disc = useDeviceDiscovery(deviceId);
  const [rescanBusy, setRescanBusy] = useState(false);

  const device = useQuery({
    queryKey: ["device", deviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devices")
        .select("*, sites(name), clients(name), projects(id, name), batches(name)")
        .eq("id", deviceId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (device.isLoading) return <LoadingBlock />;
  if (device.error) return <ErrorBlock error={device.error} />;
  if (!device.data)
    return (
      <EmptyState
        icon={HardDrive}
        title="Device not found"
        description="It may belong to another organization or have been removed."
        action={
          <Button asChild variant="outline">
            <Link to="/app/inventory">Back to inventory</Link>
          </Button>
        }
      />
    );

  const d = device.data;
  const r = disc.data ?? null;
  const online = r?.agents?.status === "active" && isOnline(r?.agents?.last_heartbeat_at);
  const needsRescan = !!r && !d.is_simulated && d.hardware_origin === "not_station_reported";
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["device", d.id] });
    qc.invalidateQueries({ queryKey: ["device-discovery", orgId, d.id] });
  };

  async function rescan() {
    if (!r) return;
    setRescanBusy(true);
    const { error } = await supabase.rpc("request_station_action", {
      _agent: r.agent_id,
      _action: "rescan",
    });
    setRescanBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Rescan requested. Press Refresh in a few seconds.");
  }

  return (
    <div className="space-y-5">
      <Link
        to="/app/inventory"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Inventory
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="font-mono text-sm text-muted-foreground">{d.asset_tag}</p>
          <h1 className="text-2xl font-semibold text-foreground">
            {[d.manufacturer, d.model].filter(Boolean).join(" ") || "Unidentified device"}
          </h1>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <StatusBadge map={DEVICE_STATUS} value={d.status} />
            {d.is_simulated && <SimulatedBadge />}
            <HardwareOriginBadge record={{ ...d, from_station: !!r }} showExplanation />
            {d.manufacturer && !manufacturerInScope(d.manufacturer) && (
              <ToneBadge tone="warning">Manufacturer outside initial scope</ToneBadge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GradeAndTag
            deviceId={d.id}
            grade={d.grade}
            tag={r ? tagFields(r.payload, r.device_code, d.grade) : null}
            onSaved={refresh}
          />
          <Button size="sm" variant="ghost" onClick={refresh}>
            <RotateCw /> Refresh
          </Button>
        </div>
      </div>

      {needsRescan && (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm"
          aria-label="Needs re-scan"
        >
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">Needs re-scan</p>
            <p className="text-muted-foreground">
              {online
                ? "The laptop is connected. Press Rescan so its station confirms this record."
                : "The laptop is not connected. Start NexWipe on it: it re-scans automatically when it starts, then press Refresh."}
            </p>
          </div>
          {online && can(role, "stations.act") && (
            <Button size="sm" disabled={rescanBusy} onClick={rescan}>
              <RefreshCw /> Rescan
            </Button>
          )}
        </section>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {r && <TabsTrigger value="hardware">Hardware report</TabsTrigger>}
          <TabsTrigger value="drives">Installed drives</TabsTrigger>
          <TabsTrigger value="jobs">Job history</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="custody">Custody timeline</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5">
          <Overview device={d} />
        </TabsContent>
        {r && (
          <TabsContent value="hardware" className="mt-5 space-y-3">
            <p className="text-sm text-muted-foreground">
              Everything the NexWipe stick read from this laptop, last report{" "}
              {formatDateTime(r.last_reported_at)}.{" "}
              <Link
                to="/app/connected/$discoveryId"
                params={{ discoveryId: r.id }}
                className="underline"
              >
                Open the station view
              </Link>{" "}
              for Rescan and the barcode.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {deviceSections(r.payload).map((s) => (
                <SectionCard key={s.title} section={s} />
              ))}
            </div>
          </TabsContent>
        )}
        <TabsContent value="drives" className="mt-5">
          <Drives deviceId={d.id} />
        </TabsContent>
        <TabsContent value="jobs" className="mt-5">
          <DeviceJobs deviceId={d.id} isSimulated={d.is_simulated} />
        </TabsContent>
        <TabsContent value="evidence" className="mt-5">
          <DeviceEvidence deviceId={d.id} />
        </TabsContent>
        <TabsContent value="diagnostics" className="mt-5">
          <Diagnostics device={d} />
        </TabsContent>
        <TabsContent value="custody" className="mt-5">
          <Custody deviceId={d.id} />
        </TabsContent>
        <TabsContent value="reports" className="mt-5">
          <EmptyState
            icon={FileText}
            title="No records issued"
            description="Erasure records can only be issued for approved jobs. Reporting arrives in Phase 3."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type DeviceRow = Tables<"devices"> & {
  sites: { name: string } | null;
  clients: { name: string } | null;
  projects: { id: string; name: string } | null;
  batches: { name: string } | null;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children ?? "—"}</dd>
    </div>
  );
}

function Overview({ device: d }: { device: DeviceRow }) {
  const { role } = useOrg();
  const qc = useQueryClient();
  const sites = useSites();
  const members = useMembers();
  const canWrite = can(role, "inventory.write");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(d.status);
  const [site, setSite] = useState(d.site_id ?? NONE);
  const [tech, setTech] = useState(d.assigned_technician ?? NONE);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    setBusy(true);
    const ram = s("ram_gb");
    const { error } = await supabase
      .from("devices")
      .update({
        manufacturer: s("manufacturer"),
        model: s("model"),
        system_serial: s("system_serial"),
        cpu: s("cpu"),
        ram_gb: ram ? Number(ram) : null,
        notes: s("notes"),
        status: status as never,
        site_id: site === NONE ? null : site,
        assigned_technician: tech === NONE ? null : tech,
      })
      .eq("id", d.id);
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Device updated");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["device", d.id] });
    qc.invalidateQueries({ queryKey: ["custody", d.id] });
  }

  const techMember = members.data?.find((m) => m.user_id === d.assigned_technician);

  if (!editing)
    return (
      <div className="rounded-lg border border-border bg-card p-6 shadow-card">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Device details</h2>
          {canWrite && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Asset tag">
            <Mono>{d.asset_tag}</Mono>
          </Field>
          <Field label="System serial">
            {d.system_serial ? <Mono>{d.system_serial}</Mono> : null}
          </Field>
          <Field label="Manufacturer">{d.manufacturer}</Field>
          <Field label="Model">{d.model}</Field>
          <Field label="CPU">{d.cpu}</Field>
          <Field label="RAM">{d.ram_gb ? `${d.ram_gb} GB` : null}</Field>
          <Field label="Intake condition">{d.intake_condition.replace("_", " ")}</Field>
          <Field label="Received">{formatDateTime(d.received_at)}</Field>
          <Field label="Site">{d.sites?.name}</Field>
          <Field label="Client">{d.clients?.name}</Field>
          <Field label="Project">
            {d.projects ? (
              <Link
                to="/app/projects/$projectId"
                params={{ projectId: d.projects.id }}
                className="hover:underline"
              >
                {d.projects.name}
              </Link>
            ) : null}
          </Field>
          <Field label="Batch">{d.batches?.name}</Field>
          <Field label="Assigned technician">
            {d.assigned_technician ? memberName(techMember) : null}
          </Field>
        </dl>
        {d.notes && (
          <p className="mt-5 whitespace-pre-wrap border-t border-border pt-4 text-sm text-foreground">
            {d.notes}
          </p>
        )}
        <p className="mt-5 text-xs text-muted-foreground">
          CPU and RAM are normally reported by the agent. Values entered here are unverified.
        </p>
      </div>
    );

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-lg border border-border bg-card p-6 shadow-card"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="manufacturer">Manufacturer</Label>
          <Input id="manufacturer" name="manufacturer" defaultValue={d.manufacturer ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="model">Model</Label>
          <Input id="model" name="model" defaultValue={d.model ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="system_serial">System serial</Label>
          <Input
            id="system_serial"
            name="system_serial"
            className="font-mono"
            defaultValue={d.system_serial ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cpu">CPU</Label>
          <Input id="cpu" name="cpu" defaultValue={d.cpu ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ram_gb">RAM (GB)</Label>
          <Input
            id="ram_gb"
            name="ram_gb"
            type="number"
            min={0}
            step="0.5"
            defaultValue={d.ram_gb ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DEVICE_STATUS).map(([v, m]) => (
                <SelectItem key={v} value={v}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Site</Label>
          <Select value={site} onValueChange={setSite}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No site</SelectItem>
              {(sites.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Assigned technician</Label>
          <Select value={tech} onValueChange={setTech}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Unassigned</SelectItem>
              {(members.data ?? [])
                .filter(
                  (m) => m.status === "active" && ["owner", "admin", "technician"].includes(m.role),
                )
                .map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {memberName(m)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={d.notes ?? ""} />
      </div>
      <p className="text-xs text-muted-foreground">
        Status, site and technician changes are recorded on the custody timeline automatically.
      </p>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          Save changes
        </Button>
        <Button type="button" variant="outline" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Drives({ deviceId }: { deviceId: string }) {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const canWrite = can(role, "inventory.write");
  const [adding, setAdding] = useState(false);
  const [iface, setIface] = useState("nvme_ssd");
  const [detach, setDetach] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const assoc = useQuery({
    queryKey: ["device-drives", deviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("device_drive_associations")
        .select(
          "id, slot, attached_at, detached_at, drives(id, serial, manufacturer, model, interface, capacity_bytes, hardware_verified, hardware_origin, source)",
        )
        .eq("device_id", deviceId)
        .order("attached_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const serial = s("serial");
    if (!serial) return;
    setBusy(true);
    const cap = s("capacity_gb");
    // Reuse an existing drive record when the same model+serial is already known (drives can move between laptops).
    let driveId: string | null = null;
    const model = s("model");
    let lookup = supabase.from("drives").select("id").eq("org_id", orgId).ilike("serial", serial);
    lookup = model ? lookup.ilike("model", model) : lookup.is("model", null);
    const existing = await lookup.maybeSingle();
    if (existing.data) driveId = existing.data.id;
    else {
      const { data, error } = await supabase
        .from("drives")
        .insert({
          org_id: orgId,
          serial,
          model,
          manufacturer: s("manufacturer"),
          interface: iface as never,
          capacity_bytes: cap ? Math.round(Number(cap) * 1e9) : null,
        })
        .select("id")
        .single();
      if (error) {
        setBusy(false);
        {
          toast.error(errorMessage(error));
          return;
        }
      }
      driveId = data.id;
    }
    const { error } = await supabase
      .from("device_drive_associations")
      .insert({ org_id: orgId, device_id: deviceId, drive_id: driveId, slot: s("slot") });
    setBusy(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "That drive is currently attached to another device. Detach it there first."
          : errorMessage(error),
      );
      return;
    }
    toast.success("Drive attached");
    setAdding(false);
    qc.invalidateQueries({ queryKey: ["device-drives", deviceId] });
    qc.invalidateQueries({ queryKey: ["custody", deviceId] });
  }

  async function onDetach() {
    if (!detach) return;
    const { error } = await supabase
      .from("device_drive_associations")
      .update({ detached_at: new Date().toISOString() })
      .eq("id", detach);
    setDetach(null);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Drive detached; history preserved");
    qc.invalidateQueries({ queryKey: ["device-drives", deviceId] });
    qc.invalidateQueries({ queryKey: ["custody", deviceId] });
  }

  if (assoc.isLoading) return <LoadingBlock />;
  if (assoc.error) return <ErrorBlock error={assoc.error} />;
  const current = assoc.data!.filter((a) => !a.detached_at);
  const past = assoc.data!.filter((a) => a.detached_at);

  const row = (a: NonNullable<typeof assoc.data>[number], active: boolean) => (
    <tr key={a.id}>
      <td className="px-4 py-2.5">
        <Mono className="font-medium text-foreground">{a.drives?.serial}</Mono>
      </td>
      <td className="px-4 py-2.5 text-foreground">
        {[a.drives?.manufacturer, a.drives?.model].filter(Boolean).join(" ") || "—"}
      </td>
      <td className="px-4 py-2.5">
        <ToneBadge tone={a.drives?.interface === "unsupported_other" ? "danger" : "neutral"}>
          {interfaceLabel(a.drives?.interface ?? "")}
        </ToneBadge>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground tabular">
        {formatBytes(a.drives?.capacity_bytes)}
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">{a.slot ?? "—"}</td>
      <td className="px-4 py-2.5">{a.drives && <HardwareOriginBadge record={a.drives} />}</td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground tabular">
        {formatDateTime(a.attached_at)}
        {a.detached_at && <> → {formatDateTime(a.detached_at)}</>}
      </td>
      <td className="px-4 py-2.5 text-right">
        {active && canWrite && (
          <Button variant="ghost" size="sm" onClick={() => setDetach(a.id)}>
            <Unplug /> Detach
          </Button>
        )}
      </td>
    </tr>
  );

  const head = (
    <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
      <tr>
        <th className="px-4 py-2.5 font-medium">Drive serial</th>
        <th className="px-4 py-2.5 font-medium">Model</th>
        <th className="px-4 py-2.5 font-medium">Interface</th>
        <th className="px-4 py-2.5 font-medium">Capacity</th>
        <th className="px-4 py-2.5 font-medium">Slot</th>
        <th className="px-4 py-2.5 font-medium">Identity</th>
        <th className="px-4 py-2.5 font-medium">Attached</th>
        <th className="px-4 py-2.5" />
      </tr>
    </thead>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Drives are tracked separately from the laptop. Detaching keeps the association history.
        </p>
        {canWrite && (
          <Button onClick={() => setAdding(true)}>
            <Plus /> Attach drive
          </Button>
        )}
      </div>
      {current.length === 0 ? (
        <EmptyState
          icon={HardDrive}
          title="No drives attached"
          description="Record each internal drive by its own serial. The agent will report and verify drive identity once available."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            {head}
            <tbody className="divide-y divide-border">{current.map((a) => row(a, true))}</tbody>
          </table>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <History className="size-4" /> Previously attached
          </h3>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              {head}
              <tbody className="divide-y divide-border">{past.map((a) => row(a, false))}</tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attach a drive</DialogTitle>
          </DialogHeader>
          <form onSubmit={onAdd} className="space-y-4" id="attach-drive">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="serial">Drive serial *</Label>
                <Input id="serial" name="serial" required className="font-mono" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-manufacturer">Manufacturer</Label>
                <Input id="d-manufacturer" name="manufacturer" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-model">Model</Label>
                <Input id="d-model" name="model" />
              </div>
              <div className="space-y-1.5">
                <Label>Interface *</Label>
                <Select value={iface} onValueChange={setIface}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERFACES.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="capacity_gb">Capacity (GB)</Label>
                <Input id="capacity_gb" name="capacity_gb" type="number" min={1} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slot">Slot</Label>
                <Input id="slot" name="slot" placeholder="e.g. M.2 slot 1" />
              </div>
            </div>
            {iface === "unsupported_other" && (
              <p className="rounded-md bg-danger-soft p-2 text-sm text-danger">
                This interface is outside the supported scope and will be blocked from processing.
              </p>
            )}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" form="attach-drive" loading={busy}>
              Attach drive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!detach} onOpenChange={(v) => !v && setDetach(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach this drive?</AlertDialogTitle>
            <AlertDialogDescription>
              The drive record and its history with this laptop are kept. You can attach it to
              another device afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDetach}>Detach</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Diagnostics({ device: d }: { device: DeviceRow }) {
  const { role } = useOrg();
  const qc = useQueryClient();
  const canWrite = can(role, "inventory.write");
  const [busy, setBusy] = useState(false);
  const diag = useDiagnosticResults({ deviceId: d.id });
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pct = String(f.get("battery_health_pct") ?? "").trim();
    setBusy(true);
    const { error } = await supabase
      .from("devices")
      .update({
        battery_health_pct: pct ? Number(pct) : null,
        battery_notes: String(f.get("battery_notes") ?? "").trim() || null,
        diagnostic_notes: String(f.get("diagnostic_notes") ?? "").trim() || null,
      })
      .eq("id", d.id);
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success("Diagnostics saved");
    qc.invalidateQueries({ queryKey: ["device", d.id] });
  }
  return (
    <div className="space-y-4">
      <DiagnosticResultsCard results={diag.data} />
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-card"
      >
        <p className="text-sm text-muted-foreground">
          Optional technician observations. Not part of any erasure outcome.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="battery_health_pct">Battery health (%)</Label>
            <Input
              id="battery_health_pct"
              name="battery_health_pct"
              type="number"
              min={0}
              max={100}
              defaultValue={d.battery_health_pct ?? ""}
              disabled={!canWrite}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="battery_notes">Battery notes</Label>
            <Input
              id="battery_notes"
              name="battery_notes"
              defaultValue={d.battery_notes ?? ""}
              disabled={!canWrite}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="diagnostic_notes">Diagnostic observations</Label>
          <Textarea
            id="diagnostic_notes"
            name="diagnostic_notes"
            rows={4}
            defaultValue={d.diagnostic_notes ?? ""}
            disabled={!canWrite}
          />
        </div>
        {canWrite && (
          <Button type="submit" loading={busy}>
            Save diagnostics
          </Button>
        )}
      </form>
    </div>
  );
}

function Custody({ deviceId }: { deviceId: string }) {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const members = useMembers();
  const sites = useSites();
  const [note, setNote] = useState("");
  const events = useQuery({
    queryKey: ["custody", deviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custody_events")
        .select("*")
        .eq("device_id", deviceId)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const memberById = new Map((members.data ?? []).map((m) => [m.user_id, m]));
  const siteById = new Map((sites.data ?? []).map((s) => [s.id, s.name]));
  const pretty = (type: string, v: string | null) => {
    if (!v) return "—";
    if (type === "moved" || type === "received") return siteById.get(v) ?? "site";
    if (type === "assigned") return memberName(memberById.get(v));
    if (type.startsWith("drive_")) return "drive";
    return v.replace(/_/g, " ");
  };

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("custody_events").insert({
      org_id: orgId,
      device_id: deviceId,
      event_type: "note",
      notes: note.trim(),
      actor_id: u.user!.id,
    });
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    setNote("");
    qc.invalidateQueries({ queryKey: ["custody", deviceId] });
  }

  if (events.isLoading) return <LoadingBlock />;
  if (events.error) return <ErrorBlock error={events.error} />;
  return (
    <div className="space-y-4">
      {can(role, "inventory.write") && (
        <form onSubmit={addNote} className="flex gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a custody note…"
            maxLength={1000}
          />
          <Button type="submit" disabled={!note.trim()}>
            Add note
          </Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        Custody events are append-only. They are written automatically on intake and on status,
        site, technician and drive changes.
      </p>
      <ol className="relative space-y-0 border-l border-border pl-6">
        {events.data!.map((e) => (
          <li key={e.id} className="pb-5">
            <span
              className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-card bg-success"
              aria-hidden
            />
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium capitalize text-foreground">
                {e.event_type.replace(/_/g, " ")}
              </span>
              {(e.from_value || e.to_value) && e.event_type !== "note" && (
                <span className="text-sm text-muted-foreground">
                  {e.from_value && <>{pretty(e.event_type, e.from_value)} → </>}
                  {pretty(e.event_type, e.to_value)}
                </span>
              )}
            </div>
            {e.notes && <p className="mt-0.5 text-sm text-foreground">{e.notes}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground tabular">
              {formatDateTime(e.occurred_at)} ·{" "}
              {e.actor_id ? memberName(memberById.get(e.actor_id)) : "System"}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
