import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/components/nd/page";
import { ROLE_LABELS, type OrgRole } from "@/lib/permissions";
import { membershipsQueryKey, rememberOrg } from "@/lib/org-context";

/** Invitations sent to the signed-in user's confirmed email address (works even without the link). */
export function PendingInvitations({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["my-pending-invitations"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_pending_invitations");
      if (error) throw error;
      return data ?? [];
    },
  });
  if (!q.data || q.data.length === 0) return null;

  async function accept(id: string) {
    setBusy(id);
    const { data, error } = await supabase.rpc("accept_invitation_by_id", { _invitation: id });
    setBusy(null);
    if (error) { toast.error(errorMessage(error)); return; }
    rememberOrg(data as string);
    await qc.invalidateQueries({ queryKey: membershipsQueryKey });
    await qc.invalidateQueries({ queryKey: ["my-pending-invitations"] });
    toast.success("You’ve joined the organization");
    navigate({ to: "/app", replace: true });
  }

  return (
    <section aria-label="Pending invitations" className={compact ? "border-b border-info/30 bg-info-soft px-6 py-2.5" : "mt-6 rounded-md border border-info/30 bg-info-soft p-4"}>
      {q.data.map((i) => (
        <div key={i.invitation_id} className="flex flex-wrap items-center gap-3 text-sm text-info">
          <UserPlus className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            You’re invited to join <strong>{i.org_name}</strong> as {ROLE_LABELS[i.role as OrgRole].toLowerCase()}.
          </span>
          <Button size="sm" onClick={() => accept(i.invitation_id)} disabled={busy === i.invitation_id}>Accept invitation</Button>
        </div>
      ))}
    </section>
  );
}
