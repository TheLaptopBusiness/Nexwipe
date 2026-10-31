import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MailWarning, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SetPasswordForm } from "@/components/nd/set-password-form";
import { Wordmark } from "@/components/nd/wordmark";
import { LoadingBlock, errorMessage } from "@/components/nd/page";
import { useSessionUser } from "@/lib/session";
import { needsFirstPassword } from "@/lib/first-password";
import { ROLE_LABELS, type OrgRole } from "@/lib/permissions";
import { membershipsQueryKey, rememberOrg } from "@/lib/org-context";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "Accept invitation — NexWipe" },
      { name: "description", content: "Join an organization on NexWipe." },
      { property: "og:title", content: "Accept invitation — NexWipe" },
      { property: "og:description", content: "Join an organization on NexWipe." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const { data: user, isLoading: userLoading } = useSessionUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ["invite-preview", token, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_invitation", { _token: token });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  async function accept() {
    setBusy(true);
    const { data, error } = await supabase.rpc("accept_invitation", { _token: token });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    rememberOrg(data as string);
    await qc.invalidateQueries({ queryKey: membershipsQueryKey });
    toast.success("You’ve joined the organization");
    navigate({ to: "/app", replace: true });
  }

  // Accounts created by an invitation email have no password yet; set one before joining.
  const needsPassword = needsFirstPassword(user);

  const here = `/invite/${token}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-card">
        <Wordmark />
        {userLoading ? (
          <LoadingBlock />
        ) : !user ? (
          <div className="mt-6">
            <h1 className="text-xl font-semibold text-foreground">You’ve been invited to NexWipe</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in with the email address the invitation was sent to. If you don’t have an account yet, open
              the invitation email — its link sets up your account (public sign-up is closed during the pilot).
            </p>
            <div className="mt-6 flex gap-2">
              <Button asChild>
                <Link to="/auth" search={{ redirect: here }}>Sign in</Link>
              </Button>
            </div>
          </div>
        ) : needsPassword ? (
          <SetPasswordForm email={user.email} onDone={() => undefined} />
        ) : preview.isLoading ? (
          <LoadingBlock />
        ) : !preview.data ? (
          <div className="mt-6">
            <MailWarning className="size-8 text-warning" aria-hidden />
            <h1 className="mt-3 text-xl font-semibold text-foreground">Invitation not available</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This invitation was already used, revoked, or doesn’t exist. Ask your administrator for a new one.
            </p>
            <Button asChild variant="outline" className="mt-6">
              <Link to="/app">Go to app</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-6">
            <UserPlus className="size-8 text-success" aria-hidden />
            <h1 className="mt-3 text-xl font-semibold text-foreground">Join {preview.data.org_name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Role: <span className="font-medium text-foreground">{ROLE_LABELS[preview.data.role as OrgRole]}</span>
              <br />
              Sent to: <span className="font-mono text-foreground">{preview.data.email}</span>
            </p>
            {preview.data.expired ? (
              <p className="mt-4 text-sm text-danger">This invitation has expired.</p>
            ) : user.email?.toLowerCase() !== preview.data.email ? (
              <p className="mt-4 text-sm text-danger">
                You’re signed in as {user.email}. Sign in with the invited address to accept.
              </p>
            ) : (
              <Button className="mt-6 w-full" onClick={accept} disabled={busy}>
                Accept invitation
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
