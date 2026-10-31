import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { MailCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/nd/wordmark";
import { errorMessage } from "@/components/nd/page";
import { safeRedirect } from "@/lib/session";

type Mode = "signin" | "signup" | "forgot" | "check-email" | "mfa";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string; mode?: "signup" } => {
    const out: { redirect?: string; mode?: "signup" } = {};
    if (typeof s["redirect"] === "string") out.redirect = s["redirect"];
    if (s["mode"] === "signup") out.mode = "signup";
    return out;
  },
  head: () => ({
    meta: [
      { title: "Sign in — NextDrive" },
      { name: "description", content: "Sign in or create a NextDrive account." },
      { property: "og:title", content: "Sign in — NextDrive" },
      { property: "og:description", content: "Sign in or create a NextDrive account." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(search.mode === "signup" ? "signup" : "signin");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const target = safeRedirect(search.redirect);

  function done() {
    navigate({ to: target, replace: true });
  }

  async function afterPassword() {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data && data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (totp) {
        setFactorId(totp.id);
        setMode("mfa");
        return;
      }
    }
    done();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const em = String(f.get("email") ?? "").trim();
    const pw = String(f.get("password") ?? "");
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw });
        if (error) throw error;
        await afterPassword();
      } else if (mode === "signup") {
        const full_name = String(f.get("full_name") ?? "").trim();
        const { data, error } = await supabase.auth.signUp({
          email: em,
          password: pw,
          options: {
            emailRedirectTo: window.location.origin + target,
            data: { full_name },
          },
        });
        if (error) throw error;
        if (data.session) done();
        else {
          setEmail(em);
          setMode("check-email");
        }
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(em, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setEmail(em);
        setMode("check-email");
      } else if (mode === "mfa" && factorId) {
        const code = String(f.get("code") ?? "").replace(/\s/g, "");
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
        if (error) throw error;
        done();
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (search.redirect) sessionStorage.setItem("nd.postAuth", target);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth/callback" });
    if (result.error) { toast.error(errorMessage(result.error)); return; }
    if (result.redirected) return;
    await afterPassword();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-blueprint p-12 lg:flex">
        <Link to="/" aria-label="NextDrive home">
          <Wordmark inverted />
        </Link>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">Wipe. Verify. Renew.</p>
          <p className="mt-4 max-w-md text-2xl font-semibold leading-snug text-navy-foreground">
            Every laptop, every drive, every decision on the record.
          </p>
        </div>
        <p className="text-xs text-navy-muted">NextDrive Cloud · in development</p>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 inline-block lg:hidden">
            <Wordmark />
          </Link>

          {mode === "check-email" ? (
            <div className="text-center">
              <MailCheck className="mx-auto size-10 text-success" aria-hidden />
              <h1 className="mt-4 text-2xl font-semibold text-foreground">Check your email</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a link to <span className="font-medium text-foreground">{email}</span>. Open it to continue.
              </p>
              <Button variant="ghost" className="mt-6" onClick={() => setMode("signin")}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-foreground">
                {mode === "signin" && "Sign in"}
                {mode === "signup" && "Create your account"}
                {mode === "forgot" && "Reset your password"}
                {mode === "mfa" && "Two-step verification"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {mode === "signin" && "Welcome back to NextDrive."}
                {mode === "signup" && "You’ll verify your email before creating an organization."}
                {mode === "forgot" && "We’ll email you a reset link."}
                {mode === "mfa" && "Enter the 6-digit code from your authenticator app."}
              </p>

              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                {mode === "mfa" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="code">Authentication code</Label>
                    <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus className="font-mono tracking-widest" />
                  </div>
                ) : (
                  <>
                    {mode === "signup" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="full_name">Full name</Label>
                        <Input id="full_name" name="full_name" required maxLength={120} autoComplete="name" />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" name="email" type="email" required autoComplete="email" />
                    </div>
                    {mode !== "forgot" && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="password">Password</Label>
                          {mode === "signin" && (
                            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode("forgot")}>
                              Forgot password?
                            </button>
                          )}
                        </div>
                        <Input
                          id="password"
                          name="password"
                          type="password"
                          required
                          minLength={mode === "signup" ? 10 : undefined}
                          autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        />
                        {mode === "signup" && <p className="text-xs text-muted-foreground">At least 10 characters.</p>}
                      </div>
                    )}
                  </>
                )}
                <Button type="submit" className="w-full" disabled={busy}>
                  {mode === "signin" && "Sign in"}
                  {mode === "signup" && "Create account"}
                  {mode === "forgot" && "Send reset link"}
                  {mode === "mfa" && (
                    <>
                      <ShieldCheck /> Verify
                    </>
                  )}
                </Button>
              </form>

              {(mode === "signin" || mode === "signup") && (
                <>
                  <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                  </div>
                  <Button variant="outline" className="w-full" onClick={google} type="button">
                    Continue with Google
                  </Button>
                </>
              )}

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {mode === "signin" ? (
                  <>
                    New to NextDrive?{" "}
                    <button className="font-medium text-foreground underline underline-offset-4" onClick={() => setMode("signup")}>
                      Create an account
                    </button>
                  </>
                ) : (
                  <button className="font-medium text-foreground underline underline-offset-4" onClick={() => setMode("signin")}>
                    Back to sign in
                  </button>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
