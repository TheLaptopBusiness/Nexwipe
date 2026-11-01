// Display helpers for station hardware reports. Payloads are untrusted station input.

export interface DiscoveryPayload {
  system?: { manufacturer?: string; model?: string; serial?: string; cpu?: string };
  drives?: Array<{ serial?: string; model?: string; interface?: string; capacity_bytes?: number; removable?: boolean; is_boot_medium?: boolean; capabilities?: unknown }>;
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
    capabilities: summarizeCapabilities(d?.capabilities),
  }));
  return { title, drives };
}

export interface CapabilitySummary {
  /** Features the drive advertises. Never a statement that an erase was run or would succeed. */
  advertised: string[];
  notes: string[];
  unknown: string | null;
}

const yes = (o: unknown, k: string) => !!o && typeof o === "object" && (o as Record<string, unknown>)[k] === true;

/** Plain-language summary of a station-reported capability block (untrusted input). */
export function summarizeCapabilities(raw: unknown): CapabilitySummary | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const advertised: string[] = [];
  const notes: string[] = [];
  if (c["source"] === "unavailable") {
    const reason = typeof c["reason"] === "string" ? c["reason"].slice(0, 160) : "not reported";
    return { advertised, notes, unknown: `Capabilities unknown (${reason})` };
  }
  if (c["source"] === "ata_identify_sysfs") {
    const sec = c["ata_security"], san = c["ata_sanitize_feature"];
    if (yes(san, "supported")) {
      const m = ["crypto_scramble", "block_erase", "overwrite"].filter((k) => yes(san, k)).map((k) => k.replace("_", " "));
      advertised.push(`ATA Sanitize${m.length ? ` (${m.join(", ")})` : ""}`);
    }
    if (yes(sec, "supported")) advertised.push(yes(sec, "enhanced_erase_supported") ? "ATA Security Erase (normal + enhanced)" : "ATA Security Erase (normal)");
    if (yes(sec, "frozen")) notes.push("Security commands frozen by firmware at boot");
    if (yes(sec, "locked")) notes.push("Drive is password-locked");
    if (yes(sec, "enabled")) notes.push("A drive password is set");
  } else if (c["source"] === "nvme_identify_controller") {
    const fmt = c["nvme_format_nvm"], san = c["nvme_sanitize_feature"];
    if (yes(san, "supported")) {
      const m = ["crypto_erase", "block_erase", "overwrite"].filter((k) => yes(san, k)).map((k) => k.replace("_", " "));
      advertised.push(`NVMe Sanitize (${m.join(", ")})`);
    }
    if (yes(fmt, "supported")) advertised.push(yes(fmt, "crypto_erase") ? "NVMe Format (user-data erase + crypto erase)" : "NVMe Format (user-data erase)");
    const n = typeof c["nvme_namespace_count"] === "number" ? c["nvme_namespace_count"] : null;
    if (n !== null && n > 1) notes.push(`Controller supports up to ${n} namespaces`);
  } else {
    return null;
  }
  if (advertised.length === 0) notes.unshift("No erase features advertised");
  return { advertised, notes, unknown: null };
}

export const REVIEW_FLAG_LABELS: Record<string, string> = {
  synthetic_hardware: "Synthetic or virtual test hardware (never station-reported)",
  drive_capabilities_unknown: "Drive erase capabilities could not be read",
  ata_security_frozen: "Drive security commands are frozen by the laptop firmware",
  ata_security_locked: "Drive is password-locked",
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
