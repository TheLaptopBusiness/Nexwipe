import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, errorMessage } from "@/components/nd/page";
import { SimulatedBadge, ToneBadge } from "@/components/nd/status-badge";
import { DEFAULT_RULES, PolicyRulesEditor, type PolicyRules } from "@/components/nd/policy-form";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDate, usePolicies } from "@/lib/queries";
import { INTERFACE_LABELS } from "@/lib/jobs";

export const Route = createFileRoute("/_authenticated/app/policies/")({
  head: () => ({ meta: [{ title: "Erasure policies · NextDrive" }] }),
  component: PoliciesPage,
});

function PoliciesPage() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const policies = usePolicies();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<PolicyRules>(DEFAULT_RULES);
  const [busy, setBusy] = useState(false);
  const canManage = can(role, "policies.manage");

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.rpc("create_policy", {
      _org: orgId,
      _name: String(f.get("name") ?? ""),
      _description: String(f.get("description") ?? ""),
      _rules: rules as never,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Policy created as version 1");
    setOpen(false);
    setRules(DEFAULT_RULES);
    qc.invalidateQueries({ queryKey: ["policies", orgId] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Erasure policies"
        description="Each policy defines supported hardware, permitted methods, verification, approval and failure handling. Versions are immutable; every job keeps the exact version it was created under."
        actions={canManage && <Button onClick={() => setOpen(true)}><Plus /> New policy</Button>}
      />
      {policies.isLoading ? <LoadingBlock /> : policies.error ? <ErrorBlock error={policies.error} /> : policies.data!.length === 0 ? (
        <EmptyState icon={SlidersHorizontal} title="No policies yet" description="Create a policy before creating erasure jobs." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Policy</th>
                <th className="px-4 py-2.5 font-medium">Current version</th>
                <th className="px-4 py-2.5 font-medium">Interfaces</th>
                <th className="px-4 py-2.5 font-medium">Verification</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policies.data!.map((p) => (
                <tr key={p.id} className="hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <Link to="/app/policies/$policyId" params={{ policyId: p.id }} className="font-medium text-foreground hover:underline">{p.name}</Link>
                    <div className="mt-1 flex gap-1.5">
                      {p.is_simulator && <SimulatedBadge />}
                      {p.is_archived && <ToneBadge tone="neutral">Archived</ToneBadge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono">v{p.latest?.version ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.latest?.allowed_interfaces.map((i) => INTERFACE_LABELS[i] ?? i).join(", ")}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.latest?.verification_method === "full_read" ? "Full read-back" : `Sampled ≥ ${p.latest?.verification_sample_pct}%`}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{formatDate(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>New erasure policy</DialogTitle></DialogHeader>
          <form id="new-policy" onSubmit={onCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="name">Name *</Label><Input id="name" name="name" required maxLength={120} placeholder="e.g. Standard laptop policy" /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="description">Description</Label><Textarea id="description" name="description" rows={2} /></div>
            </div>
            <PolicyRulesEditor value={rules} onChange={setRules} />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" form="new-policy" disabled={busy}>Create version 1</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
