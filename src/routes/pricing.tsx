import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicLayout } from "@/components/nd/public-layout";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — NextDrive" },
      { name: "description", content: "NextDrive plans: a subscription plus prepaid per-drive credits, billed only on approved drive jobs." },
      { property: "og:title", content: "Pricing — NextDrive" },
      { property: "og:description", content: "Subscription plus prepaid per-drive credits, billed only on approved drive jobs." },
    ],
  }),
  component: PricingPage,
});

// Editable placeholders. Final prices are not set.
const PLANS = [
  { name: "Pilot", price: "TBD", unit: "during pilot", features: ["1 site", "Up to 5 users", "Per-drive credits", "Email support"] },
  { name: "Operations", price: "TBD", unit: "per month", features: ["Up to 5 sites", "Unlimited users", "Per-drive credits", "Client viewer access"], featured: true },
  { name: "Enterprise", price: "Contact us", unit: "", features: ["Unlimited sites", "Custom retention", "Volume credit pricing", "Onboarding support"] },
];

function PricingPage() {
  return (
    <PublicLayout>
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-4xl font-semibold text-foreground">Pricing</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          One billable unit is one uniquely identified drive job that reaches final approval. Failed, unsupported or
          unresolved jobs are not charged. Prices below are placeholders until launch.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={
                p.featured
                  ? "rounded-xl border-2 border-success bg-card p-7 shadow-card"
                  : "rounded-xl border border-border bg-card p-7 shadow-card"
              }
            >
              <h2 className="text-lg font-semibold text-foreground">{p.name}</h2>
              <p className="mt-4 font-display text-3xl font-semibold text-foreground">{p.price}</p>
              <p className="text-sm text-muted-foreground">{p.unit || "\u00a0"}</p>
              <ul className="mt-6 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-foreground">
                    <Check className="size-4 text-success" aria-hidden /> {f}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-8 w-full" variant={p.featured ? "default" : "outline"}>
                <Link to="/pilot">Request pilot access</Link>
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-muted-foreground">Billing is not live yet. No payments are taken during the pilot.</p>
      </section>
    </PublicLayout>
  );
}
