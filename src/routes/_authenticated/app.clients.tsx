import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, errorMessage } from "@/components/nd/page";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { useClients, useProjects } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/app/clients")({
  component: Clients,
});

type Client = Tables<"clients">;

function Clients() {
  const { role } = useOrg();
  const clients = useClients();
  const projects = useProjects();
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const canManage = can(role, "clients.manage");
  const projectCount = new Map<string, number>();
  for (const p of projects.data ?? []) projectCount.set(p.client_id, (projectCount.get(p.client_id) ?? 0) + 1);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        description="The schools, companies and organizations whose equipment you process. Clients are not NextDrive accounts."
        actions={canManage && <Button onClick={() => setEditing("new")}><Plus /> New client</Button>}
      />
      {clients.isLoading ? (
        <LoadingBlock />
      ) : clients.error ? (
        <ErrorBlock error={clients.error} />
      ) : clients.data!.length === 0 ? (
        <EmptyState icon={Building} title="No clients yet" description="Add the first organization you process equipment for. If you process your own stock, add your own company." action={canManage && <Button onClick={() => setEditing("new")}><Plus /> New client</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Contact</th>
                <th className="px-4 py-2.5 text-right font-medium">Projects</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.data!.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-medium text-foreground">{c.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{[c.contact_name, c.contact_email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular">{projectCount.get(c.id) ?? 0}</td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage && <Button variant="ghost" size="sm" onClick={() => setEditing(c)}><Pencil /> Edit</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ClientDialog client={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ClientDialog({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const values = { name: s("name") ?? "", contact_name: s("contact_name"), contact_email: s("contact_email"), notes: s("notes") };
    setBusy(true);
    const { error } = client
      ? await supabase.from("clients").update(values).eq("id", client.id)
      : await supabase.from("clients").insert({ ...values, org_id: orgId });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "A client with that name already exists" : errorMessage(error));
    toast.success(client ? "Client updated" : "Client added");
    qc.invalidateQueries({ queryKey: ["clients", orgId] });
    onClose();
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
          <DialogDescription>Client contact details are private to your organization.</DialogDescription>
        </DialogHeader>
        <form id="client-form" onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="c-name">Name *</Label><Input id="c-name" name="name" required maxLength={160} defaultValue={client?.name} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="c-contact">Contact name</Label><Input id="c-contact" name="contact_name" defaultValue={client?.contact_name ?? ""} /></div>
            <div className="space-y-1.5"><Label htmlFor="c-email">Contact email</Label><Input id="c-email" name="contact_email" type="email" defaultValue={client?.contact_email ?? ""} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="c-notes">Notes</Label><Textarea id="c-notes" name="notes" rows={3} defaultValue={client?.notes ?? ""} /></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="client-form" disabled={busy}>{client ? "Save" : "Add client"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
