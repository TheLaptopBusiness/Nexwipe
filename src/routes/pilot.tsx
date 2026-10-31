import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PublicLayout } from "@/components/nd/public-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/components/nd/page";

export const Route = createFileRoute("/pilot")({
  head: () => ({
    meta: [
      { title: "Pilot program — NextDrive" },
      { name: "description", content: "Request access to the NextDrive pilot for refurbishers, recyclers, ITAD providers and IT teams." },
      { property: "og:title", content: "Pilot program — NextDrive" },
      { property: "og:description", content: "Request access to the NextDrive pilot program." },
    ],
  }),
  component: PilotPage,
});

function PilotPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    setBusy(true);
    const { error } = await supabase.from("pilot_requests").insert({
      company: str("company") ?? "",
      contact_name: str("contact_name") ?? "",
      email: (str("email") ?? "").toLowerCase(),
      business_type: str("business_type"),
      monthly_volume: str("monthly_volume"),
      message: str("message"),
    });
    setBusy(false);
    if (error) { toast.error(errorMessage(error)); return; }
    setSent(true);
  }

  return (
    <PublicLayout>
      <section className="mx-auto grid max-w-5xl gap-12 px-6 py-16 md:grid-cols-[1fr_1.2fr]">
        <div>
          <h1 className="text-4xl font-semibold text-foreground">Pilot program</h1>
          <p className="mt-4 text-muted-foreground">
            We’re onboarding a small number of operators to use NextDrive Cloud for inventory and custody now, and to
            help qualify the erasure agent as it develops.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
            <li>• No payment during the pilot</li>
            <li>• Agent access only once it passes internal qualification</li>
            <li>• Your feedback shapes the policy and reporting model</li>
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-7 shadow-card">
          {sent ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
              <h2 className="mt-4 text-xl font-semibold text-foreground">Request received</h2>
              <p className="mt-2 text-sm text-muted-foreground">We’ll be in touch by email.</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="company">Company</Label>
                  <Input id="company" name="company" required maxLength={160} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact_name">Your name</Label>
                  <Input id="contact_name" name="contact_name" required maxLength={120} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input id="email" name="email" type="email" required maxLength={254} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="business_type">Business type</Label>
                  <Input id="business_type" name="business_type" placeholder="Refurbisher, ITAD, IT dept…" maxLength={60} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="monthly_volume">Laptops per month</Label>
                  <Input id="monthly_volume" name="monthly_volume" placeholder="e.g. 500" maxLength={60} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="message">Anything else?</Label>
                <Textarea id="message" name="message" rows={4} maxLength={2000} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Sending…" : "Request pilot access"}
              </Button>
            </form>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
