import { createFileRoute, Link } from "@tanstack/react-router";
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

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Book a Demo — NexWipe" },
      { name: "description", content: "Book a NexWipe demo for your refurbishment, recycling, ITAD or IT team." },
      { property: "og:title", content: "Book a Demo — NexWipe" },
      { property: "og:description", content: "See NexWipe inventory, custody and station workflows with our team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DemoPage,
});

function DemoPage() {
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
          <h1 className="text-4xl font-semibold text-foreground">Book a Demo</h1>
          <p className="mt-4 text-muted-foreground">
            Tell us about your operation and we’ll walk you through NexWipe: intake and inventory, custody records,
            sites and teams, and connecting a read-only station.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
            <li>• A live walkthrough with our team</li>
            <li>• Answers about supported hardware and setup</li>
            <li>• Prefer to explore yourself? <Link to="/signup" className="text-foreground underline underline-offset-4">Start Now</Link></li>
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-7 shadow-card">
          {sent ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
              <h2 className="mt-4 text-xl font-semibold text-foreground">Request received</h2>
              <p className="mt-2 text-sm text-muted-foreground">We’ll email you to schedule your demo.</p>
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
                {busy ? "Sending…" : "Book a Demo"}
              </Button>
            </form>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
