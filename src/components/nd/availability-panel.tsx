import { Link } from "@tanstack/react-router";
import { CheckCircle2, CircleSlash } from "lucide-react";

/**
 * Plain statement of what customers can use today versus what is not available.
 * Keep in sync with docs/STATUS.md; never list simulated or unbuilt work as available.
 */
const AVAILABLE: { label: string; note?: string; to?: string }[] = [
  { label: "Organization, team invitations and roles", note: "Owners and administrators use two-step verification.", to: "/app/team" },
  { label: "Sites, clients and projects", to: "/app/sites" },
  { label: "Device inventory", note: "Receiving, CSV import/export, custody history and audit log.", to: "/app/inventory" },
  {
    label: "Read-only station enrollment",
    note: "A station USB reports a laptop’s hardware to inventory. It never erases drives. Physical laptop compatibility is still being verified.",
    to: "/app/agents",
  },
  {
    label: "Chromebook processing records",
    note: "Guided manual workflow. A ChromeOS reset is recorded as a ChromeOS action, not a NexWipe erasure.",
    to: "/app/chromebooks",
  },
  { label: "Erasure policies and job workflow preview", note: "Through the simulator only; every result is labeled simulated.", to: "/app/simulator" },
];

const UNAVAILABLE: { label: string; note?: string }[] = [
  { label: "Real drive erasure", note: "Disabled. No device is wiped by NexWipe today." },
  { label: "Erasure certificates for real drives", note: "None are issued." },
  { label: "Paid plans, payments and wipe credits", note: "Nothing is charged and no credits are granted or used." },
  { label: "Google Admin connection for Chromebooks", note: "Not connected." },
  { label: "Verified compatibility with physical laptops and Chromebooks", note: "Physical tests are still pending." },
];

export function AvailabilityPanel() {
  return (
    <section aria-labelledby="availability-heading" className="rounded-lg border border-border bg-card shadow-card">
      <div className="border-b border-border px-4 py-3">
        <h2 id="availability-heading" className="text-sm font-semibold text-foreground">What you can use today</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Finishing sign-up and setup gives you inventory and tracking tools. It does not mean NexWipe can erase drives yet.
        </p>
      </div>
      <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-border">
        <div className="p-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-success">Available now</h3>
          <ul className="space-y-2.5">
            {AVAILABLE.map((i) => (
              <li key={i.label} className="flex gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <div>
                  {i.to ? (
                    <Link to={i.to} className="font-medium text-foreground hover:underline">{i.label}</Link>
                  ) : (
                    <span className="font-medium text-foreground">{i.label}</span>
                  )}
                  {i.note && <p className="text-xs text-muted-foreground">{i.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-border p-4 md:border-t-0">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Not available yet</h3>
          <ul className="space-y-2.5">
            {UNAVAILABLE.map((i) => (
              <li key={i.label} className="flex gap-2 text-sm">
                <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <span className="font-medium text-foreground">{i.label}</span>
                  {i.note && <p className="text-xs text-muted-foreground">{i.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
