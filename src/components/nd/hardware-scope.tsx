import { PLATFORM_SCOPE, STORAGE_SCOPE, type HardwareScopeEntry } from "@/lib/hardware";
import { StatusBadge, SUPPORT_LEVEL } from "@/components/nd/status-badge";

function ScopeTable({ title, rows }: { title: string; rows: HardwareScopeEntry[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">{title}</div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
              <td className="px-4 py-3">
                <StatusBadge map={SUPPORT_LEVEL} value={r.level} />
              </td>
              <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HardwareScope() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
        This is the declared initial scope, not a qualification list. No model has yet been qualified against a production
        agent. Anything outside the scope is blocked or referred for manual assessment.
      </div>
      <ScopeTable title="Platforms" rows={PLATFORM_SCOPE} />
      <ScopeTable title="Storage" rows={STORAGE_SCOPE} />
    </div>
  );
}
