import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, KeyRound, Plus, Server, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, PageHeader, errorMessage } from "@/components/nd/page";
import { SimulatedBadge, ToneBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { formatDateTime, useAgents } from "@/lib/queries";
import { heartbeatState, relativeTime } from "@/lib/jobs";

export const Route = createFileRoute("/_authenticated/app/agents")({
  head: () => ({ meta: [{ title: "Agents & stations · NextDrive" }] }),
  component: AgentsPage,
});

const HB_TONE = { online: "success", stale: "warning", offline: "danger", never: "neutral" } as const;

function AgentsPage() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const agents = useAgents({ refetchMs: 10_000 });
  const canManage = can(role, "agents.manage");
  const tokens = useQuery({
    queryKey: ["enrollment-tokens", orgId],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.from("enrollment_tokens").select("id, label, is_simulated, created_at, expires_at, used_at, revoked_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
  });
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { data, error } = await supabase.rpc("create_enrollment_token", { _org: orgId, _label: String(f.get("label")), _site: null as never, _ttl_hours: Number(f.get("ttl") || 24) });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    setToken(data as string);
    qc.invalidateQueries({ queryKey: ["enrollment-tokens", orgId] });
  }

  async function onRevoke() {
    if (!revoke) return;
    const { error } = await supabase.rpc("revoke_agent", { _agent: revoke.id, _reason: "Revoked by administrator" });
    setRevoke(null);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Agent revoked. Its credential no longer works and its queued jobs need re-authorization.");
    qc.invalidateQueries({ queryKey: ["agents", orgId] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents & stations"
        description="Each erasure station enrolls once with a single-use token and receives its own credential. The NextDrive bootable agent is a separate deliverable and is not built yet; only the labelled simulator connects today."
        actions={canManage && <Button onClick={() => { setToken(null); setOpen(true); }}><Plus /> Enrollment token</Button>}
      />
      {agents.isLoading ? <LoadingBlock /> : agents.error ? <ErrorBlock error={agents.error} /> : agents.data!.length === 0 ? (
        <EmptyState icon={Server} title="No agents enrolled" description="Create an enrollment token for a station, or run the agent simulator." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Agent</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last heartbeat</th>
                <th className="px-4 py-2.5 font-medium">Version</th>
                <th className="px-4 py-2.5 font-medium">Credential</th>
                <th className="px-4 py-2.5 font-medium">Enrolled</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {agents.data!.map((a) => {
                const hb = heartbeatState(a.last_heartbeat_at);
                return (
                  <tr key={a.id}>
                    <td className="px-4 py-2.5"><p className="font-medium text-foreground">{a.name}</p>{a.is_simulated && <SimulatedBadge className="mt-1" />}</td>
                    <td className="px-4 py-2.5">{a.status === "active" ? <ToneBadge tone="success">Active</ToneBadge> : <ToneBadge tone="danger">Revoked</ToneBadge>}</td>
                    <td className="px-4 py-2.5">{a.status === "active" ? <ToneBadge tone={HB_TONE[hb]}>{relativeTime(a.last_heartbeat_at)}</ToneBadge> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.agent_version ?? "—"}</td>
                    <td className="px-4 py-2.5"><Mono className="text-muted-foreground">{a.credential_prefix}…</Mono></td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(a.enrolled_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {a.status === "active" && (canManage || (a.is_simulated && can(role, "simulator.run"))) && (
                        <Button variant="ghost" size="sm" onClick={() => setRevoke({ id: a.id, name: a.name })}><ShieldOff /> Revoke</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (tokens.data?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Recent enrollment tokens</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {tokens.data!.map((t) => {
                  const state = t.used_at ? "Used" : t.revoked_at ? "Revoked" : new Date(t.expires_at) < new Date() ? "Expired" : "Unused";
                  return (
                    <tr key={t.id}>
                      <td className="px-4 py-2 text-foreground"><KeyRound className="mr-2 inline size-3.5 text-muted-foreground" />{t.label} {t.is_simulated && <SimulatedBadge className="ml-1" />}</td>
                      <td className="px-4 py-2"><ToneBadge tone={state === "Unused" ? "info" : "neutral"}>{state}</ToneBadge></td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">Expires {formatDateTime(t.expires_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enrollment token</DialogTitle>
            <DialogDescription>Single use. The station exchanges it for its own credential at <Mono>POST /api/public/agent/v1/enroll</Mono>.</DialogDescription>
          </DialogHeader>
          {token ? (
            <div className="space-y-3">
              <p className="text-sm text-warning">Copy it now. It is shown only once and stored only as a hash.</p>
              <div className="flex gap-2">
                <Input readOnly value={token} className="font-mono text-xs" />
                <Button variant="outline" size="icon" aria-label="Copy token" onClick={() => { navigator.clipboard.writeText(token); toast.success("Copied"); }}><Copy /></Button>
              </div>
            </div>
          ) : (
            <form id="new-token" onSubmit={onCreate} className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="label">Station label *</Label><Input id="label" name="label" required maxLength={120} placeholder="e.g. Bench 3, Warehouse A" /></div>
              <div className="space-y-1.5"><Label htmlFor="ttl">Valid for (hours)</Label><Input id="ttl" name="ttl" type="number" min={1} max={168} defaultValue={24} /></div>
            </form>
          )}
          <DialogFooter>
            {token ? <Button onClick={() => setOpen(false)}>Done</Button> : <><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form="new-token" disabled={busy}>Create token</Button></>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revoke} onOpenChange={(v) => !v && setRevoke(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {revoke?.name}?</DialogTitle>
            <DialogDescription>The credential stops working immediately. Queued jobs return to Awaiting authorization; running jobs become Interrupted. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoke(null)}>Cancel</Button>
            <Button variant="destructive" onClick={onRevoke}>Revoke agent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
