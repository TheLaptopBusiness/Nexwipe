import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Mono, PageHeader, errorMessage } from "@/components/nd/page";
import { JOB_STATUS, SimulatedBadge, StatusBadge, ToneBadge } from "@/components/nd/status-badge";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { runSimulatorScenario } from "@/lib/simulator.functions";
import { SCENARIOS, type ScenarioId, type ScenarioResult } from "@/simulator/scenarios";

export const Route = createFileRoute("/_authenticated/app/simulator")({
  head: () => ({ meta: [{ title: "Agent simulator · NextDrive" }] }),
  component: SimulatorPage,
});

function SimulatorPage() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const run = useServerFn(runSimulatorScenario);
  const [running, setRunning] = useState<ScenarioId | null>(null);
  const [results, setResults] = useState<Partial<Record<ScenarioId, ScenarioResult>>>({});
  const [selected, setSelected] = useState<ScenarioId | null>(null);
  const allowed = can(role, "simulator.run");

  async function start(id: ScenarioId) {
    setRunning(id);
    try {
      const r = (await run({ data: { orgId, scenario: id } })) as ScenarioResult;
      setResults((prev) => ({ ...prev, [id]: r }));
      setSelected(id);
      if (!r.passed) toast.error("Scenario finished with unexpected results");
      for (const k of ["jobs", "agents", "policies"]) qc.invalidateQueries({ queryKey: [k, orgId] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(null);
    }
  }

  async function runAll() {
    for (const s of SCENARIOS) await start(s.id);
  }

  const result = selected ? results[selected] : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent simulator"
        description="Exercises the real Agent API contract with clearly labelled simulated laptops, drives, agents, jobs and evidence. It never touches a disk and can never create erasure records or usage charges."
        actions={allowed && <Button variant="outline" disabled={!!running} onClick={runAll}><Play /> Run all scenarios</Button>}
      />
      <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm text-warning" role="note">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>Each run creates a new <strong>SIMULATED</strong> laptop (asset tag <Mono>SIM-…</Mono>), simulated drives and a simulated station in this organization. By running a scenario you act as the technician who confirms each simulated target. Simulated jobs only accept simulator agents, and the simulator policy cannot be used on real devices.</p>
      </div>
      {!allowed && <p className="text-sm text-muted-foreground">Only technicians, administrators and owners can run the simulator.</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {SCENARIOS.map((s) => {
          const r = results[s.id];
          return (
            <div key={s.id} className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-foreground">{s.title}</h2>
                {r && (r.passed ? <ToneBadge tone="success" icon={CheckCircle2}>Pass</ToneBadge> : <ToneBadge tone="danger" icon={XCircle}>Unexpected</ToneBadge>)}
              </div>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{s.expect}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={!allowed || !!running} onClick={() => start(s.id)}>
                  {running === s.id ? <Loader2 className="animate-spin" /> : <FlaskConical />} Run
                </Button>
                {r && <Button size="sm" variant="ghost" onClick={() => setSelected(s.id)}>View log</Button>}
              </div>
            </div>
          );
        })}
      </div>

      {result && (
        <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-card" aria-label="Scenario result">
          <div className="flex flex-wrap items-center gap-2">
            <SimulatedBadge />
            <h2 className="font-display text-lg font-semibold text-foreground">{result.title}</h2>
            {result.passed ? <ToneBadge tone="success">All checks passed</ToneBadge> : <ToneBadge tone="danger">Some checks failed</ToneBadge>}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span>Laptop <Link to="/app/inventory/$deviceId" params={{ deviceId: result.device.id }} className="font-mono underline-offset-4 hover:underline">{result.device.asset_tag}</Link> · status {result.device.status.replace(/_/g, " ")}</span>
            {result.jobs.map((j) => (
              <span key={j.id} className="inline-flex items-center gap-2">
                <Link to="/app/jobs/$jobId" params={{ jobId: j.id }} className="font-mono underline-offset-4 hover:underline">{j.drive_serial}</Link>
                <StatusBadge map={JOB_STATUS} value={j.status} />
              </span>
            ))}
          </div>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {result.checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                <span className="text-foreground">{c.label}</span>
              </li>
            ))}
          </ul>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Request log</h3>
            <ol className="space-y-1.5">
              {result.steps.map((s) => (
                <li key={s.n} className="rounded-md border border-border">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="w-6 text-right font-mono text-xs text-muted-foreground">{s.n}</span>
                      {s.method === "—" ? <ToneBadge tone="neutral">{s.label}</ToneBadge> : <>
                        <Mono className="text-xs text-muted-foreground">{s.method}</Mono>
                        <Mono className="text-xs text-foreground">{s.path.replace("/api/public/agent/v1", "")}</Mono>
                        <ToneBadge tone={s.status < 300 ? "success" : s.status < 500 ? "warning" : "danger"}>{s.status}</ToneBadge>
                        <span className="text-muted-foreground">{s.label}</span>
                      </>}
                      {s.note && <span className="text-xs text-muted-foreground">— {s.note}</span>}
                    </summary>
                    {s.method !== "—" && (
                      <div className="grid gap-2 border-t border-border p-3 md:grid-cols-2">
                        <pre className="max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[0.6875rem] text-foreground">{JSON.stringify(s.request ?? null, null, 2)}</pre>
                        <pre className="max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[0.6875rem] text-foreground">{JSON.stringify(s.response, null, 2)}</pre>
                      </div>
                    )}
                  </details>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}
    </div>
  );
}
