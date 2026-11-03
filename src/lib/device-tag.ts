// Device tag (label) content and label sizes. The payload is untrusted station input, so every value
// is type-checked and length-capped here, as in connected-device.ts.
import { batteryHealthPct } from "@/lib/connected-device";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown, max: number): Obj[] => (Array.isArray(v) ? v.slice(0, max).map(obj) : []);
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export const GRADES = [
  { value: "A", label: "A: like new" },
  { value: "B", label: "B: light wear" },
  { value: "C", label: "C: heavy wear, works" },
  { value: "D", label: "D: faulty / for parts" },
] as const;

export interface LabelSize { id: string; label: string; widthMm: number; heightMm: number }
export const LABEL_SIZES: LabelSize[] = [
  { id: "57x32", label: "2.25 × 1.25 in (57 × 32 mm) · Zebra / Rollo", widthMm: 57.15, heightMm: 31.75 },
  { id: "51x25", label: "2 × 1 in (51 × 25 mm)", widthMm: 50.8, heightMm: 25.4 },
  { id: "102x51", label: "4 × 2 in (102 × 51 mm)", widthMm: 101.6, heightMm: 50.8 },
  { id: "62x29", label: "62 × 29 mm · Brother QL", widthMm: 62, heightMm: 29 },
  { id: "89x36", label: "89 × 36 mm · Dymo LabelWriter", widthMm: 89, heightMm: 36 },
];

/** Industry module name from memory type and speed, e.g. DDR4 at 2667 MT/s -> PC4-21300. */
export function pcRating(type: string | null, speedMhz: number | null): string | null {
  const gen = type?.match(/^DDR([2-5])$/)?.[1];
  if (!gen || !speedMhz) return null;
  return `PC${gen}-${Math.floor((speedMhz * 8) / 100) * 100}`;
}

/** "Dell Inc." -> "Dell", "Hewlett-Packard" -> "HP"; other names kept as reported. */
export function brandName(m: string | null): string | null {
  if (!m) return null;
  if (/^hewlett[- ]packard/i.test(m)) return "HP";
  if (/^lenovo$/i.test(m)) return "Lenovo";
  return m.replace(/,?\s+(inc\.?|corporation|corp\.?|co\.,?\s*ltd\.?|ltd\.?)$/i, "").trim() || m;
}

export interface TagFields { title: string; spec: string; serial: string | null; uid: string; grade: string | null }

export function tagFields(payload: unknown, deviceCode: string, grade: string | null): TagFields {
  const p = obj(payload), sys = obj(p["system"]);
  const mods = arr(p["memory_modules"], 32);
  const m0 = mods[0] ?? {};
  const ram = num(sys["ram_bytes"]);
  const wifi = arr(p["network_adapters"], 16).find((n) => n["kind"] === "wifi");
  const bat = arr(p["batteries"], 4)[0];
  const health = bat ? batteryHealthPct(bat) : null;
  const parts = [
    mods.length ? String(mods.length) : null,
    num(sys["cpu_cores"]) !== null ? String(num(sys["cpu_cores"])) : null,
    num(sys["cpu_threads"]) !== null ? String(num(sys["cpu_threads"])) : null,
    ram ? String(Math.round(ram / 2 ** 30)) : null,
    pcRating(str(m0["type"], 20), num(m0["speed_mhz"])),
    str(arr(p["gpus"], 8)[0]?.["name"]),
    str(sys["cpu"]),
    str(m0["part_number"], 80),
    health !== null ? `${health}%` : null,
    wifi ? str(wifi["name"]) : null,
  ];
  return {
    title: [str(sys["model"]), brandName(str(sys["manufacturer"], 80))].filter(Boolean).join(" ") || "Unknown laptop",
    spec: parts.filter(Boolean).join(" / "),
    serial: str(sys["serial"]),
    uid: deviceCode,
    grade,
  };
}
