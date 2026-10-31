import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, CircleDashed, Clock } from "lucide-react";
import { PublicLayout } from "@/components/nd/public-layout";
import { ToneBadge } from "@/components/nd/status-badge";

export const Route = createFileRoute("/product")({
  head: () => ({
    meta: [
      { title: "Product — NextDrive" },
      { name: "description", content: "What NextDrive Cloud does today, what is in development, and what is planned." },
      { property: "og:title", content: "Product — NextDrive" },
      { property: "og:description", content: "Capabilities available today, in development, and planned." },
    ],
  }),
  component: ProductPage,
});

const AVAILABLE = [
  "Multi-company accounts with separate data per organization",
  "Roles: owner, administrator, technician, auditor, customer viewer",
  "Team invitations, password reset, email verification and authenticator-app MFA",
  "Sites, downstream clients, projects and batches",
  "Laptop inventory with search, filters, CSV import/export and scanner-friendly asset-tag entry",
  "Drives tracked separately from laptops, with attachment history",
  "Automatic chain-of-custody timeline and append-only audit history",
];
const IN_DEVELOPMENT = [
  "Versioned processing policies",
  "Server-enforced job state machine and destructive-action authorization",
  "Versioned agent API, OpenAPI specification and a clearly labeled agent simulator",
  "Live job monitoring, evidence storage and review workflow",
  "Erasure records (PDF) with demo watermarking and opaque QR verification",
  "Subscriptions and prepaid per-drive credits",
];
const PLANNED = [
  "Production bootable agent for SATA HDD, SATA SSD and NVMe on Dell, HP and Lenovo laptops",
  "Hardware compatibility qualification",
  "Independent assessment of the erasure engine",
];

function Column({ title, tone, icon, items }: { title: string; tone: "success" | "info" | "neutral"; icon: typeof Clock; items: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-card">
      <ToneBadge tone={tone} icon={icon}>{title}</ToneBadge>
      <ul className="mt-5 space-y-3 text-sm text-foreground">
        {items.map((i) => (
          <li key={i} className="leading-relaxed">{i}</li>
        ))}
      </ul>
    </div>
  );
}

function ProductPage() {
  return (
    <PublicLayout>
      <section className="mx-auto max-w-7xl px-6 py-16">
        <h1 className="text-4xl font-semibold text-foreground">What NextDrive does</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          We list capabilities by their actual status. Nothing below the “Available” column should be relied on for
          production erasure today.
        </p>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          <Column title="Available" tone="success" icon={CheckCircle2} items={AVAILABLE} />
          <Column title="In development" tone="info" icon={Clock} items={IN_DEVELOPMENT} />
          <Column title="Planned" tone="neutral" icon={CircleDashed} items={PLANNED} />
        </div>
        <div className="mt-10 rounded-xl border border-border bg-muted p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">On certifications</p>
          <p className="mt-1">
            NextDrive is not NIST certified, ADISA certified or R2 certified, and has not been independently validated.
            We will only state otherwise once a real assessment exists.
          </p>
        </div>
      </section>
    </PublicLayout>
  );
}
