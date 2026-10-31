import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/nd/page";
import { ALL, FilterSelect } from "@/components/nd/filter-select";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDateTime, memberName, useMembers } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/app/audit")({
  component: Audit,
});

const ENTITY_TYPES = ["organizations", "memberships", "invitations", "sites", "clients", "projects", "client_access_grants", "batches", "devices", "drives", "device_drive_associations", "custody_events"];
const PAGE = 50;

function Audit() {
  const { orgId, role } = useOrg();
  const members = useMembers();
  const [entity, setEntity] = useState(ALL);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const events = useQuery({
    queryKey: ["audit", orgId, entity, page],
    enabled: can(role, "audit.view"),
    queryFn: async () => {
      let q = supabase.from("audit_events").select("*", { count: "exact" }).eq("org_id", orgId).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (entity !== ALL) q = q.eq("entity_type", entity);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data, count: count ?? 0 };
    },
  });
  const byId = new Map((members.data ?? []).map((m) => [m.user_id, m]));

  if (!can(role, "audit.view")) return <EmptyState icon={ScrollText} title="No access" description="Only owners, administrators and auditors can view audit history." />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Application audit events are written by the database and cannot be edited or deleted by any app user. This is append-only at the application level; it is not a tamper-proof ledger."
      />
      <FilterSelect label="Entity" value={entity} onChange={(v) => { setEntity(v); setPage(0); }} options={ENTITY_TYPES.map((e) => ({ value: e, label: e.replace(/_/g, " ") }))} className="w-60" />
      {events.isLoading ? (
        <LoadingBlock />
      ) : events.error ? (
        <ErrorBlock error={events.error} />
      ) : events.data!.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit events" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Time (local)</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.data!.rows.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 tabular text-muted-foreground">{formatDateTime(e.created_at)}</td>
                  <td className="px-4 py-2.5 text-foreground">{e.actor_id ? memberName(byId.get(e.actor_id)) : "System"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground">{e.action}</td>
                  <td className="px-4 py-2.5">
                    <button className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      {open === e.id ? "Hide" : "Show"}
                    </button>
                    {open === e.id && <pre className="mt-2 max-w-2xl overflow-x-auto rounded bg-muted p-2 font-mono text-xs text-foreground">{JSON.stringify(e.details, null, 2)}</pre>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= events.data!.count} onClick={() => setPage((p) => p + 1)}>Older</Button>
          </div>
        </div>
      )}
    </div>
  );
}
