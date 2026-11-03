import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "@/components/nd/public-layout";

export const Route = createFileRoute("/workflow")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "Workflow — NexWipe" },
      { name: "description", content: "From intake to release: how a laptop moves through NexWipe." },
      { property: "og:title", content: "Workflow — NexWipe" },
      { property: "og:description", content: "From intake to release: how a laptop moves through NexWipe." },
    ],
  }),
  component: WorkflowPage,
});

const STEPS = [
  { n: "01", title: "Receive", body: "Scan the asset tag, record serials, client and project. CSV rows are recorded as unverified until the agent reports identity." },
  { n: "02", title: "Identify", body: "The agent boots on the laptop and reports the system and every attached drive. Mismatches with the inventory stop the process." },
  { n: "03", title: "Authorize", body: "A technician confirms the physical laptop and target drive. Authorization is bound to the device, drive, agent, policy version and an expiring job." },
  { n: "04", title: "Execute", body: "The agent performs only methods the hardware actually supports and the policy permits. No silent fallback to weaker methods." },
  { n: "05", title: "Verify", body: "Verification is a separate step with its own result. A successful command exit is not enough." },
  { n: "06", title: "Validate & approve", body: "A reviewer validates the evidence. Only then is a credit settled and a record issued." },
  { n: "07", title: "Release", body: "A laptop is cleared only when every required drive has an approved outcome." },
];

const STATES = ["Draft", "Awaiting authorization", "Queued", "Running", "Verifying", "Awaiting validation", "Approved"];
const SIDE = ["Failed", "Interrupted", "Unsupported", "Quarantined", "Cancelled before execution"];

function WorkflowPage() {
  return (
    <PublicLayout>
      <section className="mx-auto max-w-7xl px-6 py-16">
        <h1 className="text-4xl font-semibold text-foreground">The workflow</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Every step leaves a record. Steps 02–06 depend on the agent and job engine, which are in development.
        </p>
        <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-card p-6">
              <span className="font-mono text-sm text-success">{s.n}</span>
              <h3 className="mt-2 text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>

        <h2 className="mt-16 text-2xl font-semibold text-foreground">Job states</h2>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {STATES.map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              <span className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground">{s}</span>
              {i < STATES.length - 1 && <span className="text-muted-foreground" aria-hidden>→</span>}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SIDE.map((s) => (
            <span key={s} className="rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground">{s}</span>
          ))}
        </div>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          A disconnected job is never treated as a success. A missing heartbeat means the state is unknown until reconciled.
        </p>
      </section>
    </PublicLayout>
  );
}
