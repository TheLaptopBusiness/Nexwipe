import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Activity,
  AlertOctagon,
  Boxes,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  Coins,
  FolderKanban,
  Inbox,
  Server,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, StatCard } from "@/components/nd/page";
import { ALL, FilterSelect } from "@/components/nd/filter-select";
import { PROJECT_STATUS, StatusBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDateTime, memberName, useClients, useMembers, useProjects, useSites } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/app/")({
  component: Dashboard,
});

function Dashboard() {
  const { role } = useOrg();
  if (role === "customer_viewer") return <ViewerHome />;
  return <StaffDashboard />;
}

function StaffDashboard() {
  const { orgId, role, current } = useOrg();
  const sites = useSites();
  const clients = useClients();
  const projects = useProjects();
  const members = useMembers();
  const [site, setSite] = useState(ALL);
  const [client, setClient] = useState(ALL);
  const [project, setProject] = useState(ALL);
  const [tech, setTech] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters = { site, client, project, tech, from, to };
  const counts = useQuery({
    queryKey: ["dashboard-counts", orgId, filters],
    queryFn: async () => {
      const base = () => {
        let q = supabase.from("devices").select("id", { count: "exact", head: true }).eq("org_id", orgId);
        if (site !== ALL) q = q.eq("site_id", site);
        if (client !== ALL) q = q.eq("client_id", client);
        if (project !== ALL) q = q.eq("project_id", project);
        if (tech !== ALL) q = q.eq("assigned_technician", tech);
        if (from) q = q.gte("received_at", new Date(from).toISOString());
        if (to) q = q.lt("received_at", new Date(new Date(to).getTime() + 86400000).toISOString());
        return q;
      };
      const [total, quarantined, released, manual] = await Promise.all([
        base(),
        base().eq("status", "quarantined"),
        base().eq("status", "released"),
        base().eq("status", "referred_manual"),
      ]);
      for (const r of [total, quarantined, released, manual]) if (r.error) throw r.error;
      return {
        total: total.count ?? 0,
        quarantined: quarantined.count ?? 0,
        released: released.count ?? 0,
        manual: manual.count ?? 0,
      };
    },
  });

  const activity = useQuery({
    queryKey: ["recent-custody", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custody_events")
        .select("id, event_type, from_value, to_value, occurred_at, actor_id, devices(id, asset_tag)")
        .eq("org_id", orgId)
        .order("occurred_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data;
    },
  });

  const memberById = new Map((members.data ?? []).map((m) => [m.user_id, m]));
  const noData = counts.data?.total === 0 && !site && client === ALL;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Operations overview for ${current.org.name}.`}
        actions={
          can(role, "inventory.write") && (
            <Button asChild>
              <Link to="/app/inventory" search={{ intake: true }}>
                <Inbox /> Receive devices
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap gap-2">
        <FilterSelect label="Site" value={site} onChange={setSite} options={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect label="Client" value={client} onChange={setClient} options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label="Project" value={project} onChange={setProject} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        <FilterSelect
          label="Technician"
          value={tech}
          onChange={setTech}
          options={(members.data ?? []).filter((m) => m.status === "active" && m.role !== "customer_viewer").map((m) => ({ value: m.user_id, label: memberName(m) }))}
        />
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="Received from" />
          <span className="text-muted-foreground">–</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="Received to" />
        </div>
      </div>

      {counts.error ? (
        <ErrorBlock error={counts.error} />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground">Inventory</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Devices received" value={counts.data?.total ?? "…"} icon={Boxes} />
              <StatCard label="Quarantined" value={counts.data?.quarantined ?? "…"} icon={ShieldAlert} />
              <StatCard label="Manual assessment" value={counts.data?.manual ?? "…"} icon={CircleHelp} />
              <StatCard label="Released" value={counts.data?.released ?? "…"} icon={CheckCircle2} />
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Erasure jobs</h2>
              <span className="rounded border border-border px-1.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                Available after Phase 2
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard muted label="Active jobs" value="—" icon={Activity} hint="Job engine not built yet" />
              <StatCard muted label="Completed & approved" value="—" icon={CheckCircle2} hint="Job engine not built yet" />
              <StatCard muted label="Failed" value="—" icon={XCircle} hint="Job engine not built yet" />
              <StatCard muted label="Interrupted / unverified" value="—" icon={AlertOctagon} hint="Job engine not built yet" />
              <StatCard muted label="Awaiting review" value="—" icon={ClipboardList} hint="Review workflow: Phase 3" />
              <StatCard muted label="Online agents" value="—" icon={Server} hint="Agent API: Phase 2" />
              <StatCard muted label="Available credits" value="—" icon={Coins} hint="Billing: Phase 4" />
            </div>
          </section>
        </>
      )}

      <section className="rounded-lg border border-border bg-card shadow-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Recent custody activity</h2>
        </div>
        {activity.isLoading ? (
          <div className="px-4"><LoadingBlock /></div>
        ) : activity.error ? (
          <div className="p-4"><ErrorBlock error={activity.error} /></div>
        ) : (activity.data ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Inbox}
              title={noData ? "No devices yet" : "No activity yet"}
              description="Receive your first device and its custody trail will start here."
              className="border-0"
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activity.data!.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-36 shrink-0 text-xs text-muted-foreground tabular">{formatDateTime(e.occurred_at)}</span>
                {e.devices ? (
                  <Link to="/app/inventory/$deviceId" params={{ deviceId: e.devices.id }} className="font-mono text-foreground hover:underline">
                    {e.devices.asset_tag}
                  </Link>
                ) : null}
                <span className="text-foreground">{e.event_type.replace(/_/g, " ")}</span>
                {e.to_value && e.event_type === "status_changed" && (
                  <span className="text-muted-foreground">→ {e.to_value.replace(/_/g, " ")}</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">{memberName(memberById.get(e.actor_id ?? ""))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ViewerHome() {
  const projects = useProjects();
  return (
    <div className="space-y-6">
      <PageHeader title="Your projects" description="Projects your service provider has shared with you." />
      {projects.isLoading ? (
        <LoadingBlock />
      ) : projects.error ? (
        <ErrorBlock error={projects.error} />
      ) : (projects.data ?? []).length === 0 ? (
        <EmptyState icon={FolderKanban} title="Nothing shared yet" description="When a project is shared with you, it will appear here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.data!.map((p) => (
            <Link key={p.id} to="/app/projects/$projectId" params={{ projectId: p.id }} className="rounded-lg border border-border bg-card p-5 shadow-card hover:border-ring">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-foreground">{p.name}</h3>
                <StatusBadge map={PROJECT_STATUS} value={p.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{p.clients?.name}</p>
            </Link>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground">Approved erasure records will appear here once reporting is available.</p>
    </div>
  );
}
