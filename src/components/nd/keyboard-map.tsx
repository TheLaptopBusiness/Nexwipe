import { KEYBOARD_ROWS, matchFaultyKeys } from "@/lib/keyboard-layout";

/**
 * A picture of a keyboard for a diagnostic report: green = the key registered during the test,
 * red = reported faulty by the technician, grey = not pressed / the laptop may not have it.
 * Faulty keys come from the technician's free text (best-effort match) and any structured flags.
 */
export function KeyboardMap({
  registered,
  faultyText,
  flaggedIds,
}: {
  registered: string[];
  faultyText?: string | null;
  flaggedIds?: string[];
}) {
  const reg = new Set(registered);
  const { redIds, unmatched } = matchFaultyKeys(faultyText, flaggedIds ?? []);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div className="inline-block space-y-1">
          {KEYBOARD_ROWS.map((row, i) => (
            <div key={i} className="flex gap-1">
              {row.map((k) => {
                const red = redIds.has(k.id);
                const green = !red && reg.has(k.id);
                const tone = red
                  ? "border-danger/50 bg-danger-soft text-danger"
                  : green
                    ? "border-success/40 bg-success-soft text-success"
                    : "border-border bg-neutral-soft text-muted-foreground";
                return (
                  <div
                    key={k.id}
                    title={k.id}
                    style={{ width: k.w ?? 40 }}
                    className={`flex h-7 shrink-0 items-center justify-center rounded border text-[10px] font-medium ${tone}`}
                  >
                    {k.t}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded border border-success/40 bg-success-soft" /> Registered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded border border-danger/50 bg-danger-soft" /> Reported faulty
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded border border-border bg-neutral-soft" /> Not pressed / not
          on this laptop
        </span>
      </div>

      {unmatched.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Reported faulty but not placed on the map:{" "}
          <span className="text-danger">{unmatched.join(", ")}</span>
        </p>
      )}
    </div>
  );
}
