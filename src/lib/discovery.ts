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
