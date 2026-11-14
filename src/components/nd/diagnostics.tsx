import { useState } from "react";
import { ClipboardCheck, Keyboard, LayoutGrid } from "lucide-react";
import { ToneBadge, SimulatedBadge, type Tone } from "@/components/nd/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyboardMap } from "@/components/nd/keyboard-map";
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
  extra_keys?: string[];
  note?: string;
};

type Part = KeyboardPayload & {
  outcome?: string;
  values?: Record<string, string | number | boolean | null>;
};

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  pass: { label: "Pass", tone: "success" },
  fail: { label: "Fail", tone: "danger" },
  incomplete: { label: "Incomplete", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
};

const TEST_LABEL: Record<string, string> = {
  keyboard: "Keyboard test",
  full: "Complete test suite",
};

// Same order and names as the station's test (agent-handoff/station/nd_station/hwtest.py).
const PART_LABEL: [string, string][] = [
  ["keyboard", "Keyboard"],
  ["display", "Display"],
  ["webcam", "Webcam"],
  ["microphone", "Microphone"],
  ["speakers", "Speakers"],
  ["touchpad", "Touchpad"],
  ["battery", "Battery"],
  ["charging", "Charging port"],
  ["wifi", "Wi-Fi"],
  ["ports", "USB ports"],
  ["hinges", "Hinges"],
  ["body", "Screen & case"],
];

const VALUE_LABEL: Record<string, string> = {
  health_pct: "health %",
  charge_pct: "charge %",
  cycles: "cycles",
  picture_detail: "picture detail",
  peak_level: "peak level",
};

function obj<T>(v: unknown): T {
  return (v && typeof v === "object" ? v : {}) as T;
}

/** The keyboard part of a result: the whole result for "keyboard", result.tests.keyboard for "full". */
function keyboardOf(r: DiagnosticResult): KeyboardPayload | null {
  if (r.test === "keyboard") return obj<KeyboardPayload>(r.result);
  if (r.test === "full")
    return obj<{ tests?: { keyboard?: Part } }>(r.result).tests?.keyboard ?? null;
  return null;
}

function outcomeBadge(outcome: string | undefined) {
  const o = OUTCOME[outcome ?? ""] ?? { label: outcome ?? "?", tone: "neutral" as Tone };
  return <ToneBadge tone={o.tone}>{o.label}</ToneBadge>;
}

function valuesLine(values: Part["values"]): string {
  return Object.entries(values ?? {})
    .filter(([, v]) => v !== null && v !== "")
    .map(
      ([k, v]) =>
        `${VALUE_LABEL[k] ?? k.replace(/_/g, " ")}: ${v === true ? "yes" : v === false ? "no" : v}`,
    )
    .join(" · ");
}

function FullParts({ result }: { result: unknown }) {
  const tests = obj<{ tests?: Record<string, Part> }>(result).tests ?? {};
  return (
    <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border/60">
      {PART_LABEL.filter(([k]) => tests[k]).map(([k, label]) => {
        const p = tests[k] as Part;
        const extra =
          k === "keyboard"
            ? `${p.keys_registered?.length ?? 0} keys registered` +
              (p.extra_keys?.length ? `, ${p.extra_keys.length} extra (Fn / media)` : "")
            : valuesLine(p.values);
        return (
          <li key={k} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5">
            <span className="w-28 shrink-0 text-foreground">{label}</span>
            {outcomeBadge(p.outcome)}
            {p.note && (
              <span className={p.outcome === "fail" ? "text-danger" : "text-muted-foreground"}>
                {p.note}
              </span>
            )}
            {extra && <span className="text-xs text-muted-foreground">{extra}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Recent agent-run diagnostics for one laptop. Technician test records; not an erasure outcome. */
export function DiagnosticResultsCard({
  results,
}: {
  results: DiagnosticResult[] | null | undefined;
}) {
  const [mapFor, setMapFor] = useState<DiagnosticResult | null>(null);
  if (!results || results.length === 0) return null;
  const mapKb = mapFor ? keyboardOf(mapFor) : null;
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 className="font-medium text-foreground">Diagnostics run on the laptop</h2>
      <ul className="space-y-3">
        {results.map((r) => {
          const k = keyboardOf(r);
          const registered = k?.keys_registered?.length ?? 0;
          const flagged = k?.keys_flagged ?? [];
          const Icon = r.test === "full" ? ClipboardCheck : Keyboard;
          return (
            <li key={r.id} className="rounded-md border border-border/70 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                <span className="font-medium text-foreground">{TEST_LABEL[r.test] ?? r.test}</span>
                {outcomeBadge(r.outcome)}
                {r.is_simulated && <SimulatedBadge />}
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDateTime(r.created_at)}
                </span>
              </div>
              {r.test === "full" ? (
                <FullParts result={r.result} />
              ) : (
                k && (
                  <>
                    <p className="mt-1 text-muted-foreground">
                      {registered} key{registered === 1 ? "" : "s"} registered
                      {flagged.length > 0 && (
                        <span className="text-danger">
                          {" "}
                          · {flagged.length} flagged: {flagged.join(", ")}
                        </span>
                      )}
                    </p>
                    {k.note && <p className="mt-1 text-muted-foreground">Note: {k.note}</p>}
                  </>
                )
              )}
              {r.detail && <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>}
              {k && (k.keys_registered?.length ?? 0) > 0 && (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setMapFor(r)}>
                  <LayoutGrid /> View keyboard map
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        A key registering means it was pressed, not that it feels good; the technician judges sticky
        or worn keys. Diagnostics never change a grade.
      </p>

      <Dialog open={!!mapFor} onOpenChange={(v) => !v && setMapFor(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Keyboard map{mapFor ? ` · ${formatDateTime(mapFor.created_at)}` : ""}
            </DialogTitle>
          </DialogHeader>
          {mapKb && (
            <KeyboardMap
              registered={mapKb.keys_registered ?? []}
              faultyText={mapKb.note ?? null}
              flaggedIds={mapKb.keys_flagged ?? []}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
