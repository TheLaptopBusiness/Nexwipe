import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Mono } from "@/components/nd/page";
import { ToneBadge } from "@/components/nd/status-badge";
import { FEASIBILITY, FEASIBILITY_LABEL, MODEL_RESEARCH, RESEARCH_SOURCE } from "@/lib/chromebook";

export const Route = createFileRoute("/_authenticated/app/chromebooks/research")({
  staticData: { sitemap: false },
  head: () => ({ meta: [{ title: "Chromebook compatibility research — NexWipe" }] }),
  component: Research,
});

function Research() {
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Chromebook compatibility research"
        description="Research notes, not qualification results. No Chromebook has been tested by NexWipe, and the existing x86-64 station USB is not assumed to work on any Chromebook."
      />
      <section className="space-y-2">
        <h2 className="font-semibold">Priority models</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">Model</th><th className="px-3 py-2">Board</th><th className="px-3 py-2">Architecture</th><th className="px-3 py-2">Storage</th><th className="px-3 py-2">Compatibility</th><th className="px-3 py-2">Notes</th></tr>
            </thead>
            <tbody>
              {MODEL_RESEARCH.map((m) => (
                <tr key={m.model} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{m.model}</td>
                  <td className="px-3 py-2">{m.boardStatus === "identified" ? <Mono>{m.board}</Mono> : <ToneBadge tone="warning">Unconfirmed</ToneBadge>}</td>
                  <td className="px-3 py-2">{m.arch === "x86_64" ? "x86-64" : m.arch === "arm" ? "ARM (believed)" : "Unknown"}</td>
                  <td className="px-3 py-2 text-xs">{m.storage}</td>
                  <td className="px-3 py-2"><ToneBadge tone="neutral">Not claimed</ToneBadge></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Source: {RESEARCH_SOURCE} AUE dates are not filled in here: record them per device from Google's Auto Update policy page with the retrieval date.</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Feasibility matrix</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">Path</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Detail</th></tr>
            </thead>
            <tbody>
              {FEASIBILITY.map((f) => (
                <tr key={f.path} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{f.path}</td>
                  <td className="px-3 py-2"><ToneBadge tone={FEASIBILITY_LABEL[f.status].tone}>{FEASIBILITY_LABEL[f.status].label}</ToneBadge></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{f.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-lg border border-dashed border-border bg-card p-5 text-sm">
        <h2 className="font-semibold">Google Admin integration</h2>
        <p className="mt-1"><ToneBadge tone="neutral">Not connected</ToneBadge></p>
        <p className="mt-2 text-muted-foreground">Planned as an optional, organization-scoped connection that a school authorizes for its own Google Workspace. Read-only inventory and status first; deprovision or remote reset actions only after permissions, licensing and API behaviour are validated. Tokens would be stored server-side only. An accepted command is never shown as a completed reset. Design: <Mono>docs/chromebook/GOOGLE_ADMIN_INTEGRATION.md</Mono>.</p>
      </section>
    </div>
  );
}
