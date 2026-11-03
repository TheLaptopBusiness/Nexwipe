import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/components/nd/page";

/** First password for an account created by an invitation email. */
export function SetPasswordForm({ email, onDone }: { email: string | undefined; onDone: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pw = String(f.get("password") ?? "");
    if (pw !== String(f.get("confirm") ?? "")) { toast.error("The passwords don’t match"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw, data: { password_set: true } });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    toast.success("Password set. Use it with your email to sign in from now on.");
    await qc.invalidateQueries({ queryKey: ["session-user"] });
    onDone();
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit}>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Set your password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account for <span className="font-mono text-foreground">{email}</span> was created by an invitation.
          Choose a password to sign in with from now on.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" minLength={10} required autoComplete="new-password" />
      </div>
      <Button type="submit" className="w-full" loading={busy}>Set password and continue</Button>
    </form>
  );
}
