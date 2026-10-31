import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, MailOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/nd/wordmark";
import { errorMessage } from "@/components/nd/page";
import { membershipsQueryKey, rememberOrg } from "@/lib/org-context";
import { useSignOut } from "@/lib/session";
import { PendingInvitations } from "@/components/nd/pending-invitations";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Create your organization — NexWipe" },
      { name: "description", content: "Set up your NexWipe organization." },
      { property: "og:title", content: "Create your organization — NexWipe" },
      { property: "og:description", content: "Set up your NexWipe organization." },
    ],
  }),
  component: Onboarding,
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function Onboarding() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = useSignOut();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const verified = !!user.email_confirmed_at;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("create_organization", { _name: name, _slug: slug });
    setBusy(false);
    if (error) {
      { toast.error(error.code === "23505" ? "That URL name is taken. Try another." : errorMessage(error)); return; }
    }
    rememberOrg(data as string);
    await qc.invalidateQueries({ queryKey: membershipsQueryKey });
    toast.success("Organization created");
    navigate({ to: "/app/setup", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-between">
          <Wordmark />
          <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
        </div>
        <div className="rounded-xl border border-border bg-card p-8 shadow-card">
          <Building2 className="size-7 text-success" aria-hidden />
          <p className="mt-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">Step 1 of 3 · Organization</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Create your organization</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your organization holds your sites, team, clients, devices and records. You’ll be its owner.
          </p>
          {verified && <PendingInvitations />}
          {!verified ? (
            <p className="mt-6 rounded-md bg-warning-soft p-3 text-sm text-warning">Verify your email address first: open the link we emailed you, then come back here.</p>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Company name</Label>
                <Input
                  id="name"
                  required
                  minLength={2}
                  maxLength={120}
                  value={name}
                  placeholder="Used Tech Solutions"
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugTouched) setSlug(slugify(e.target.value));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slug">URL name</Label>
                <Input
                  id="slug"
                  required
                  pattern="[a-z0-9][a-z0-9\-]{1,47}"
                  value={slug}
                  className="font-mono"
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                />
                <p className="text-xs text-muted-foreground">Lowercase letters, numbers and dashes.</p>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                Create organization
              </Button>
            </form>
          )}
          <div className="mt-6 flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            <MailOpen className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Joining an existing team? Don’t create a new organization — open the invitation link your administrator sent you.{" "}
              <Link to="/" className="underline underline-offset-4">Back to site</Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
