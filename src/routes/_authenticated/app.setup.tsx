import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Circle, FlaskConical, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBlock, LoadingBlock, PageHeader, errorMessage } from "@/components/nd/page";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { useAgents, useSites } from "@/lib/queries";
import { useAssurance } from "@/components/nd/mfa-gate";
import { setupProgress } from "@/lib/setup-checklist";

export const Route = createFileRoute("/_authenticated/app/setup")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Get started — NexWipe" },
      { name: "description", content: "Set up your NexWipe organization, first site and first device." },
      { property: "og:title", content: "Get started — NexWipe" },
      { property: "og:description", content: "Set up your NexWipe organization, first site and first device." },
    ],
  }),
  component: Setup,
});

function useDeviceCount() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ["setup-device-count", orgId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("devices")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("is_demo", false)
        .eq("is_simulated", false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

function Setup() {
  const { role, current } = useOrg();
  const sites = useSites();
  const agents = useAgents();
  const devices = useDeviceCount();
  const aal = useAssurance();
  if (sites.isLoading || agents.isLoading || devices.isLoading || aal.isLoading) return <LoadingBlock />;
  const err = sites.error ?? agents.error ?? devices.error;
  if (err) return <ErrorBlock error={err} />;
  const p = setupProgress({
    sites: sites.data!.length,
    realStations: agents.data!.filter((a) => !a.is_simulated && a.status === "active").length,
    devices: devices.data!,
    twoStep: aal.data?.current === "aal2",
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Get started"
        description={`Set up ${current.org.name}: ${p.done} of ${p.total} steps complete.`}
      />
      <ol className="space-y-4">
        <Step n={1} done title="Create your organization">
          {current.org.name} is ready.
        </Step>
        <Step n={2} done={p.twoStep} title="Turn on two-step verification">
          {p.twoStep
            ? "Done — this session is verified with your authenticator app. Owner and administrator permissions require it."
            : "Not yet verified in this session. Set it up from your account page; owners and administrators can’t manage the organization without it."}{" "}
          {!p.twoStep && <Link to="/app/account" className="underline underline-offset-4">Account</Link>}
        </Step>
        <Step n={3} done={p.site} title="Add your first site">
          {p.site ? (
            <>
              {sites.data![0]!.name} added. <Link to="/app/sites" className="underline underline-offset-4">Manage sites</Link>
            </>
          ) : can(role, "sites.manage") ? (
            <FirstSiteForm />
          ) : (
            "An owner or administrator adds sites."
          )}
        </Step>
        <Step n={4} done={p.device} title="Connect your first device">
          <ul className="mt-2 space-y-3">
            <Check done={p.station} label="Create a station enrollment token">
              On <Link to="/app/agents" className="underline underline-offset-4">Agents &amp; stations</Link>, choose
              <span className="font-medium"> Enrollment token</span>. It’s shown once and expires.
            </Check>
            <Check done={p.station} label="Boot a laptop from the read-only station USB">
              Get the station USB image and instructions from{" "}
              <Link to="/support" className="underline underline-offset-4">support</Link>. Writing the image erases the USB
              stick; the station itself only reads the laptop’s drives and never erases them. Physical laptop
              compatibility is still being verified.
            </Check>
            <Check done={p.station} label="Enter the token on the station screen">
              The station appears on Agents &amp; stations and reports the laptop’s hardware.
            </Check>
            <Check done={p.device} label="Add the device to inventory">
              Add it from the station report, or receive it by hand on{" "}
              <Link to="/app/inventory" className="underline underline-offset-4">Inventory</Link>.
            </Check>
          </ul>
          <p className="mt-4 flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
            <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Drive erasure isn’t available yet. To see how jobs will work, try the{" "}
              <Link to="/app/simulator" className="underline underline-offset-4">agent simulator</Link> — its results are
              labeled simulated and never count as real devices, wipes or certificates.
            </span>
          </p>
        </Step>
      </ol>
      {p.complete && (
        <div className="rounded-lg border border-success bg-success-soft p-4 text-sm text-foreground">
          Setup steps complete. This means your account, site and first device are recorded — it does not mean
          drive erasure is available.{" "}
          <Link to="/app" className="font-medium underline underline-offset-4">Go to the dashboard</Link>
        </div>
      )}
    </div>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-3">
        {done ? <CheckCircle2 className="size-5 text-success" aria-label="Done" /> : <Circle className="size-5 text-muted-foreground" aria-label="To do" />}
        <h2 className="font-semibold text-foreground">
          <span className="mr-2 font-mono text-xs text-muted-foreground">{n}</span>
          {title}
        </h2>
      </div>
      <div className="mt-2 pl-8 text-sm text-muted-foreground">{children}</div>
    </li>
  );
}

function Check({ done, label, children }: { done: boolean; label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" /> : <Circle className="mt-0.5 size-4 shrink-0" aria-label="To do" />}
      <div>
        <p className="font-medium text-foreground">{label}</p>
        <p>{children}</p>
      </div>
    </li>
  );
}

function FirstSiteForm() {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC";
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const address = String(f.get("address") ?? "").trim() || null;
    const timezone = String(f.get("timezone") ?? "").trim() || "UTC";
    if (name.length < 2) { toast.error("Enter a site name"); return; }
    setBusy(true);
    const { error } = await supabase.from("sites").insert({ org_id: orgId, name, address, timezone });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    (e.target as HTMLFormElement).reset();
    toast.success("Site added");
    await qc.invalidateQueries({ queryKey: ["sites", orgId] });
  }
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3" aria-label="Add your first site">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="site-name">Site name</Label>
          <Input id="site-name" name="name" required minLength={2} maxLength={120} placeholder="Main warehouse" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="site-tz">Timezone</Label>
          <Input id="site-tz" name="timezone" defaultValue={tz} maxLength={64} className="font-mono" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="site-address">Address (optional)</Label>
        <Input id="site-address" name="address" maxLength={300} />
      </div>
      <Button type="submit" loading={busy}><MapPin /> Add site</Button>
    </form>
  );
}
