import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/nd/wordmark";
import { errorMessage } from "@/components/nd/page";

export const Route = createFileRoute("/signup")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "Create Your NexWipe Account" },
      { name: "description", content: "Create a NexWipe account, set up your organization and first site, and connect your first device." },
      { property: "og:title", content: "Create Your NexWipe Account" },
      { property: "og:description", content: "Sign up for NexWipe and set up your organization in minutes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignupPage,
});

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(120, "Name must be 120 characters or fewer"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(72, "Use 72 characters or fewer")
    .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), "Use letters and at least one number"),
});

/** Bot heuristics (the auth service's rate limits and email verification are the real controls). */
export function looksAutomated(honeypot: string, startedAt: number, now: number): boolean {
  return honeypot.trim() !== "" || now - startedAt < 2500;
}

function SignupPage() {
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const startedAt = useRef(Date.now());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (looksAutomated(String(f.get("website") ?? ""), startedAt.current, Date.now())) {
      toast.error("Please wait a moment and try again.");
      return;
    }
    const parsed = signupSchema.safeParse({ fullName: f.get("fullName"), email: f.get("email"), password: f.get("password") });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { full_name: parsed.data.fullName },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(
        /pwned|leaked|compromised|weak/i.test(error.message)
          ? "This password has appeared in a data breach. Choose a different one."
          : /rate limit|too many/i.test(error.message)
            ? "Too many sign-up attempts. Please try again later."
            : errorMessage(error),
      );
      return;
    }
    sessionStorage.setItem("nd.postAuth", "/onboarding");
    setSentTo(parsed.data.email);
  }

  async function resend() {
    if (!sentTo) return;
    const { error } = await supabase.auth.resend({ type: "signup", email: sentTo, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    if (error) toast.error(errorMessage(error));
    else toast.success("Verification email sent again");
  }

  async function google() {
    sessionStorage.setItem("nd.postAuth", "/onboarding");
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth/callback" });
    if (result.error) toast.error(errorMessage(result.error));
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-blueprint p-12 lg:flex">
        <Link to="/" aria-label="NexWipe home">
          <Wordmark inverted />
        </Link>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">Wipe. Verify. Renew.</p>
          <ol className="mt-6 space-y-3 text-navy-foreground">
            <li>1. Create your account and verify your email</li>
            <li>2. Create your organization and first site</li>
            <li>3. Connect your first device</li>
          </ol>
        </div>
        <p className="text-xs text-navy-muted">NexWipe Cloud</p>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 inline-block lg:hidden">
            <Wordmark />
          </Link>
          {sentTo ? (
            <div className="text-center">
              <MailCheck className="mx-auto size-10 text-success" aria-hidden />
              <h1 className="mt-4 text-2xl font-semibold text-foreground">Verify your email</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a verification link to <span className="font-medium text-foreground">{sentTo}</span>. Open it to
                continue setting up NexWipe. You can’t open the dashboard until your email is verified.
              </p>
              <Button variant="outline" className="mt-6" onClick={resend}>Resend email</Button>
              <p className="mt-4 text-sm text-muted-foreground">
                Already verified? <Link to="/auth" className="font-medium text-foreground underline underline-offset-4">Sign in</Link>
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-foreground">Create Your NexWipe Account</h1>
              <p className="mt-1 text-sm text-muted-foreground">Then set up your organization, first site and first device.</p>
              <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120} aria-invalid={!!errors["fullName"]} />
                  {errors["fullName"] && <p className="text-xs text-danger">{errors["fullName"]}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email</Label>
                  <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} aria-invalid={!!errors["email"]} />
                  {errors["email"] && <p className="text-xs text-danger">{errors["email"]}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} aria-invalid={!!errors["password"]} />
                  <p className={errors["password"] ? "text-xs text-danger" : "text-xs text-muted-foreground"}>
                    {errors["password"] ?? "At least 10 characters, with letters and a number."}
                  </p>
                </div>
                {/* Honeypot for bots: hidden from people and assistive technology. */}
                <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label htmlFor="website">Website</label>
                  <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
                </div>
                <Button type="submit" className="w-full" loading={busy}>
                  {busy ? "Creating account…" : "Create account"}
                </Button>
              </form>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
              </div>
              <Button variant="outline" className="w-full" onClick={google} type="button">
                Continue with Google
              </Button>
              <p className="mt-6 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link to="/auth" className="font-medium text-foreground underline underline-offset-4">Sign in</Link>
              </p>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Joining an existing team? Use the invitation link from your administrator instead.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
