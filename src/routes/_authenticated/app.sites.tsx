import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MapPin, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, PageHeader, errorMessage } from "@/components/nd/page";
import { ToneBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { useSites } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/app/sites")({
  component: Sites,
});

type Site = Tables<"sites">;

function Sites() {
  const { role } = useOrg();
  const sites = useSites();
  const [editing, setEditing] = useState<Site | "new" | null>(null);
  const canManage = can(role, "sites.manage");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Sites"
        description="Physical locations where devices are received and processed."
        actions={canManage && <Button onClick={() => setEditing("new")}><Plus /> New site</Button>}
      />
      {sites.isLoading ? (
        <LoadingBlock />
      ) : sites.error ? (
        <ErrorBlock error={sites.error} />
      ) : sites.data!.length === 0 ? (
        <EmptyState icon={MapPin} title="No sites yet" description="Add your warehouse or processing location." action={canManage && <Button onClick={() => setEditing("new")}><Plus /> New site</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sites.data!.map((s) => (
            <div key={s.id} className="rounded-lg border border-border bg-card p-5 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-foreground">{s.name}</h3>
                  {s.code && <Mono className="text-muted-foreground">{s.code}</Mono>}
                </div>
                {s.is_active ? <ToneBadge tone="success">Active</ToneBadge> : <ToneBadge tone="neutral">Inactive</ToneBadge>}
              </div>
              <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{s.address || "No address"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Timezone: {s.timezone}</p>
              {canManage && <Button variant="outline" size="sm" className="mt-4" onClick={() => setEditing(s)}><Pencil /> Edit</Button>}
            </div>
          ))}
        </div>
      )}
      {editing && <SiteDialog site={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SiteDialog({ site, onClose }: { site: Site | null; onClose: () => void }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const [active, setActive] = useState(site?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const values = { name: s("name") ?? "", code: s("code"), address: s("address"), timezone: s("timezone") ?? "UTC", is_active: active };
    setBusy(true);
    const { error } = site ? await supabase.from("sites").update(values).eq("id", site.id) : await supabase.from("sites").insert({ ...values, org_id: orgId });
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "A site with that name already exists" : errorMessage(error));
    toast.success(site ? "Site updated" : "Site added");
    qc.invalidateQueries({ queryKey: ["sites", orgId] });
    onClose();
  }
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{site ? "Edit site" : "New site"}</DialogTitle></DialogHeader>
        <form id="site-form" onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5"><Label htmlFor="s-name">Name *</Label><Input id="s-name" name="name" required maxLength={120} defaultValue={site?.name} /></div>
            <div className="space-y-1.5"><Label htmlFor="s-code">Code</Label><Input id="s-code" name="code" className="font-mono" defaultValue={site?.code ?? ""} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="s-address">Address</Label><Input id="s-address" name="address" defaultValue={site?.address ?? ""} /></div>
          <div className="space-y-1.5"><Label htmlFor="s-tz">Timezone</Label><Input id="s-tz" name="timezone" defaultValue={site?.timezone ?? tz} /></div>
          <label className="flex items-center gap-3 text-sm text-foreground"><Switch checked={active} onCheckedChange={setActive} /> Active</label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="site-form" disabled={busy}>{site ? "Save" : "Add site"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
