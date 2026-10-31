// Display helpers for station hardware reports. Payloads are untrusted station input.

export interface DiscoveryPayload {
  system?: { manufacturer?: string; model?: string; serial?: string; cpu?: string };
  drives?: Array<{ serial?: string; model?: string; interface?: string; capacity_bytes?: number; removable?: boolean; is_boot_medium?: boolean }>;
}

const IFACE: Record<string, string> = {
  sata_hdd: "SATA HDD",
  sata_ssd: "SATA SSD",
  nvme_ssd: "NVMe SSD",
};

export function summarizeDiscovery(p: DiscoveryPayload | null | undefined) {
  const sys = p?.system ?? {};
  const title = [sys.manufacturer, sys.model].filter(Boolean).join(" ") || "Unknown laptop";
  const drives = (Array.isArray(p?.drives) ? p!.drives : []).slice(0, 16).map((d) => ({
    serial: typeof d?.serial === "string" && d.serial.trim() ? d.serial.trim() : null,
    model: typeof d?.model === "string" && d.model.trim() ? d.model.trim() : null,
    interfaceLabel: IFACE[d?.interface ?? ""] ?? "Unsupported / other",
    capacity: typeof d?.capacity_bytes === "number" && d.capacity_bytes > 0 ? d.capacity_bytes : null,
    // Mirrors create_device_from_discovery: boot media and removable media never become laptop drives.
    ignored: d?.is_boot_medium === true || d?.removable === true,
  }));
  return { title, drives };
}

export const REVIEW_FLAG_LABELS: Record<string, string> = {
  system_serial_missing: "Laptop serial number missing",
  system_serial_placeholder: "Laptop serial number is a placeholder value",
  system_serial_matches_multiple_devices: "Laptop serial matches more than one inventory record",
  manufacturer_missing: "Manufacturer missing",
  model_missing: "Model missing",
  drive_serial_missing: "Drive serial number missing",
  duplicate_drive_serial: "Two drives report the same serial number",
  drive_attached_to_other_device: "Drive is attached to a different laptop in inventory",
  drive_model_missing: "Drive model missing",
  boot_medium_not_identified: "Station could not identify its own boot USB",
  no_internal_drives: "No internal drives found",
  raid_or_vmd_controller: "RAID / Intel VMD controller detected (not supported)",
};

export interface ReviewFlag {
  code: string;
  label: string;
  target?: string | undefined;
  detail?: string | undefined;
}

/** Normalise untrusted review flags from a station report for display. */
export function reviewFlags(raw: unknown): ReviewFlag[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ReviewFlag[] = [];
  for (const f of raw.slice(0, 50)) {
    if (!f || typeof f !== "object") continue;
    const code = String((f as { code?: unknown }).code ?? "");
    if (!/^[a-z0-9_]{3,60}$/.test(code)) continue;
    const target = typeof (f as { target?: unknown }).target === "string" ? (f as { target: string }).target.slice(0, 200) : undefined;
    const key = `${code}|${target ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const detail = typeof (f as { detail?: unknown }).detail === "string" ? (f as { detail: string }).detail.slice(0, 300) : undefined;
    out.push({ code, label: REVIEW_FLAG_LABELS[code] ?? code.replace(/_/g, " "), target, detail });
  }
  return out;
}
