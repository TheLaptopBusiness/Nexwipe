import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, PageHeader, errorMessage } from "@/components/nd/page";
import { membershipsQueryKey, useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/app/settings")({
  component: OrgSettings,
});

function OrgSettings() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const org = useQuery({
    queryKey: ["org", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").eq("id", orgId).single();
      if (error) throw error;
      return data;
    },
  });

  if (!can(role, "org.settings")) return <EmptyState icon={Settings} title="No access" description="Only owners and administrators can change organization settings." />;
  if (org.isLoading) return <LoadingBlock />;
  if (org.error) return <ErrorBlock error={org.error} />;
  const o = org.data!;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase
      .from("organizations")
      .update({
        name: String(f.get("name") ?? "").trim(),
        brand_display_name: String(f.get("brand_display_name") ?? "").trim() || null,
        evidence_retention_days: Number(f.get("evidence_retention_days")),
      })
      .eq("id", orgId);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Settings saved");
    qc.invalidateQueries({ queryKey: ["org", orgId] });
    qc.invalidateQueries({ queryKey: membershipsQueryKey });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organization profile, branding and retention." />
      <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
        <section className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-card">
          <h2 className="font-semibold text-foreground">Organization</h2>
          <div className="space-y-1.5"><Label htmlFor="o-name">Name</Label><Input id="o-name" name="name" required minLength={2} maxLength={120} defaultValue={o.name} /></div>
          <div className="space-y-1.5">
            <Label>URL name</Label>
            <p><Mono className="text-muted-foreground">{o.slug}</Mono></p>
            <p className="text-xs text-muted-foreground">Fixed after creation.</p>
          </div>
        </section>
        <section className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-card">
          <h2 className="font-semibold text-foreground">Branding</h2>
          <div className="space-y-1.5">
            <Label htmlFor="o-brand">Name shown on reports</Label>
            <Input id="o-brand" name="brand_display_name" maxLength={120} defaultValue={o.brand_display_name ?? ""} placeholder={o.name} />
            <p className="text-xs text-muted-foreground">Logo upload arrives with report templates (Phase 3).</p>
          </div>
        </section>
        <section className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-card">
          <h2 className="font-semibold text-foreground">Retention</h2>
          <div className="space-y-1.5">
            <Label htmlFor="o-ret">Evidence retention (days)</Label>
            <Input id="o-ret" name="evidence_retention_days" type="number" min={30} max={36500} required defaultValue={o.evidence_retention_days} className="w-40" />
            <p className="text-xs text-muted-foreground">
              Stored now; enforced once evidence storage exists. Legal holds and retention locks will block incompatible deletions.
            </p>
          </div>
        </section>
        <Button type="submit" disabled={busy}>Save settings</Button>
      </form>
      <section className="max-w-2xl rounded-lg border border-border bg-muted p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Not yet available</p>
        <p className="mt-1">API credentials, subscriptions, credits and invoices arrive with the agent API (Phase 2) and billing (Phase 4).</p>
      </section>
    </div>
  );
}
