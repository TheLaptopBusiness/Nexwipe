import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FolderKanban, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, errorMessage } from "@/components/nd/page";
import { PROJECT_STATUS, StatusBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDate, useClients, useProjectCounts, useProjects, useSites } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/app/projects/")({
  component: Projects,
});

function Projects() {
  const { role } = useOrg();
  const projects = useProjects();
  const counts = useProjectCounts();
  const [open, setOpen] = useState(false);
  const canManage = can(role, "projects.manage");
  const staff = role !== "customer_viewer";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects & batches"
        description="A project is work for one client. Batches group devices processed together."
        actions={canManage && <Button onClick={() => setOpen(true)}><Plus /> New project</Button>}
      />
      {projects.isLoading ? (
        <LoadingBlock />
      ) : projects.error ? (
        <ErrorBlock error={projects.error} />
      ) : projects.data!.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description={canManage ? "Create a client first, then a project for the work you’re doing for them." : "No projects have been shared with you."}
          action={canManage && <Button onClick={() => setOpen(true)}><Plus /> New project</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                {staff && (
                  <>
                    <th className="px-4 py-2.5 text-right font-medium">Expected</th>
                    <th className="px-4 py-2.5 text-right font-medium">Received</th>
                    <th className="px-4 py-2.5 text-right font-medium">Processed</th>
                    <th className="px-4 py-2.5 text-right font-medium">Quarantined</th>
                    <th className="px-4 py-2.5 text-right font-medium">Released</th>
                  </>
                )}
                <th className="px-4 py-2.5 font-medium">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projects.data!.map((p) => {
                const c = counts.data?.get(p.id);
                return (
                  <tr key={p.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link to="/app/projects/$projectId" params={{ projectId: p.id }} className="font-medium text-foreground hover:underline">{p.name}</Link>
                      {p.reference && <span className="block font-mono text-xs text-muted-foreground">{p.reference}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.clients?.name}</td>
                    <td className="px-4 py-2.5"><StatusBadge map={PROJECT_STATUS} value={p.status} /></td>
                    {staff && (
                      <>
                        <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{p.expected_device_count ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular text-foreground">{c?.received ?? 0}</td>
                        <td className="px-4 py-2.5 text-right tabular text-foreground">{c?.processed ?? 0}</td>
                        <td className="px-4 py-2.5 text-right tabular text-foreground">{c?.quarantined ?? 0}</td>
                        <td className="px-4 py-2.5 text-right tabular text-foreground">{c?.released ?? 0}</td>
                      </>
                    )}
                    <td className="px-4 py-2.5 tabular text-muted-foreground">{formatDate(p.due_on)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ProjectDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

const NONE = "__none";

function ProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const clients = useClients();
  const sites = useSites();
  const [client, setClient] = useState("");
  const [site, setSite] = useState(NONE);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!client) { toast.error("Choose a client"); return; }
    const f = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const expected = s("expected_device_count");
    setBusy(true);
    const { error } = await supabase.from("projects").insert({
      org_id: orgId,
      client_id: client,
      site_id: site === NONE ? null : site,
      name: s("name") ?? "",
      reference: s("reference"),
      expected_device_count: expected ? Number(expected) : null,
      starts_on: s("starts_on"),
      due_on: s("due_on"),
      notes: s("notes"),
      status: "active",
    });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Project created");
    qc.invalidateQueries({ queryKey: ["projects", orgId] });
    onOpenChange(false);
  }

  const noClients = clients.data && clients.data.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Work your organization is doing for one downstream client.</DialogDescription>
        </DialogHeader>
        {noClients ? (
          <div className="text-sm text-muted-foreground">
            Add a client first.{" "}
            <Link to="/app/clients" className="font-medium text-foreground underline underline-offset-4">Go to clients</Link>
          </div>
        ) : (
          <form id="project-form" onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="p-name">Project name *</Label><Input id="p-name" name="name" required maxLength={160} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Client *</Label>
                <Select value={client} onValueChange={setClient}>
                  <SelectTrigger><SelectValue placeholder="Choose a client" /></SelectTrigger>
                  <SelectContent>{(clients.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Site</Label>
                <Select value={site} onValueChange={setSite}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any site</SelectItem>
                    {(sites.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="p-ref">Reference / PO</Label><Input id="p-ref" name="reference" /></div>
              <div className="space-y-1.5"><Label htmlFor="p-exp">Expected devices</Label><Input id="p-exp" name="expected_device_count" type="number" min={0} /></div>
              <div className="space-y-1.5"><Label htmlFor="p-start">Starts</Label><Input id="p-start" name="starts_on" type="date" /></div>
              <div className="space-y-1.5"><Label htmlFor="p-due">Due</Label><Input id="p-due" name="due_on" type="date" /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="p-notes">Notes</Label><Textarea id="p-notes" name="notes" rows={2} /></div>
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!noClients && <Button type="submit" form="project-form" loading={busy}>Create project</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
