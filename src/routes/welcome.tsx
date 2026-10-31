import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Wordmark } from "@/components/nd/wordmark";
import { LoadingBlock } from "@/components/nd/page";
import { Button } from "@/components/ui/button";
import { SetPasswordForm } from "@/components/nd/set-password-form";
import { safeRedirect, useSessionUser } from "@/lib/session";
import { needsFirstPassword } from "@/lib/first-password";

export const Route = createFileRoute("/welcome")({
  validateSearch: z.object({ next: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Finish setting up your account — NexWipe" },
      { name: "description", content: "Choose a password for the NexWipe account created by your invitation." },
      { property: "og:title", content: "Finish setting up your account — NexWipe" },
      { property: "og:description", content: "Choose a password for the NexWipe account created by your invitation." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Welcome,
});

function Welcome() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const { data: user, isLoading } = useSessionUser();
  // Invitees continue to their invitation, or to onboarding where pending invitations are listed.
  const target = safeRedirect(next, "/onboarding");
  const go = () => navigate({ to: target === "/" ? "/onboarding" : target, replace: true });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-card">
        <Wordmark />
        {isLoading ? (
          <LoadingBlock />
        ) : !user ? (
          <div className="mt-6">
            <h1 className="text-xl font-semibold text-foreground">Open your invitation email</h1>
            <p className="mt-2 text-sm text-muted-foreground">The link in your invitation email signs you in so you can choose a password.</p>
            <Button asChild className="mt-6"><Link to="/auth">Sign in</Link></Button>
          </div>
        ) : needsFirstPassword(user) ? (
          <SetPasswordForm email={user.email} onDone={go} />
        ) : (
          <div className="mt-6">
            <h1 className="text-xl font-semibold text-foreground">Your account is ready</h1>
            <Button className="mt-6 w-full" onClick={go}>Continue</Button>
          </div>
        )}
      </div>
    </div>
  );
}
