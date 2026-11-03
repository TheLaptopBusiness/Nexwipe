// Display helpers for the Connected devices pages. The payload is untrusted station input:
// every value is type-checked and length-capped here before it reaches the screen.
import { formatBytes } from "@/lib/queries";
import { summarizeCapabilities } from "@/lib/discovery";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown, max: number): Obj[] => (Array.isArray(v) ? v.slice(0, max).map(obj) : []);
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const bool = (v: unknown, yes = "Yes", no = "No"): string | null => (v === true ? yes : v === false ? no : null);

export interface Row { label: string; value: string }
export interface Section { title: string; rows: Row[]; items?: Row[][]; empty?: string }

function rows(pairs: Array<[string, string | null]>): Row[] {
  return pairs.filter((p): p is [string, string] => p[1] !== null).map(([label, value]) => ({ label, value }));
}

/** Battery health in percent: reported value, else full-charge / design capacity. */
export function batteryHealthPct(b: Obj): number | null {
  const h = num(b["health_pct"]);
  if (h !== null) return Math.round(h);
  const full = num(b["full_charge_capacity_mwh"]), design = num(b["design_capacity_mwh"]);
  return full !== null && design ? Math.round((full / design) * 100) : null;
}

const IFACE: Record<string, string> = { sata_hdd: "SATA HDD", sata_ssd: "SATA SSD", nvme_ssd: "NVMe SSD" };

/** Short facts for one row of the Connected devices list. */
export function deviceSummary(payload: unknown) {
  const p = obj(payload), sys = obj(p["system"]), os = obj(p["os"]);
  const drives = arr(p["drives"], 16).filter((d) => d["is_boot_medium"] !== true && d["removable"] !== true);
  const storage = drives.reduce((t, d) => t + (num(d["capacity_bytes"]) ?? 0), 0);
  const bat = arr(p["batteries"], 4)[0];
  return {
    title: [str(sys["manufacturer"], 80), str(sys["model"])].filter(Boolean).join(" ") || "Unknown laptop",
    cpu: str(sys["cpu"]),
    ram: num(sys["ram_bytes"]) ? formatBytes(num(sys["ram_bytes"])) : null,
    storage: storage > 0 ? `${formatBytes(storage)} · ${drives.length} drive${drives.length === 1 ? "" : "s"}` : null,
    battery: bat ? batteryHealthPct(bat) : null,
    os: [str(os["name"]), str(os["version"], 60)].filter(Boolean).join(" ") || null,
  };
}

/** Where the report came from, from the station's enrolled platform. */
export function stationContext(platform: string | null | undefined): string {
  return platform?.toLowerCase().startsWith("windows") ? "Running inside Windows (NexWipe helper)" : "Booted from the NexWipe stick";
}

export function canRebootToUsb(platform: string | null | undefined): boolean {
  return !!platform?.toLowerCase().startsWith("windows");
}

/** A station is online when its last heartbeat is recent. The boot-stick station heartbeats every 30 s. */
export function isOnline(lastHeartbeat: string | null | undefined, now = Date.now()): boolean {
  if (!lastHeartbeat) return false;
  const t = Date.parse(lastHeartbeat);
  return Number.isFinite(t) && now - t < 90_000;
}

