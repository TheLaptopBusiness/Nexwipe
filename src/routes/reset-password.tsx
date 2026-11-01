import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/nd/wordmark";
import { errorMessage } from "@/components/nd/page";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — NexWipe" },
      { name: "description", content: "Choose a new password for your NexWipe account." },
      { property: "og:title", content: "Set a new password — NexWipe" },
      { property: "og:description", content: "Choose a new password for your NexWipe account." },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  // Accounts with an authenticator app must pass two-step verification before the password can change.
  const [factorId, setFactorId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel !== "aal2" || aal.currentLevel === "aal2") { setFactorId(null); return; }
      const { data: factors } = await supabase.auth.mfa.listFactors();
      setFactorId(factors?.totp.find((f) => f.status === "verified")?.id ?? null);
    })();
  }, [ready]);

  useEffect(() => {
    const isRecovery = window.location.hash.includes("type=recovery");
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session && isRecovery) setReady(true);
      else if (s.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pw = String(f.get("password") ?? "");
    if (pw !== String(f.get("confirm") ?? "")) { toast.error("Passwords do not match"); return; }
    setBusy(true);
    if (factorId) {
      const code = String(f.get("code") ?? "").replace(/\s/g, "");
      const { error: mfaError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (mfaError) { setBusy(false); toast.error(errorMessage(mfaError)); return; }
      setFactorId(null);
    }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Password updated");
    navigate({ to: "/app", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 inline-block">
          <Wordmark />
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Set a new password</h1>
        {!ready ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Open this page from the reset link in your email. If the link expired,{" "}
            <Link to="/auth" className="underline underline-offset-4">request a new one</Link>.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" name="confirm" type="password" minLength={10} required autoComplete="new-password" />
            </div>
            {factorId && (
              <div className="space-y-1.5">
                <Label htmlFor="code">Authentication code</Label>
                <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={8} className="font-mono tracking-widest" />
                <p className="text-xs text-muted-foreground">Your account uses two-step verification. Enter the 6-digit code from your authenticator app.</p>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              Update password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
