import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicLayout } from "@/components/nd/public-layout";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — NexWipe" },
      { name: "description", content: "NexWipe plans from $99/month: Starter, Business and Warehouse, with included drive wipes and low per-wipe overage." },
      { property: "og:title", content: "Pricing — NexWipe" },
      { property: "og:description", content: "Simple pricing built to grow with you: Starter $99, Business $249, Warehouse $599 per month." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PricingPage,
});

export const PLANS = [
  { name: "Starter", price: 99, included: 100, extra: "$1.00", bestFor: "Small resellers" },
  { name: "Business", price: 249, included: 500, extra: "$0.50", bestFor: "Growing refurbishers", featured: true },
  { name: "Warehouse", price: 599, included: 2000, extra: "$0.25", bestFor: "High-volume operations" },
] as const;

const INCLUDED = ["Asset tracking", "Wipe reports", "Team access"];

function PricingPage() {
  return (
    <PublicLayout>
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-4xl font-semibold text-foreground">Simple pricing. Built to grow with you.</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Every plan includes asset tracking, wipe reports, and team access.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {PLANS.map((p) => {
            const featured = "featured" in p && p.featured;
            return (
              <div
                key={p.name}
                className={
                  featured
                    ? "relative rounded-xl border-2 border-success bg-card p-7 shadow-card"
                    : "relative rounded-xl border border-border bg-card p-7 shadow-card"
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{p.name}</h2>
                  {featured && (
                    <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
                      Most Popular
                    </span>
                  )}
                </div>
                <p className="mt-4 font-display text-4xl font-semibold text-foreground">
                  ${p.price}
                  <span className="ml-1 text-base font-normal text-muted-foreground">/month</span>
                </p>
                <dl className="mt-6 space-y-3 text-sm">
                  <div className="flex justify-between gap-4 border-b border-border pb-3">
                    <dt className="text-muted-foreground">Successful drive wipes</dt>
                    <dd className="font-medium text-foreground">{p.included.toLocaleString("en-US")}/month</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-border pb-3">
                    <dt className="text-muted-foreground">Additional wipes</dt>
                    <dd className="font-medium text-foreground">{p.extra} each</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Best for</dt>
                    <dd className="text-right font-medium text-foreground">{p.bestFor}</dd>
                  </div>
                </dl>
                <ul className="mt-6 space-y-2 text-sm">
                  {INCLUDED.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-foreground">
                      <Check className="size-4 text-success" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-8 w-full" variant={featured ? "default" : "outline"}>
                  <Link to="/signup">Choose {p.name}</Link>
                </Button>
              </div>
            );
          })}
        </div>

        <p className="mt-8 max-w-3xl text-sm text-muted-foreground">
          One wipe credit covers one physical drive. Failed attempts and verification retries don’t consume additional
          credits. Included wipes reset each month.
        </p>

        <div className="mt-10 flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <p className="text-lg font-medium text-foreground">Create your account. No credit card required.</p>
          <div className="flex gap-3">
            <Button asChild>
              <Link to="/signup">Start Now</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/demo">Book a Demo</Link>
            </Button>
          </div>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Paid plans, wipe credits and production drive wiping are not available yet, and no payments are taken.
          New accounts can use inventory and custody tracking, read-only station discovery and the clearly labeled
          agent simulator. Choosing a plan creates your account; plan selection opens when billing launches.
        </p>
      </section>
    </PublicLayout>
  );
}
