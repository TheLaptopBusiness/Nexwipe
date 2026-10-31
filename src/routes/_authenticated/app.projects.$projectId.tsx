import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Eye, FolderKanban, Layers, Plus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, StatCard, errorMessage } from "@/components/nd/page";
import { BATCH_STATUS, DEVICE_STATUS, PROJECT_STATUS, StatusBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDate, memberName, useBatchCounts, useBatches, useMembers, useProjectCounts } from "@/lib/queries";
import { Boxes, CheckCircle2, PackageCheck, ShieldAlert, Target } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/projects/$projectId")({
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const staff = role !== "customer_viewer";
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*, clients(name), sites(name)").eq("id", projectId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const counts = useProjectCounts();

  if (project.isLoading) return <LoadingBlock />;
  if (project.error) return <ErrorBlock error={project.error} />;
  if (!project.data)
    return <EmptyState icon={FolderKanban} title="Project not found" description="It may not exist or may not be shared with you." action={<Button asChild variant="outline"><Link to="/app/projects">Back to projects</Link></Button>} />;

  const p = project.data;
  const c = counts.data?.get(p.id);

  async function setStatus(status: string) {
    const { error } = await supabase.from("projects").update({ status: status as never }).eq("id", p.id).eq("org_id", orgId);
    if (error) return toast.error(errorMessage(error));
    qc.invalidateQueries({ queryKey: ["project", p.id] });
    qc.invalidateQueries({ queryKey: ["projects", orgId] });
  }

  return (
    <div className="space-y-6">
      <Link to="/app/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Projects
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="text-sm text-muted-foreground">{p.clients?.name}{p.reference && <> · <Mono>{p.reference}</Mono></>}</p>
          <h1 className="text-2xl font-semibold text-foreground">{p.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {p.sites?.name ?? "Any site"} · {formatDate(p.starts_on)} – {formatDate(p.due_on)}
          </p>
        </div>
        {can(role, "projects.manage") ? (
          <Select value={p.status} onValueChange={setStatus}>
            <SelectTrigger className="w-44" aria-label="Project status"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(PROJECT_STATUS).map(([v, m]) => <SelectItem key={v} value={v}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : (
          <StatusBadge map={PROJECT_STATUS} value={p.status} />
        )}
      </div>

      {staff && (
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Expected" value={p.expected_device_count ?? "—"} icon={Target} />
          <StatCard label="Received" value={c?.received ?? 0} icon={Boxes} />
          <StatCard label="Processed" value={c?.processed ?? 0} icon={CheckCircle2} />
          <StatCard label="Quarantined" value={c?.quarantined ?? 0} icon={ShieldAlert} />
          <StatCard label="Released" value={c?.released ?? 0} icon={PackageCheck} />
        </div>
      )}
      {p.notes && <p className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm text-foreground">{p.notes}</p>}

      <Batches projectId={p.id} />
      {staff && <ProjectDevices projectId={p.id} />}
      {can(role, "team.manage") && <ViewerGrants projectId={p.id} />}
      {!staff && <p className="text-sm text-muted-foreground">Approved erasure records for this project will appear here once reporting is available.</p>}
    </div>
  );
}

function Batches({ projectId }: { projectId: string }) {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const batches = useBatches(projectId);
  const counts = useBatchCounts();
  const [name, setName] = useState("");
  const canManage = can(role, "batches.manage");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("batches").insert({ org_id: orgId, project_id: projectId, name: name.trim() });
    if (error) return toast.error(error.code === "23505" ? "A batch with that name already exists in this project" : errorMessage(error));
    setName("");
    qc.invalidateQueries({ queryKey: ["batches", orgId] });
  }
  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("batches").update({ status: status as never }).eq("id", id);
    if (error) return toast.error(errorMessage(error));
    qc.invalidateQueries({ queryKey: ["batches", orgId] });
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Layers className="size-4" /> Batches</h2>
        {canManage && (
          <form onSubmit={create} className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New batch name" className="h-8 w-56" maxLength={120} />
            <Button size="sm" type="submit" disabled={!name.trim()}><Plus /> Add</Button>
          </form>
        )}
      </div>
      {batches.isLoading ? (
        <div className="px-4"><LoadingBlock /></div>
      ) : (batches.data ?? []).length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No batches yet. Batches are optional groupings of devices processed together.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Batch</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Received</th>
              <th className="px-4 py-2 text-right font-medium">Processed</th>
              <th className="px-4 py-2 text-right font-medium">Quarantined</th>
              <th className="px-4 py-2 text-right font-medium">Released</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {batches.data!.map((b) => {
              const c = counts.data?.get(b.id);
              return (
                <tr key={b.id}>
                  <td className="px-4 py-2 font-medium text-foreground">{b.name}</td>
                  <td className="px-4 py-2">
                    {canManage ? (
                      <Select value={b.status} onValueChange={(v) => setStatus(b.id, v)}>
                        <SelectTrigger className="h-8 w-36" aria-label={`Status of ${b.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(BATCH_STATUS).map(([v, m]) => <SelectItem key={v} value={v}>{m.label}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : (
                      <StatusBadge map={BATCH_STATUS} value={b.status} />
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular">{c?.received ?? 0}</td>
                  <td className="px-4 py-2 text-right tabular">{c?.processed ?? 0}</td>
                  <td className="px-4 py-2 text-right tabular">{c?.quarantined ?? 0}</td>
                  <td className="px-4 py-2 text-right tabular">{c?.released ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ProjectDevices({ projectId }: { projectId: string }) {
  const { orgId } = useOrg();
  const devices = useQuery({
    queryKey: ["devices", orgId, "project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devices")
        .select("id, asset_tag, manufacturer, model, system_serial, status, batches(name)")
        .eq("org_id", orgId)
        .eq("project_id", projectId)
        .order("received_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
  return (
    <section className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Boxes className="size-4" /> Devices in this project</h2>
        <Button asChild size="sm" variant="outline"><Link to="/app/inventory" search={{ intake: true }}>Receive devices</Link></Button>
      </div>
      {devices.isLoading ? (
        <div className="px-4"><LoadingBlock /></div>
      ) : (devices.data ?? []).length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No devices received for this project yet.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {devices.data!.map((d) => (
              <tr key={d.id} className="hover:bg-muted/40">
                <td className="px-4 py-2"><Link to="/app/inventory/$deviceId" params={{ deviceId: d.id }} className="font-mono font-medium text-foreground hover:underline">{d.asset_tag}</Link></td>
                <td className="px-4 py-2 text-foreground">{[d.manufacturer, d.model].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-4 py-2"><Mono className="text-muted-foreground">{d.system_serial ?? "—"}</Mono></td>
                <td className="px-4 py-2 text-muted-foreground">{d.batches?.name ?? "—"}</td>
                <td className="px-4 py-2"><StatusBadge map={DEVICE_STATUS} value={d.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ViewerGrants({ projectId }: { projectId: string }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const members = useMembers();
  const [user, setUser] = useState("");
  const grants = useQuery({
    queryKey: ["grants", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("client_access_grants").select("*").eq("project_id", projectId).is("revoked_at", null);
      if (error) throw error;
      return data;
    },
  });
  const viewers = (members.data ?? []).filter((m) => m.role === "customer_viewer" && m.status === "active");
  const granted = new Set((grants.data ?? []).map((g) => g.user_id));
  const byId = new Map((members.data ?? []).map((m) => [m.user_id, m]));

  async function grant() {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("client_access_grants").insert({ org_id: orgId, project_id: projectId, user_id: user, granted_by: u.user!.id });
    if (error) return toast.error(errorMessage(error));
    setUser("");
    qc.invalidateQueries({ queryKey: ["grants", projectId] });
  }
  async function revoke(id: string) {
    const { error } = await supabase.from("client_access_grants").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(errorMessage(error));
    qc.invalidateQueries({ queryKey: ["grants", projectId] });
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Eye className="size-4" /> Customer viewer access</h2>
        <div className="flex gap-2">
          <Select value={user} onValueChange={setUser}>
            <SelectTrigger className="h-8 w-56" aria-label="Customer viewer"><SelectValue placeholder={viewers.length ? "Choose a customer viewer" : "No customer viewers in team"} /></SelectTrigger>
            <SelectContent>
              {viewers.filter((v) => !granted.has(v.user_id)).map((v) => <SelectItem key={v.user_id} value={v.user_id}>{memberName(v)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={grant} disabled={!user}>Grant access</Button>
        </div>
      </div>
      {(grants.data ?? []).length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Not shared with anyone. Invite a customer viewer from Team, then grant them this project.</p>
      ) : (
        <ul className="divide-y divide-border">
          {grants.data!.map((g) => (
            <li key={g.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-foreground">{memberName(byId.get(g.user_id))}</span>
              <Button size="sm" variant="ghost" onClick={() => revoke(g.id)}><UserMinus /> Revoke</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
