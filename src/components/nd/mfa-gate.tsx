import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/components/nd/page";
import { ROLE_LABELS, isPrivileged, type OrgRole } from "@/lib/permissions";

export const aalQueryKey = ["auth-aal"] as const;

/** Current session assurance level. The database is the real boundary: owner/admin rights only count at AAL2. */
export function useAssurance() {
  return useQuery({
    queryKey: aalQueryKey,
    queryFn: async () => {
      const [{ data: aal }, { data: factors }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      return {
        current: aal?.currentLevel ?? "aal1",
        verifiedFactors: (factors?.totp ?? []).filter((f) => f.status === "verified"),
        allFactors: factors?.all ?? [],
      };
    },
  });
}

export function MfaGate({ role, orgName, children }: { role: OrgRole; orgName: string; children: React.ReactNode }) {
  const aal = useAssurance();
  if (!isPrivileged(role)) return <>{children}</>;
  if (aal.isLoading || !aal.data) return null;
  if (aal.data.current === "aal2") return <>{children}</>;
  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-lg border border-border bg-card p-6 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-info-soft text-info"><KeyRound className="size-5" /></span>
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Two-step verification required</h1>
          <p className="text-sm text-muted-foreground">You are {ROLE_LABELS[role].toLowerCase()} of {orgName}.</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Owner and administrator permissions only work in a session verified with an authenticator app. Until then the server
        refuses every action and read that needs those permissions.
      </p>
      {aal.data.verifiedFactors.length > 0 ? <MfaChallenge factorId={aal.data.verifiedFactors[0]!.id} /> : <MfaEnroll />}
    </div>
  );
}

function useAfterVerify() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries();
  };
}

export function MfaChallenge({ factorId }: { factorId: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const done = useAfterVerify();
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Verified");
    done();
  }
  return (
    <form onSubmit={verify} className="space-y-2">
      <label htmlFor="mfa-code" className="text-sm font-medium text-foreground">Enter the 6-digit code from your authenticator app</label>
      <div className="flex gap-2">
        <Input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className="w-40 font-mono tracking-widest" autoFocus />
        <Button type="submit" disabled={busy || code.replace(/\s/g, "").length < 6}><ShieldCheck /> Verify</Button>
      </div>
    </form>
  );
}

export function MfaEnroll() {
  const aal = useAssurance();
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const done = useAfterVerify();
  async function start() {
    for (const f of aal.data?.allFactors ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
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
    done();
  }
  if (!enroll) return <Button onClick={start}><ShieldCheck /> Set up authenticator app</Button>;
  return (
    <div className="space-y-3">
      <img src={enroll.qr} alt="Scan this QR code with your authenticator app" className="size-44 rounded-md bg-card p-2" />
      <p className="text-xs text-muted-foreground">Or enter this key: <span className="break-all font-mono text-foreground">{enroll.secret}</span></p>
      <div className="flex gap-2">
        <Input aria-label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" className="w-40 font-mono tracking-widest" />
        <Button onClick={verify} disabled={code.replace(/\s/g, "").length < 6}>Verify & enable</Button>
      </div>
    </div>
  );
}
