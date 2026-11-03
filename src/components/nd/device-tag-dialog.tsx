import { useEffect, useMemo, useState } from "react";
import JsBarcode from "jsbarcode";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LABEL_SIZES, type TagFields } from "@/lib/device-tag";

const DPI = 300;
const FONT = "Arial, Helvetica, sans-serif";
const STORE = "nd.labelSize";

type SizeChoice = { id: string; widthMm: number; heightMm: number };

function loadSize(): SizeChoice {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as SizeChoice | null;
    if (v && v.widthMm >= 15 && v.widthMm <= 200 && v.heightMm >= 10 && v.heightMm <= 200) return v;
  } catch { /* storage blocked or bad value: use the default */ }
  return LABEL_SIZES[0]!;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxW || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws the tag at 300 dpi in the layout of the customer's sample label. */
function drawTag(f: TagFields, wMm: number, hMm: number): HTMLCanvasElement {
  const W = Math.round((wMm / 25.4) * DPI), H = Math.round((hMm / 25.4) * DPI);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000"; ctx.textBaseline = "top";
  const pad = Math.round(H * 0.05), innerW = W - 2 * pad;
  let y = pad;

  // Title: bold, shrunk to fit one line.
  let ts = H * 0.12;
  do { ctx.font = `bold ${ts}px ${FONT}`; ts *= 0.95; } while (ctx.measureText(f.title).width > innerW && ts > H * 0.05);
  ctx.fillText(f.title, pad, y);
  y += ts * 1.3;

  // Spec line: wrapped, shrunk until it fits in 3 lines.
  if (f.spec) {
    let ss = H * 0.07, lines: string[];
    do { ctx.font = `${ss}px ${FONT}`; lines = wrap(ctx, f.spec, innerW); ss *= 0.93; } while (lines.length > 3 && ss > H * 0.035);
    if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = `${lines[2]!.replace(/\s*\S*$/, "")} …`; }
    for (const l of lines) { ctx.fillText(l, pad, y); y += ss * 1.2; }
  }

  // Footer: SN / UID on the left, GRADE on the right.
  const fs = H * 0.075, footH = fs * 2.5;
  const footY = H - pad - footH;
  ctx.font = `bold ${fs}px ${FONT}`;
  ctx.fillText(`SN: ${f.serial ?? "-"}`, pad, footY + fs * 0.1);
  ctx.fillText(`UID: ${f.uid}`, pad, footY + fs * 1.35);
  const g = `GRADE: ${f.grade ?? "-"}`;
  ctx.fillText(g, W - pad - ctx.measureText(g).width, footY + fs * 0.1);

  // Barcode of the UID in the space between, with whole-pixel bars so scanners read it after printing.
  const bTop = y + H * 0.02, bH = footY - bTop - H * 0.03;
  if (bH > H * 0.08) {
    const probe = document.createElement("canvas");
    JsBarcode(probe, f.uid, { format: "CODE128", width: 1, height: 1, margin: 0, displayValue: false });
    const module = Math.max(1, Math.floor(innerW / probe.width));
    const bars = document.createElement("canvas");
    JsBarcode(bars, f.uid, { format: "CODE128", width: module, height: Math.round(bH), margin: 0, displayValue: false, background: "#ffffff", lineColor: "#000000" });
    ctx.drawImage(bars, pad + Math.floor((innerW - bars.width) / 2), Math.round(bTop));
  }
  return c;
}

function printImage(dataUrl: string, wMm: number, hMm: number) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><style>@page{size:${wMm}mm ${hMm}mm;margin:0}html,body{margin:0}img{display:block;width:${wMm}mm;height:${hMm}mm}</style></head><body><img src="${dataUrl}"></body></html>`);
  doc.close();
  const img = doc.querySelector("img")!;
  const go = () => { frame.contentWindow!.focus(); frame.contentWindow!.print(); setTimeout(() => frame.remove(), 60_000); };
  if (img.complete) go(); else img.onload = go;
}

export function DeviceTagDialog({ fields, open, onOpenChange }: { fields: TagFields; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [size, setSize] = useState<SizeChoice>(() => (typeof window === "undefined" ? LABEL_SIZES[0]! : loadSize()));
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(size)); } catch { /* per-computer convenience only */ } }, [size]);

  const valid = size.widthMm >= 15 && size.widthMm <= 200 && size.heightMm >= 10 && size.heightMm <= 200;
  const key = JSON.stringify(fields); // fields is rebuilt on every page render; redraw only when its content changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const url = useMemo(() => (open && valid ? drawTag(fields, size.widthMm, size.heightMm).toDataURL("image/png") : null), [open, valid, key, size]);

  function choose(id: string) {
    const s = LABEL_SIZES.find((x) => x.id === id);
    setSize(s ? { id: s.id, widthMm: s.widthMm, heightMm: s.heightMm } : { ...size, id: "custom" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Print tag</DialogTitle>
          <DialogDescription>Choose your label size once; this computer remembers it. In the print window pick your label printer and set scale to 100% (actual size).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Label size</Label>
            <Select value={size.id} onValueChange={choose}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LABEL_SIZES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                <SelectItem value="custom">Custom size…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {size.id === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="tag-w">Width (mm)</Label><Input id="tag-w" type="number" min={15} max={200} step={0.1} value={size.widthMm} onChange={(e) => setSize({ ...size, widthMm: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label htmlFor="tag-h">Height (mm)</Label><Input id="tag-h" type="number" min={10} max={200} step={0.1} value={size.heightMm} onChange={(e) => setSize({ ...size, heightMm: Number(e.target.value) })} /></div>
            </div>
          )}
          {url ? (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <img src={url} alt={`Tag preview for ${fields.title}, ${fields.uid}`} className="mx-auto max-h-64 w-full object-contain shadow-sm" />
            </div>
          ) : (
            <p className="text-sm text-warning">Enter a width of 15–200 mm and a height of 10–200 mm.</p>
          )}
          {!fields.grade && <p className="text-xs text-muted-foreground">Not graded yet, so GRADE prints as “-”. Set the grade on this page and print again after testing.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={!url} asChild={!!url}>
            {url ? <a href={url} download={`${fields.uid}.png`}><Download /> Download PNG</a> : <span><Download /> Download PNG</span>}
          </Button>
          <Button disabled={!url} onClick={() => url && printImage(url, size.widthMm, size.heightMm)}><Printer /> Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