/** Every section on the device detail page, in display order. */
export function deviceSections(payload: unknown): Section[] {
  const p = obj(payload), sys = obj(p["system"]), os = obj(p["os"]), sec = obj(p["security"]), st = obj(p["station"]);
  const ram = num(sys["ram_bytes"]);
  const out: Section[] = [
    { title: "System", rows: rows([
      ["Manufacturer", str(sys["manufacturer"], 80)], ["Model", str(sys["model"])], ["Serial number", str(sys["serial"])],
      ["SKU", str(sys["sku"])], ["Chassis", str(sys["chassis"], 60)], ["Asset tag (firmware)", str(sys["asset_tag"])],
      ["System UUID", str(sys["uuid"], 64)], ["Motherboard", str(sys["board"])],
    ]) },
    { title: "Processor", rows: rows([
      ["CPU", str(sys["cpu"])], ["Cores", num(sys["cpu_cores"])?.toString() ?? null], ["Threads", num(sys["cpu_threads"])?.toString() ?? null],
    ]) },
  ];

  const mods = arr(p["memory_modules"], 32);
  out.push({ title: "Memory", rows: rows([["Total", ram ? formatBytes(ram) : null], ["Modules", mods.length ? String(mods.length) : null]]),
    items: mods.map((m) => rows([
      ["Slot", str(m["slot"], 60)], ["Size", num(m["size_bytes"]) ? formatBytes(num(m["size_bytes"])) : null], ["Type", str(m["type"], 40)],
      ["Speed", num(m["speed_mhz"]) ? `${num(m["speed_mhz"])} MHz` : null], ["Manufacturer", str(m["manufacturer"], 80)],
      ["Part number", str(m["part_number"], 80)], ["Serial", str(m["serial"], 80)],
    ])) });

  const drives = arr(p["drives"], 16);
  out.push({ title: "Storage", rows: [], empty: "No drives reported",
    items: drives.map((d) => rows([
      ["Model", str(d["model"])], ["Serial", str(d["serial"])], ["Type", IFACE[String(d["interface"])] ?? "Unsupported / other"],
      ["Capacity", num(d["capacity_bytes"]) ? formatBytes(num(d["capacity_bytes"])) : null], ["Firmware", str(d["firmware"], 60)],
      ["Connection", str(d["transport"], 40)],
      ["Note", d["is_boot_medium"] === true ? "NexWipe stick · not recorded" : d["removable"] === true ? "Removable · not recorded" : null],
      ["Drive advertises", capabilityText(d)],
    ])) });

  const bats = arr(p["batteries"], 4);
  out.push({ title: "Battery", rows: [], empty: "No battery reported",
    items: bats.map((b) => {
      const h = batteryHealthPct(b);
      return rows([
        ["Health", h !== null ? `${h}%` : null], ["Cycle count", num(b["cycle_count"])?.toString() ?? null],
        ["Design capacity", num(b["design_capacity_mwh"]) ? `${num(b["design_capacity_mwh"])} mWh` : null],
        ["Full-charge capacity", num(b["full_charge_capacity_mwh"]) ? `${num(b["full_charge_capacity_mwh"])} mWh` : null],
        ["Status", str(b["status"], 40)], ["Chemistry", str(b["chemistry"], 40)], ["Manufacturer", str(b["manufacturer"], 80)],
        ["Name", str(b["name"], 80)], ["Serial", str(b["serial"], 80)],
      ]);
    }) });

  out.push({ title: "Graphics", rows: [], empty: "Not reported",
    items: arr(p["gpus"], 8).map((g) => rows([["Name", str(g["name"])], ["Memory", num(g["vram_bytes"]) ? formatBytes(num(g["vram_bytes"])) : null], ["Driver", str(g["driver_version"], 60)]])) });
  out.push({ title: "Network", rows: [], empty: "Not reported",
    items: arr(p["network_adapters"], 16).map((n) => rows([["Name", str(n["name"])], ["Type", str(n["kind"], 20)], ["MAC address", str(n["mac"], 40)]])) });

  const bl = arr(sec["bitlocker"], 16).map((v) => `${str(v["volume"], 20) ?? "?"} ${str(v["protection"], 10) ?? "unknown"}`);
  out.push({ title: "Firmware & security", rows: rows([
    ["Boot mode", str(sys["boot_mode"], 20)?.toUpperCase() ?? null], ["Secure Boot", bool(sys["secure_boot"], "On", "Off")],
    ["BIOS vendor", str(sys["bios_vendor"], 80)], ["BIOS version", str(sys["bios_version"], 80)], ["BIOS date", str(sys["bios_date"], 40)],
    ["TPM", bool(sec["tpm_present"], str(sec["tpm_version"], 40) ? `Present (${str(sec["tpm_version"], 40)})` : "Present", "Not found")],
    ["BitLocker", bl.length ? bl.join(" · ") : null],
  ]) });
  out.push({ title: "Operating system", rows: rows([
    ["Name", str(os["name"])], ["Version", str(os["version"], 60)], ["Build", str(os["build"], 60)], ["Architecture", str(os["architecture"], 40)],
  ]), empty: "Not reported (booted from the NexWipe stick)" });
  out.push({ title: "Reported by", rows: rows([
    ["Program version", str(st["agent_version"], 40)], ["Image version", str(st["image_version"], 60)], ["Kernel / OS", str(st["kernel"])],
  ]) });
  return out;
}

/** "Drive advertises" text: erase features from the drive's own identify data. Nothing has been run. */
function capabilityText(d: Obj): string | null {
  if (d["is_boot_medium"] === true || d["removable"] === true) return null;
  const c = summarizeCapabilities(d["capabilities"]);
  if (!c) return null;
  return c.unknown ?? [...c.advertised, ...c.notes].join(" · ");
}

/** Postgres "column/table does not exist": the database has not received migration 0018 yet. */
export function needsDbUpdate(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42703" || code === "42P01";
}
