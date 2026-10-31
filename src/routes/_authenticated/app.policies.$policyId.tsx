import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Archive, GitBranchPlus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingBlock, PageHeader, errorMessage } from "@/components/nd/page";
import { SimulatedBadge, ToneBadge } from "@/components/nd/status-badge";
import { PolicyRulesEditor, PolicyVersionSummary, rulesFromVersion, type PolicyRules } from "@/components/nd/policy-form";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDateTime, memberName, useMembers, usePolicies } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/app/policies/$policyId")({
  head: () => ({ meta: [{ title: "Policy · NextDrive" }] }),
  component: PolicyDetail,
});

function PolicyDetail() {
  const { policyId } = Route.useParams();
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const policies = usePolicies();
  const members = useMembers();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<PolicyRules | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (policies.isLoading) return <LoadingBlock />;
  const p = policies.data?.find((x) => x.id === policyId);
  if (!p) return <EmptyState icon={SlidersHorizontal} title="Policy not found" />;
  const canManage = can(role, "policies.manage") && !p.is_simulator;
  const memberById = new Map((members.data ?? []).map((m) => [m.user_id, m]));

  async function onVersion() {
    if (!rules) return;
    setBusy(true);
    const { error } = await supabase.rpc("create_policy_version", { _policy: policyId, _rules: rules as never, _note: note });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("New version created. Existing jobs keep their original version.");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["policies", orgId] });
  }

  async function onArchive() {
    const { error } = await supabase.rpc("set_policy_archived", { _policy: policyId, _archived: !p!.is_archived });
    if (error) return toast.error(errorMessage(error));
    qc.invalidateQueries({ queryKey: ["policies", orgId] });
  }

  return (
    <div className="space-y-6">
      <Link to="/app/policies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Policies</Link>
      <PageHeader
        title={p.name}
        description={p.description ?? undefined}
        actions={canManage && (
          <>
            <Button variant="outline" onClick={onArchive}><Archive /> {p.is_archived ? "Restore" : "Archive"}</Button>
            {!p.is_archived && <Button onClick={() => { setRules(p.latest ? rulesFromVersion(p.latest) : null); setNote(""); setOpen(true); }}><GitBranchPlus /> New version</Button>}
          </>
        )}
      />
      <div className="flex gap-2">
        {p.is_simulator && <SimulatedBadge />}
        {p.is_archived && <ToneBadge tone="neutral">Archived — cannot be used for new jobs</ToneBadge>}
      </div>
      <div className="space-y-4">
        {p.policy_versions.map((v, idx) => (
          <section key={v.id} className="rounded-lg border border-border bg-card p-5 shadow-card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-foreground">Version {v.version} {idx === 0 && <ToneBadge tone="info" className="ml-2 align-middle">Current</ToneBadge>}</h2>
              <p className="text-xs text-muted-foreground">{formatDateTime(v.created_at)} · {v.created_by ? memberName(memberById.get(v.created_by)) : "system"}{v.change_note ? ` · ${v.change_note}` : ""}</p>
            </div>
            <PolicyVersionSummary v={rulesFromVersion(v)} />
          </section>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>New version of {p.name}</DialogTitle></DialogHeader>
          {rules && <PolicyRulesEditor value={rules} onChange={setRules} />}
          <div className="space-y-1.5"><Label htmlFor="note">What changed?</Label><Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={onVersion} disabled={busy}>Create version {(p.latest?.version ?? 0) + 1}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
