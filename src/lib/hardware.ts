// Initial-scope hardware support statement. This is a declared scope, not a
// qualification result: no hardware has been qualified against a real agent yet.

export const SUPPORTED_MANUFACTURERS = ["Dell", "HP", "Lenovo"] as const;

export type SupportLevel = "in_scope" | "manual_assessment" | "blocked";

export interface HardwareScopeEntry {
  name: string;
  level: SupportLevel;
  detail: string;
}

export const STORAGE_SCOPE: HardwareScopeEntry[] = [
  { name: "SATA HDD (directly attached)", level: "in_scope", detail: "Initial engine target. Qualification pending." },
  { name: "SATA SSD (directly attached)", level: "in_scope", detail: "Initial engine target. Overwrite alone is never reported as Purge." },
  { name: "NVMe SSD (directly attached)", level: "in_scope", detail: "Initial engine target. Method depends on reported controller capabilities." },
  { name: "Self-encrypting drives (SED)", level: "manual_assessment", detail: "Only where prerequisites are validated; key deletion alone is not reported as success." },
  { name: "RAID arrays / hardware RAID controllers", level: "blocked", detail: "Future work. Not supported." },
  { name: "USB storage bridges and external enclosures", level: "blocked", detail: "Future work. Not supported." },
  { name: "eMMC, SD and unusual storage controllers", level: "blocked", detail: "Future work. Not supported." },
];

export const PLATFORM_SCOPE: HardwareScopeEntry[] = [
  { name: "x86-64 Dell, HP and Lenovo laptops", level: "in_scope", detail: "Initial target platforms. Qualification pending per model." },
  { name: "Other x86-64 laptop brands", level: "manual_assessment", detail: "Refer for manual assessment." },
  { name: "Apple Mac (Intel or Apple silicon)", level: "blocked", detail: "Future work. Not supported." },
  { name: "Chromebooks", level: "manual_assessment", detail: "Priority track: guided ChromeOS processing records (management check, official reset, online setup check, diagnostics). No drive-erasure jobs; no model compatibility claimed yet." },
  { name: "Phones and tablets", level: "blocked", detail: "Future work. Not supported." },
];

export function manufacturerInScope(manufacturer: string | null | undefined): boolean {
  if (!manufacturer) return false;
  const m = manufacturer.trim().toLowerCase();
  return m.startsWith("dell") || m === "hp" || m.startsWith("hewlett") || m.startsWith("hp ") || m.startsWith("lenovo");
}
