import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import type { Row, Section } from "@/lib/connected-device";

/** Code 128 barcode of a NexWipe device code. Always black on white so a scanner can read it in dark mode too. */
export function DeviceBarcode({ code, height = 64 }: { code: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, code, { format: "CODE128", height, width: 2, margin: 8, fontSize: 16, font: "monospace", background: "#ffffff", lineColor: "#000000" });
  }, [code, height]);
  return (
    <div className="inline-block rounded-md border border-border bg-white p-1">
      <svg ref={ref} role="img" aria-label={`Barcode for device code ${code}`} />
    </div>
  );
}

export function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`size-2 rounded-full ${online ? "bg-success" : "bg-muted-foreground/40"}`} aria-hidden />
      {online ? "Connected" : "Not connected"}
    </span>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="break-words text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionCard({ section }: { section: Section }) {
  const items = section.items ?? [];
  const empty = section.rows.length === 0 && items.every((i) => i.length === 0);
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 className="font-medium text-foreground">{section.title}</h2>
      {empty ? (
        <p className="text-sm text-muted-foreground">{section.empty ?? "Not reported"}</p>
      ) : (
        <>
          {section.rows.length > 0 && <Rows rows={section.rows} />}
          {items.filter((i) => i.length > 0).map((item, i) => (
            <div key={i} className="border-t border-border pt-2"><Rows rows={item} /></div>
          ))}
        </>
      )}
    </section>
  );
}
