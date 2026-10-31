// UI mirror of the job rules. The database (guard_job_update, agent_job_event, review_job) is the
// authority; these helpers only decide what to show.

export type JobStatus =
  | "draft"
  | "awaiting_authorization"
  | "queued"
  | "running"
  | "verifying"
  | "awaiting_validation"
  | "approved"
  | "failed"
  | "interrupted"
  | "unsupported"
  | "quarantined"
  | "cancelled";

export const TERMINAL: JobStatus[] = ["approved", "failed", "unsupported", "quarantined", "cancelled"];
export const ACTIVE: JobStatus[] = ["queued", "running", "verifying", "interrupted"];
export const EXCEPTION: JobStatus[] = ["failed", "interrupted", "unsupported", "quarantined"];

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ["awaiting_authorization", "cancelled", "unsupported"],
  awaiting_authorization: ["queued", "cancelled", "unsupported"],
  queued: ["running", "awaiting_authorization", "cancelled", "unsupported", "quarantined"],
  running: ["verifying", "failed", "quarantined", "interrupted", "unsupported"],
  verifying: ["awaiting_validation", "failed", "quarantined", "interrupted"],
  interrupted: ["running", "verifying", "failed", "quarantined"],
  awaiting_validation: ["approved", "quarantined"],
  approved: [],
  failed: [],
  unsupported: [],
  quarantined: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(s: JobStatus): boolean {
  return TERMINAL.includes(s);
}

export const PIPELINE: { status: JobStatus; label: string }[] = [
  { status: "draft", label: "Draft" },
  { status: "awaiting_authorization", label: "Awaiting authorization" },
  { status: "queued", label: "Queued" },
  { status: "running", label: "Running" },
  { status: "verifying", label: "Verifying" },
  { status: "awaiting_validation", label: "Awaiting validation" },
  { status: "approved", label: "Approved" },
];

export const METHOD_LABELS: Record<string, string> = {
  nvme_sanitize_crypto: "NVMe Sanitize — crypto erase",
  nvme_sanitize_block: "NVMe Sanitize — block erase",
  nvme_format_crypto: "NVMe Format — crypto erase",
  ata_sanitize_crypto: "ATA Sanitize — crypto scramble",
  ata_sanitize_block: "ATA Sanitize — block erase",
  ata_enhanced_secure_erase: "ATA Enhanced Secure Erase",
  ata_secure_erase: "ATA Secure Erase",
  overwrite_single_pass: "Single-pass overwrite (HDD only)",
};

export const METHODS_BY_INTERFACE: Record<string, string[]> = {
  nvme_ssd: ["nvme_sanitize_crypto", "nvme_sanitize_block", "nvme_format_crypto"],
  sata_ssd: ["ata_sanitize_crypto", "ata_sanitize_block", "ata_enhanced_secure_erase", "ata_secure_erase"],
  sata_hdd: ["ata_sanitize_block", "ata_enhanced_secure_erase", "ata_secure_erase", "overwrite_single_pass"],
};

export const INTERFACE_LABELS: Record<string, string> = {
  nvme_ssd: "NVMe SSD",
  sata_ssd: "SATA SSD",
  sata_hdd: "SATA HDD",
  unsupported_other: "Other / unsupported",
};

export function methodFitsInterface(method: string, iface: string): boolean {
  return (METHODS_BY_INTERFACE[iface] ?? []).includes(method);
}

export function jobLabel(n: number | string): string {
  return `JOB-${String(n).padStart(6, "0")}`;
}

export interface ClearanceDrive {
  associationId: string;
  serial: string;
}
export interface ClearanceJob {
  associationId: string;
  status: JobStatus;
  createdAt: string;
}

/**
 * A laptop is ready only when every attached drive's latest non-cancelled job is approved.
 * Mirrors public.device_all_drives_approved().
 */
export function deviceClearance(drives: ClearanceDrive[], jobs: ClearanceJob[]) {
  const perDrive = drives.map((d) => {
    const latest = jobs
      .filter((j) => j.associationId === d.associationId && j.status !== "cancelled")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return { serial: d.serial, status: latest?.status ?? null, approved: latest?.status === "approved" };
  });
  const blocking = perDrive.filter((d) => !d.approved);
  return { ready: drives.length > 0 && blocking.length === 0, perDrive, blocking };
}

export function heartbeatState(lastHeartbeat: string | null | undefined, now = Date.now()): "online" | "stale" | "offline" | "never" {
  if (!lastHeartbeat) return "never";
  const age = (now - new Date(lastHeartbeat).getTime()) / 1000;
  if (age <= 90) return "online";
  if (age <= 180) return "stale";
  return "offline";
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
