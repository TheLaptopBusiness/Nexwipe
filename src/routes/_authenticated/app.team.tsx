import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, MailPlus, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, ErrorBlock, LoadingBlock, Mono, PageHeader, errorMessage } from "@/components/nd/page";
import { ToneBadge } from "@/components/nd/status-badge";
import { membershipsQueryKey, useOrg } from "@/lib/org-context";
import { assignableRoles, can, canManageMember, ROLE_DESCRIPTIONS, ROLE_LABELS, type OrgRole } from "@/lib/permissions";
import { formatDate, memberName, useMembers } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/app/team")({
  component: Team,
});

function Team() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const members = useMembers();
  const canManage = can(role, "team.manage");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const { data: me } = useQuery({ queryKey: ["auth-user"], queryFn: async () => (await supabase.auth.getUser()).data.user });

  const invites = useQuery({
    queryKey: ["invitations", orgId],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase.from("invitations").select("id, email, role, status, expires_at, created_at").eq("org_id", orgId).eq("status", "pending").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function changeRole(membershipId: string, newRole: OrgRole) {
    const { error } = await supabase.rpc("update_member_role", { _membership: membershipId, _role: newRole });
    if (error) return toast.error(errorMessage(error));
    toast.success("Role updated");
    qc.invalidateQueries({ queryKey: ["members", orgId] });
    qc.invalidateQueries({ queryKey: membershipsQueryKey });
  }
  async function revokeMember() {
    if (!revoking) return;
    const { error } = await supabase.rpc("revoke_member", { _membership: revoking.id });
    setRevoking(null);
    if (error) return toast.error(errorMessage(error));
    toast.success("Access removed");
    qc.invalidateQueries({ queryKey: ["members", orgId] });
  }
  async function revokeInvite(id: string) {
    const { error } = await supabase.rpc("revoke_invitation", { _invitation: id });
    if (error) return toast.error(errorMessage(error));
    qc.invalidateQueries({ queryKey: ["invitations", orgId] });
  }

  const active = (members.data ?? []).filter((m) => m.status === "active");
  const revoked = (members.data ?? []).filter((m) => m.status === "revoked");
  const options = assignableRoles(role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="People with access to this organization. Role changes are enforced and audited server-side."
        actions={canManage && <Button onClick={() => setInviteOpen(true)}><MailPlus /> Invite user</Button>}
      />

      {members.isLoading ? (
        <LoadingBlock />
      ) : members.error ? (
        <ErrorBlock error={members.error} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Joined</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {active.map((m) => {
                const isSelf = m.user_id === me?.id;
                const manageable = canManageMember(role, m.role as OrgRole, isSelf);
                return (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5 font-medium text-foreground">{memberName(m)}{isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{m.profiles?.email}</td>
                    <td className="px-4 py-2.5">
                      {manageable ? (
                        <Select value={m.role} onValueChange={(v) => changeRole(m.id, v as OrgRole)}>
                          <SelectTrigger className="h-8 w-48" aria-label={`Role for ${memberName(m)}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{options.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <ToneBadge tone={m.role === "owner" ? "info" : "neutral"}>{ROLE_LABELS[m.role as OrgRole]}</ToneBadge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular text-muted-foreground">{formatDate(m.created_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {manageable && <Button variant="ghost" size="sm" onClick={() => setRevoking({ id: m.id, name: memberName(m) })}><UserMinus /> Remove</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Pending invitations</h2>
          {invites.isLoading ? (
            <LoadingBlock />
          ) : (invites.data ?? []).length === 0 ? (
            <EmptyState icon={Users} title="No pending invitations" className="py-8" />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {invites.data!.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <Mono className="text-foreground">{i.email}</Mono>
                  <ToneBadge tone="neutral">{ROLE_LABELS[i.role as OrgRole]}</ToneBadge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(i.expires_at) < new Date() ? "Expired" : `Expires ${formatDate(i.expires_at)}`}
                  </span>
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => revokeInvite(i.id)}>Revoke</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {revoked.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Removed users</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {revoked.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-muted-foreground">
                <span>{memberName(m)}</span>
                <span className="text-xs">Removed {formatDate(m.revoked_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Roles</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          {(Object.keys(ROLE_LABELS) as OrgRole[]).map((r) => (
            <div key={r}>
              <dt className="font-medium text-foreground">{ROLE_LABELS[r]}</dt>
              <dd className="mt-0.5 text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </section>

      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
      <AlertDialog open={!!revoking} onOpenChange={(v) => !v && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {revoking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>They immediately lose access to this organization and any client project grants. Their history stays in the audit log.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={revokeMember}>Remove access</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const options = assignableRoles(role);
  const [inviteRole, setInviteRole] = useState<OrgRole>("technician");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    const { data, error } = await supabase.rpc("create_invitation", { _org: orgId, _email: email, _role: inviteRole });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    setLink(`${window.location.origin}/invite/${data}`);
    qc.invalidateQueries({ queryKey: ["invitations", orgId] });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>The invitation is valid for 7 days and only for the email address you enter.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground">Send this link to the invitee. It is shown only once.</p>
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(link); toast.success("Link copied"); }}><Copy /> Copy</Button>
            </div>
            <p className="text-xs text-muted-foreground">Invitation emails are not sent automatically yet — an email sender domain still needs to be configured.</p>
          </div>
        ) : (
          <form id="invite-form" onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="i-email">Email</Label><Input id="i-email" name="email" type="email" required autoFocus /></div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{options.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[inviteRole]}</p>
            </div>
          </form>
        )}
        <DialogFooter>
          {link ? <Button onClick={onClose}>Done</Button> : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" form="invite-form" disabled={busy}>Create invitation</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
