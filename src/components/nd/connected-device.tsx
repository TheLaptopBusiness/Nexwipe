import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

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
