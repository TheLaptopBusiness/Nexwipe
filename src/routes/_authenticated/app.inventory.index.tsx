import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Boxes, Download, FileUp, Inbox, ScanBarcode, Search, ShieldQuestion, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, PageHeader, errorMessage } from "@/components/nd/page";
import { ALL, FilterSelect } from "@/components/nd/filter-select";
import { DEVICE_STATUS, StatusBadge, ToneBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDate, useBatches, useClients, useProjects, useSites } from "@/lib/queries";
import { DEVICE_CSV_COLUMNS, toCsv, validateDeviceCsv, type ImportResult } from "@/lib/csv";
import { manufacturerInScope } from "@/lib/hardware";

export const Route = createFileRoute("/_authenticated/app/inventory/")({
  validateSearch: (s: Record<string, unknown>) => ({ intake: s.intake === true || s.intake === "true" ? true : undefined }),
  component: Inventory,
});

const PAGE = 100;
const NONE = "__none";
const CONDITIONS = [
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "damaged", label: "Damaged" },
  { value: "missing_parts", label: "Missing parts" },
  { value: "unknown", label: "Unknown" },
];

function Inventory() {
  const { orgId, role } = useOrg();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const sites = useSites();
  const clients = useClients();
  const projects = useProjects();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [site, setSite] = useState(ALL);
  const [client, setClient] = useState(ALL);
  const [project, setProject] = useState(ALL);
  const [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const canWrite = can(role, "inventory.write");
  const intakeOpen = !!search.intake && canWrite;

  useEffect(() => setPage(0), [q, status, site, client, project]);

  const filters = { q, status, site, client, project, page };
  const list = useQuery({
    queryKey: ["devices", orgId, filters],
    queryFn: async () => {
      let query = supabase
        .from("devices")
        .select("id, asset_tag, manufacturer, model, system_serial, status, hardware_verified, source, received_at, intake_condition, sites(name), clients(name), projects(name)", { count: "exact" })
        .eq("org_id", orgId)
        .order("received_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      const term = q.trim().replace(/[%,()]/g, "");
      if (term) query = query.or(`asset_tag.ilike.%${term}%,system_serial.ilike.%${term}%,model.ilike.%${term}%,manufacturer.ilike.%${term}%`);
      if (status !== ALL) query = query.eq("status", status as never);
      if (site !== ALL) query = query.eq("site_id", site);
      if (client !== ALL) query = query.eq("client_id", client);
      if (project !== ALL) query = query.eq("project_id", project);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, count: count ?? 0 };
    },
  });

  async function exportCsv() {
    const { data, error } = await supabase
      .from("devices")
      .select("asset_tag, manufacturer, model, system_serial, cpu, ram_gb, status, intake_condition, hardware_verified, source, received_at, notes, sites(name), clients(name), projects(name)")
      .eq("org_id", orgId)
      .order("received_at", { ascending: false })
      .limit(5000);
    if (error) return toast.error(errorMessage(error));
    const headers = ["asset_tag", "manufacturer", "model", "system_serial", "cpu", "ram_gb", "status", "intake_condition", "hardware_verified", "source", "received_at", "site", "client", "project", "notes"];
    const csv = toCsv(
      headers,
      data.map((d) => [d.asset_tag, d.manufacturer, d.model, d.system_serial, d.cpu, d.ram_gb, d.status, d.intake_condition, d.hardware_verified, d.source, d.received_at, d.sites?.name, d.clients?.name, d.projects?.name, d.notes]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `nextdrive-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const total = list.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Device inventory"
        description="Laptops received for processing. Hardware identity is verified only when reported by the agent."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              <Download /> Export CSV
            </Button>
            {canWrite && (
              <>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <FileUp /> Import CSV
                </Button>
                <Button onClick={() => navigate({ to: "/app/inventory", search: { intake: true } })}>
                  <ScanBarcode /> Receive devices
                </Button>
              </>
            )}
          </>
        }
      />

      {intakeOpen && <QuickIntake onClose={() => navigate({ to: "/app/inventory", search: {} })} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Asset tag, serial, model…" className="pl-9" aria-label="Search devices" />
        </div>
        <FilterSelect label="Status" value={status} onChange={setStatus} options={Object.entries(DEVICE_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
        <FilterSelect label="Site" value={site} onChange={setSite} options={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect label="Client" value={client} onChange={setClient} options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label="Project" value={project} onChange={setProject} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.error ? (
        <ErrorBlock error={list.error} />
      ) : total === 0 ? (
        <EmptyState
          icon={Boxes}
          title={q || status !== ALL || site !== ALL || client !== ALL || project !== ALL ? "No devices match these filters" : "No devices yet"}
          description="Scan or type an asset tag to receive a device, or import a CSV manifest."
          action={canWrite && <Button onClick={() => navigate({ to: "/app/inventory", search: { intake: true } })}><Inbox /> Receive devices</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Asset tag</th>
                  <th className="px-4 py-2.5 font-medium">Device</th>
                  <th className="px-4 py-2.5 font-medium">System serial</th>
                  <th className="px-4 py-2.5 font-medium">Client / project</th>
                  <th className="px-4 py-2.5 font-medium">Site</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Identity</th>
                  <th className="px-4 py-2.5 font-medium">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data!.rows.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link to="/app/inventory/$deviceId" params={{ deviceId: d.id }} className="font-mono font-medium text-foreground hover:underline">
                        {d.asset_tag}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {[d.manufacturer, d.model].filter(Boolean).join(" ") || <span className="text-muted-foreground">—</span>}
                      {d.manufacturer && !manufacturerInScope(d.manufacturer) && (
                        <span className="ml-2 align-middle"><ToneBadge tone="warning" icon={ShieldQuestion}>Out of scope</ToneBadge></span>
                      )}
                    </td>
                    <td className="px-4 py-2.5"><Mono className="text-muted-foreground">{d.system_serial ?? "—"}</Mono></td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {d.clients?.name ?? "—"}
                      {d.projects?.name && <span className="block text-xs">{d.projects.name}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{d.sites?.name ?? "—"}</td>
                    <td className="px-4 py-2.5"><StatusBadge map={DEVICE_STATUS} value={d.status} /></td>
                    <td className="px-4 py-2.5">
                      {d.hardware_verified ? (
                        <ToneBadge tone="success">Agent verified</ToneBadge>
                      ) : (
                        <ToneBadge tone="neutral">{d.source === "csv_import" ? "CSV · unverified" : "Manual · unverified"}</ToneBadge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular">{formatDate(d.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
            <span className="tabular">{total.toLocaleString()} devices</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="tabular">Page {page + 1} of {pages}</span>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </div>
      )}

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function useAssignmentState() {
  const [site, setSite] = useState(NONE);
  const [project, setProject] = useState(NONE);
  const [batch, setBatch] = useState(NONE);
  return { site, setSite, project, setProject, batch, setBatch };
}

function AssignmentFields({ state }: { state: ReturnType<typeof useAssignmentState> }) {
  const sites = useSites();
  const projects = useProjects();
  const batches = useBatches(state.project !== NONE ? state.project : undefined);
  return (
    <>
      <div className="space-y-1.5">
        <Label>Site</Label>
        <Select value={state.site} onValueChange={state.setSite}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No site</SelectItem>
            {(sites.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Project (sets client)</Label>
        <Select value={state.project} onValueChange={(v) => { state.setProject(v); state.setBatch(NONE); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No project</SelectItem>
            {(projects.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.clients?.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Batch</Label>
        <Select value={state.batch} onValueChange={state.setBatch} disabled={state.project === NONE}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No batch</SelectItem>
            {(batches.data ?? []).filter((b) => b.status !== "closed").map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function assignmentValues(state: ReturnType<typeof useAssignmentState>) {
  return {
    site_id: state.site === NONE ? null : state.site,
    project_id: state.project === NONE ? null : state.project,
    batch_id: state.batch === NONE ? null : state.batch,
  };
}

function QuickIntake({ onClose }: { onClose: () => void }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const assign = useAssignmentState();
  const [condition, setCondition] = useState("unknown");
  const [received, setReceived] = useState<string[]>([]);
  const tagRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => tagRef.current?.focus(), []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const s = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const tag = s("asset_tag");
    if (!tag) return;
    setBusy(true);
    const { error } = await supabase.from("devices").insert({
      org_id: orgId,
      asset_tag: tag,
      manufacturer: s("manufacturer"),
      model: s("model"),
      system_serial: s("system_serial"),
      intake_condition: condition as never,
      ...assignmentValues(assign),
      source: "manual",
    });
    setBusy(false);
    if (error) {
      toast.error(error.code === "23505" ? `Asset tag ${tag} already exists` : errorMessage(error));
      tagRef.current?.select();
      return;
    }
    setReceived((r) => [tag, ...r].slice(0, 8));
    (form.elements.namedItem("asset_tag") as HTMLInputElement).value = "";
    (form.elements.namedItem("system_serial") as HTMLInputElement).value = "";
    tagRef.current?.focus();
    qc.invalidateQueries({ queryKey: ["devices", orgId] });
  }

  return (
    <div className="rounded-lg border-2 border-success/40 bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanBarcode className="size-5 text-success" aria-hidden />
          <h2 className="font-semibold text-foreground">Receive devices</h2>
          <span className="text-sm text-muted-foreground">Scan an asset tag and press Enter. Site, project and batch stay set between scans.</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close intake"><X /></Button>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div className="space-y-1.5 md:col-span-1 xl:col-span-2">
          <Label htmlFor="asset_tag">Asset tag *</Label>
          <Input ref={tagRef} id="asset_tag" name="asset_tag" required maxLength={64} autoComplete="off" className="h-11 font-mono text-base" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="system_serial">System serial</Label>
          <Input id="system_serial" name="system_serial" autoComplete="off" className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manufacturer">Manufacturer</Label>
          <Input id="manufacturer" name="manufacturer" list="nd-manufacturers" />
          <datalist id="nd-manufacturers"><option value="Dell" /><option value="HP" /><option value="Lenovo" /></datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="model">Model</Label>
          <Input id="model" name="model" />
        </div>
        <div className="space-y-1.5">
          <Label>Intake condition</Label>
          <Select value={condition} onValueChange={setCondition}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CONDITIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <AssignmentFields state={assign} />
        <div className="flex items-end">
          <Button type="submit" disabled={busy} className="w-full"><Inbox /> Receive</Button>
        </div>
      </form>
      {received.length > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Received this session: {received.map((t) => <Mono key={t} className="mr-2 text-foreground">{t}</Mono>)}
        </p>
      )}
    </div>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const assign = useAssignmentState();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    if (file.size > 2_000_000) return toast.error("File is larger than 2 MB");
    setResult(validateDeviceCsv(await file.text()));
  }

  async function onImport() {
    if (!result?.rows.length) return;
    setBusy(true);
    const extra = assignmentValues(assign);
    const payload = result.rows.map((r) => ({
      org_id: orgId,
      asset_tag: r.asset_tag,
      manufacturer: r.manufacturer,
      model: r.model,
      system_serial: r.system_serial,
      intake_condition: r.intake_condition,
      notes: r.notes,
      source: "csv_import" as const,
      ...(r.received_at ? { received_at: r.received_at } : {}),
      ...extra,
    }));
    let inserted = 0;
    for (let i = 0; i < payload.length; i += 200) {
      const { error } = await supabase.from("devices").insert(payload.slice(i, i + 200));
      if (error) {
        setBusy(false);
        toast.error(`Stopped after ${inserted} rows: ${error.code === "23505" ? "an asset tag already exists in inventory" : errorMessage(error)}`);
        qc.invalidateQueries({ queryKey: ["devices", orgId] });
        return;
      }
      inserted += Math.min(200, payload.length - i);
    }
    setBusy(false);
    toast.success(`Imported ${inserted} devices as unverified`);
    qc.invalidateQueries({ queryKey: ["devices", orgId] });
    setResult(null);
    onOpenChange(false);
  }

  function template() {
    const csv = toCsv([...DEVICE_CSV_COLUMNS], [["UTS-10001", "Dell", "Latitude 5420", "ABC1234", "good", "2026-10-30", ""]]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "nextdrive-device-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setResult(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import devices from CSV</DialogTitle>
          <DialogDescription>
            Columns: {DEVICE_CSV_COLUMNS.join(", ")}. Only asset_tag is required. Imported rows are recorded as{" "}
            <strong>unverified</strong> — a CSV row is never treated as verified hardware.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input type="file" accept=".csv,text/csv" className="max-w-xs" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button variant="link" size="sm" onClick={template}>Download template</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3"><AssignmentFields state={assign} /></div>
          {result && (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="text-foreground"><strong>{result.rows.length}</strong> valid rows, <strong>{result.issues.length}</strong> issues</p>
              {result.issues.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-danger">
                  {result.issues.slice(0, 50).map((i, n) => <li key={n}>Line {i.line}: {i.message}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onImport} disabled={busy || !result?.rows.length || result.issues.length > 0}>
            {busy ? "Importing…" : `Import ${result?.rows.length ?? 0} devices`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
