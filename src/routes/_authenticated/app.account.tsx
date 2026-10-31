import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, errorMessage } from "@/components/nd/page";
import { ToneBadge } from "@/components/nd/status-badge";

export const Route = createFileRoute("/_authenticated/app/account")({
  component: Account,
});

function Account() {
  const { data: user } = useQuery({ queryKey: ["auth-user"], queryFn: async () => (await supabase.auth.getUser()).data.user });
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Account & security" description={user?.email} />
      <Profile />
      <Password />
      <Mfa />
    </div>
  );
}

function Profile() {
  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("profiles").select("*").eq("id", u.user!.id).single();
      if (error) throw error;
      return data;
    },
  });
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const full_name = String(new FormData(e.currentTarget).get("full_name") ?? "").trim() || null;
    const { error } = await supabase.from("profiles").update({ full_name }).eq("id", profile!.id);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Profile saved");
    qc.invalidateQueries();
  }
  if (!profile) return null;
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-card">
      <h2 className="font-semibold text-foreground">Profile</h2>
      <div className="space-y-1.5"><Label htmlFor="full_name">Full name</Label><Input id="full_name" name="full_name" maxLength={120} defaultValue={profile.full_name ?? ""} /></div>
      <Button type="submit">Save</Button>
    </form>
  );
}

function Password() {
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const password = String(f.get("password") ?? "");
    if (password !== String(f.get("confirm") ?? "")) { toast.error("Passwords do not match"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password, current_password: String(f.get("current") ?? "") } as never);
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    form.reset();
    toast.success("Password changed");
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-card">
      <h2 className="font-semibold text-foreground">Change password</h2>
      <div className="space-y-1.5"><Label htmlFor="current">Current password</Label><Input id="current" name="current" type="password" required autoComplete="current-password" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="pw">New password</Label><Input id="pw" name="password" type="password" minLength={10} required autoComplete="new-password" /></div>
        <div className="space-y-1.5"><Label htmlFor="pw2">Confirm</Label><Input id="pw2" name="confirm" type="password" minLength={10} required autoComplete="new-password" /></div>
      </div>
      <Button type="submit" disabled={busy}>Change password</Button>
    </form>
  );
}

function Mfa() {
  const qc = useQueryClient();
  const factors = useQuery({ queryKey: ["mfa-factors"], queryFn: async () => (await supabase.auth.mfa.listFactors()).data });
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const verified = (factors.data?.totp ?? []).filter((f) => f.status === "verified");

  async function start() {
    // Clean up any abandoned, unverified factors first.
    for (const f of factors.data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `NextDrive ${Date.now()}` });
    if (error) { toast.error(errorMessage(error)); return; }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }
  async function verify() {
    if (!enroll) return;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.replace(/\s/g, "") });
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Two-step verification enabled");
    setEnroll(null);
    setCode("");
    qc.invalidateQueries({ queryKey: ["mfa-factors"] });
  }
  async function remove(id: string) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) { toast.error(errorMessage(error) + " — sign in again with your code, then retry."); return; }
    toast.success("Authenticator removed");
    qc.invalidateQueries({ queryKey: ["mfa-factors"] });
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-foreground">Two-step verification</h2>
        {verified.length ? <ToneBadge tone="success" icon={ShieldCheck}>Enabled</ToneBadge> : <ToneBadge tone="warning" icon={ShieldOff}>Not enabled</ToneBadge>}
      </div>
      <p className="text-sm text-muted-foreground">Use an authenticator app (such as 1Password, Authy or Google Authenticator). Strongly recommended for owners and administrators.</p>
      {verified.map((f) => (
        <div key={f.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
          <span className="text-foreground">Authenticator app</span>
          <Button variant="ghost" size="sm" onClick={() => remove(f.id)}>Remove</Button>
        </div>
      ))}
      {enroll ? (
        <div className="space-y-3">
          <img src={enroll.qr} alt="Scan this QR code with your authenticator app" className="size-44 rounded-md bg-card p-2" />
          <p className="text-xs text-muted-foreground">Or enter this key: <span className="font-mono text-foreground">{enroll.secret}</span></p>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" className="w-40 font-mono tracking-widest" />
            <Button onClick={verify} disabled={code.length < 6}>Verify & enable</Button>
          </div>
        </div>
      ) : (
        !verified.length && <Button onClick={start}><ShieldCheck /> Set up authenticator</Button>
      )}
    </section>
  );
}
