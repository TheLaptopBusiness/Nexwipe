import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, ClipboardCheck, Cloud, Cpu, FileCheck2, HardDrive, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicLayout } from "@/components/nd/public-layout";
import { ToneBadge } from "@/components/nd/status-badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NexWipe — Laptop data-erasure operations platform" },
      {
        name: "description",
        content:
          "NexWipe Cloud tracks laptops and drives, orchestrates authorized erasure jobs and keeps evidence records for refurbishers and ITAD teams.",
      },
      { property: "og:title", content: "NexWipe — Wipe. Verify. Renew." },
      {
        property: "og:description",
        content: "Inventory, authorization and evidence records for laptop data-erasure operations.",
      },
    ],
  }),
  component: Home,
});

const SAMPLE_ROWS = [
  { tag: "UTS-10482", device: "Dell Latitude 5420", drive: "NVMe · S6EXNX0R…", phase: "Verifying", tone: "info" as const },
  { tag: "UTS-10483", device: "Lenovo ThinkPad T14", drive: "NVMe · 21B4A8…", phase: "Awaiting validation", tone: "warning" as const },
  { tag: "UTS-10484", device: "HP EliteBook 840 G8", drive: "SATA SSD · 2219E5…", phase: "Approved", tone: "success" as const },
  { tag: "UTS-10485", device: "Dell Latitude 7400", drive: "SATA HDD · WD-WX…", phase: "Heartbeat lost — unknown", tone: "danger" as const },
];

function Home() {
  return (
    <PublicLayout>
      <section className="bg-blueprint">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.05fr_1fr] lg:py-28">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">Wipe. Verify. Renew.</p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] text-navy-foreground md:text-5xl">
              Erasure operations you can account for, drive by drive.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-navy-muted">
              NexWipe Cloud tracks every laptop and every drive from intake to release, requires explicit
              authorization before anything destructive happens, and keeps the evidence your auditors ask for.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild variant="signal" size="lg">
                <Link to="/pilot">
                  Join the pilot program <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="onNavy" size="lg">
                <Link to="/workflow">See the workflow</Link>
              </Button>
            </div>
            <p className="mt-8 max-w-xl text-xs leading-relaxed text-navy-muted">
              In development. The bootable erasure agent is not yet available for production use, and NexWipe holds
              no certifications.
            </p>
          </div>

          <div className="self-center rounded-xl border border-navy-foreground/10 bg-card p-1 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-medium text-foreground">Live drive jobs</span>
              <span className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
                Illustration · sample data
              </span>
            </div>
            <div className="divide-y divide-border">
              {SAMPLE_ROWS.map((r) => (
                <div key={r.tag} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3">
                  <span className="font-mono text-xs text-muted-foreground">{r.tag}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{r.device}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{r.drive}</p>
                  </div>
                  <ToneBadge tone={r.tone}>{r.phase}</ToneBadge>
                </div>
              ))}
            </div>
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              A lost heartbeat never becomes a success. The job stays unknown until reconciled.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold text-foreground">Two components, one clear boundary</h2>
          <p className="mt-3 text-muted-foreground">
            A browser cannot securely erase a laptop’s internal drive. NexWipe separates the work accordingly.
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-7 shadow-card">
            <Cloud className="size-6 text-success" aria-hidden />
            <h3 className="mt-4 text-xl font-semibold text-foreground">NexWipe Cloud</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Customer accounts, sites and clients, device and drive inventory, chain of custody, job authorization,
              evidence storage, reports and billing.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-7 shadow-card">
            <Cpu className="size-6 text-info" aria-hidden />
            <h3 className="mt-4 text-xl font-semibold text-foreground">NexWipe Agent</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Bootable Linux software that runs on the laptop itself: identifies drives, detects capabilities, performs
              supported sanitization operations and collects evidence. Developed separately; not yet released.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-16 md:grid-cols-4">
          {[
            { icon: Boxes, title: "Intake", body: "Asset tags, serials, clients and projects. CSV and barcode-scanner friendly." },
            { icon: HardDrive, title: "Drive identity", body: "Drives tracked separately from laptops, with full attachment history." },
            { icon: ShieldCheck, title: "Authorization", body: "Bound to a specific device, drive, agent and policy version. Never unattended by default." },
            { icon: FileCheck2, title: "Evidence", body: "Execution, verification and validation recorded as separate outcomes." },
          ].map((f) => (
            <div key={f.title}>
              <f.icon className="size-5 text-success" aria-hidden />
              <h3 className="mt-3 font-semibold text-foreground">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-xl bg-blueprint p-10">
          <div className="max-w-xl">
            <ClipboardCheck className="size-6 text-signal" aria-hidden />
            <h2 className="mt-3 text-2xl font-semibold text-navy-foreground">Built inside a working refurbishment shop</h2>
            <p className="mt-2 text-navy-muted">
              NexWipe is being developed and used first at Used Tech Solutions. A limited pilot is open to
              refurbishers, recyclers, ITAD providers and internal IT teams.
            </p>
          </div>
          <Button asChild variant="signal" size="lg">
            <Link to="/pilot">Request pilot access</Link>
          </Button>
        </div>
      </section>
    </PublicLayout>
  );
}
