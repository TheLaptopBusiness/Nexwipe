import { Keyboard } from "lucide-react";
import { ToneBadge, SimulatedBadge, type Tone } from "@/components/nd/status-badge";
import { formatDateTime } from "@/lib/queries";

export type DiagnosticResult = {
  id: number;
  test: string;
  outcome: string;
  result: unknown;
  detail: string | null;
  is_simulated: boolean;
  created_at: string;
};

type KeyboardPayload = {
  layout?: string;
  keys_registered?: string[];
  keys_flagged?: string[];
  note?: string;
};

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  pass: { label: "Pass", tone: "success" },
  fail: { label: "Fail", tone: "danger" },
  incomplete: { label: "Incomplete", tone: "neutral" },
};

const TEST_LABEL: Record<string, string> = { keyboard: "Keyboard test" };

function kb(result: unknown): KeyboardPayload {
  return (result && typeof result === "object" ? result : {}) as KeyboardPayload;
}

/** Recent agent-run diagnostics for one laptop. Technician test records; not an erasure outcome. */
export function DiagnosticResultsCard({
  results,
}: {
  results: DiagnosticResult[] | null | undefined;
}) {
  if (!results || results.length === 0) return null;
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 className="font-medium text-foreground">Diagnostics run on the laptop</h2>
      <ul className="space-y-3">
        {results.map((r) => {
          const o = OUTCOME[r.outcome] ?? { label: r.outcome, tone: "neutral" as Tone };
          const k = r.test === "keyboard" ? kb(r.result) : null;
          const registered = k?.keys_registered?.length ?? 0;
          const flagged = k?.keys_flagged ?? [];
          return (
            <li key={r.id} className="rounded-md border border-border/70 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Keyboard className="size-4 text-muted-foreground" />
                <span className="font-medium text-foreground">{TEST_LABEL[r.test] ?? r.test}</span>
                <ToneBadge tone={o.tone}>{o.label}</ToneBadge>
                {r.is_simulated && <SimulatedBadge />}
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDateTime(r.created_at)}
                </span>
              </div>
              {k && (
                <p className="mt-1 text-muted-foreground">
                  {registered} key{registered === 1 ? "" : "s"} registered
                  {flagged.length > 0 && (
                    <span className="text-danger">
                      {" "}
                      · {flagged.length} flagged: {flagged.join(", ")}
                    </span>
                  )}
                </p>
              )}
              {k?.note && <p className="mt-1 text-muted-foreground">Note: {k.note}</p>}
              {r.detail && <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        A key registering means it was pressed, not that it feels good; the technician judges sticky
        or worn keys.
      </p>
    </section>
  );
}
