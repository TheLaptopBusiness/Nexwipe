// Chromebook processing: labels, UI mirrors of the SQL rules, and research data.
// The database (chromebook_* RPCs) is the security boundary; these helpers only explain
// to the technician what is still missing. Nothing here performs a reset or deprovisioning.

import type { Tone } from "@/components/nd/status-badge";

export type ManagementStatus =
  | "unknown"
  | "management_observed"
  | "deprovision_requested"
  | "admin_reported_deprovisioned"
  | "deprovision_confirmed_integration"
  | "owner_reported_never_managed"
  | "online_setup_checked"
  | "blocked";

export type ResetStatus =
  | "not_started"
  | "authorized"
  | "in_progress"
  | "technician_completed"
  | "evidence_collected"
  | "reviewed"
  | "failed_interrupted";

export type ValueSource = "manual" | "csv_import" | "api_reported" | "physically_observed";

export const MANAGEMENT_LABEL: Record<ManagementStatus, { label: string; tone: Tone }> = {
  unknown: { label: "Unknown", tone: "neutral" },
  management_observed: { label: "Management observed", tone: "warning" },
  deprovision_requested: { label: "Deprovisioning requested", tone: "warning" },
  admin_reported_deprovisioned: { label: "Administrator-reported deprovisioned", tone: "info" },
  deprovision_confirmed_integration: { label: "Deprovisioning confirmed (authorized integration)", tone: "info" },
  owner_reported_never_managed: { label: "Owner-reported never managed", tone: "info" },
  online_setup_checked: { label: "Post-reset online setup checked", tone: "success" },
  blocked: { label: "Blocked by enrollment or management", tone: "danger" },
};

export const RESET_LABEL: Record<ResetStatus, { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  authorized: { label: "Authorized", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  technician_completed: { label: "Technician-reported completed", tone: "info" },
  evidence_collected: { label: "Completion evidence collected", tone: "info" },
  reviewed: { label: "Reviewed", tone: "success" },
  failed_interrupted: { label: "Failed or interrupted", tone: "danger" },
};

export const SOURCE_LABEL: Record<ValueSource, string> = {
  manual: "Manually entered",
  csv_import: "Imported",
  api_reported: "API-reported",
  physically_observed: "Physically observed",
};

export const RESET_METHOD_LABEL: Record<string, string> = {
  powerwash: "Powerwash (factory reset from ChromeOS)",
  recovery_media: "ChromeOS recovery from USB recovery media",
  admin_remote_powerwash: "Remote powerwash by the owning administrator",
  other: "Other (described in notes)",
};

export const EVIDENCE_KIND_LABEL: Record<string, string> = {
  technician_observation: "Technician observation",
  administrator_report: "Administrator report",
  integration_result: "Integration result",
  machine_generated: "Machine-generated",
  system: "System",
};

/** required = must be "pass" for resale; "when_fitted" = pass or not fitted; optional = a failure needs a review note. */
export const DIAGNOSTIC_CHECKS = [
  { key: "display", label: "Display", need: "required" },
  { key: "touchscreen", label: "Touchscreen (where fitted)", need: "when_fitted" },
  { key: "keyboard", label: "Keyboard", need: "required" },
  { key: "touchpad", label: "Touchpad", need: "required" },
  { key: "battery", label: "Battery", need: "required" },
  { key: "charging", label: "Charging", need: "required" },
  { key: "wifi", label: "Wi-Fi", need: "required" },
  { key: "camera", label: "Camera", need: "optional" },
  { key: "microphone", label: "Microphone", need: "optional" },
  { key: "speakers", label: "Speakers", need: "optional" },
  { key: "ports", label: "Ports", need: "required" },
  { key: "hinges", label: "Hinges", need: "required" },
] as const;

export type DiagnosticResult = "pass" | "fail" | "not_fitted" | "not_tested";

export interface ChromebookState {
  ownership_status: string;
  management_status: ManagementStatus | string;
  reset_status: ResetStatus | string;
  online_setup_result: string;
  diagnostics_status: string;
  release_decision: string;
  is_synthetic: boolean;
  management_basis?: string | null;
  reset_authorized_by?: string | null;
  reset_authorized_at?: string | null;
  reset_started_at?: string | null;
  reset_completed_at?: string | null;
  online_setup_checked_at?: string | null;
  diagnostics?: unknown;
}

const MANAGED_OR_UNRESOLVED = ["management_observed", "deprovision_requested", "blocked"];

/** Why a reset cannot be authorized yet (mirrors chromebook_reset_step 'authorize'). */
export function resetAuthorizationBlockers(r: ChromebookState): string[] {
  const out: string[] = [];
  if (!["not_started", "failed_interrupted"].includes(r.reset_status)) out.push("A reset is already authorized or done.");
  if (r.ownership_status !== "recorded") out.push("Record ownership / processing authorization first.");
  if (MANAGED_OR_UNRESOLVED.includes(r.management_status))
    out.push("The device is managed or unresolved: the owning organization must deprovision it before a reset.");
  return out;
}

/**
 * Why the device cannot be released as resale-ready. Mirrors public._cb_resale_blockers, which
 * chromebook_review and a database trigger enforce for every caller; the screen asks the server
 * (chromebook_resale_check) and uses this only as an offline explanation and for tests.
 */
export function resaleBlockers(r: ChromebookState, reviewNotes = ""): string[] {
  const out: string[] = [];
  const t = (v?: string | null) => (v ? new Date(v).getTime() : null);
  if (r.is_synthetic) out.push("Synthetic test records can never be released for resale");
  if (r.ownership_status !== "recorded") out.push("Ownership authorization is missing");
  if (!r.management_basis)
    out.push("Management is unknown or unresolved: record an administrator deprovisioning report or the owner's never-managed report");
  if (!r.reset_authorized_by || !r.reset_authorized_at) out.push("Reset authorization by an owner or administrator is missing");
  if (!["evidence_collected", "reviewed"].includes(r.reset_status)) out.push("Reset completion evidence is missing");
  const a = t(r.reset_authorized_at), st = t(r.reset_started_at), c = t(r.reset_completed_at), o = t(r.online_setup_checked_at);
  if (st === null || c === null || (a !== null && a > st) || st > c) out.push("Reset timeline is incomplete or out of order");
  if (r.management_status !== "online_setup_checked" || r.online_setup_result !== "no_enrollment_prompt" || o === null)
    out.push("An online setup check after the reset, with no enrollment prompt, is required");
  else if (c !== null && o < c) out.push("The online setup check must happen after the reset was completed");
  const d = (r.diagnostics ?? {}) as Record<string, string>;
  let optionalFail = false;
  for (const chk of DIAGNOSTIC_CHECKS) {
    const v = d[chk.key] ?? "not_tested";
    if (v === "not_tested") out.push(`Diagnostics incomplete: ${chk.key} not tested`);
    else if (chk.need === "required" && v !== "pass") out.push(`Required check not passed: ${chk.key} (${v})`);
    else if (chk.need === "when_fitted" && v === "fail") out.push(`Required check not passed: ${chk.key} (fail)`);
    else if (v === "fail") optionalFail = true;
  }
  if (optionalFail && !reviewNotes.trim()) out.push("Explain the optional diagnostic exceptions in the review notes");
  return out;
}

export function nextStep(r: ChromebookState): string {
  if (r.release_decision !== "pending") return "Processing decided. Review the record.";
  if (r.ownership_status !== "recorded") return "Record ownership / processing authorization.";
  if (r.management_status === "unknown" && r.reset_status === "not_started") return "Check management status on the device.";
  if (MANAGED_OR_UNRESOLVED.includes(r.management_status) && r.reset_status === "not_started")
    return "Ask the supplying organization to deprovision, then record their report.";
  if (["not_started", "failed_interrupted"].includes(r.reset_status)) return "Authorize the reset (owner or administrator).";
  if (r.reset_status === "authorized") return "Start the reset and record the method.";
  if (r.reset_status === "in_progress") return "Record the reset outcome.";
  if (r.online_setup_result === "not_checked" && r.management_status === "unknown")
    return "Record the owner's or administrator's management report, then do the online setup check.";
  if (r.online_setup_result === "not_checked") return "Reconnect to the internet and check the setup screens.";
  if (r.management_status === "blocked") return "Enrollment required: quarantine or return to the owner.";
  if (!["passed", "exceptions"].includes(r.diagnostics_status)) return "Complete the diagnostics checklist.";
  if (!["evidence_collected", "reviewed"].includes(r.reset_status)) return "Record the reset completion evidence.";
  return "Ready for review.";
}

// ---------- Official procedure references (Google). Re-check before each batch. ----------
export const OFFICIAL_REFERENCES = [
  { label: "Reset your Chromebook to factory settings (Powerwash)", url: "https://support.google.com/chromebook/answer/183084" },
  { label: "Recover your Chromebook (ChromeOS recovery)", url: "https://support.google.com/chromebook/answer/1080595" },
  { label: "Deprovision ChromeOS devices (for the owning administrator)", url: "https://support.google.com/chrome/a/answer/3523633" },
  { label: "Auto Update policy and AUE dates", url: "https://support.google.com/chrome/a/answer/6220366" },
];

// ---------- Compatibility research (not a qualification) ----------
export type ResearchStatus = "identified" | "unconfirmed" | "not_tested";

export interface ModelResearch {
  model: string;
  board: string;
  boardStatus: ResearchStatus;
  arch: "x86_64" | "arm" | "unknown";
  storage: string;
  note: string;
}

export const RESEARCH_RETRIEVED_ON = "2026-10-31";
export const RESEARCH_SOURCE =
  "MrChromebox.tech supported-devices list (community firmware project, third-party) — retrieved 2026-10-31. Not a Google source; confirm the board on each device (chrome://version or the recovery screen) before relying on it.";

export const MODEL_RESEARCH: ModelResearch[] = [
  { model: "HP Chromebook 11 G5", board: "SETZER", boardStatus: "identified", arch: "x86_64", storage: "Not identified — record per unit", note: "Listed as end-of-life on the source. Not tested by NexWipe." },
  { model: "HP Chromebook 11 G5 EE", board: "RELM", boardStatus: "identified", arch: "x86_64", storage: "Not identified — record per unit", note: "Different board from the 11 G5. Not tested by NexWipe." },
  { model: "HP Chromebook 14 G5", board: "SNAPPY", boardStatus: "identified", arch: "x86_64", storage: "Not identified — record per unit", note: "Shares the SNAPPY board with other models. Not tested by NexWipe." },
  { model: "Lenovo 300e Chromebook (1st gen)", board: "Unconfirmed", boardStatus: "unconfirmed", arch: "arm", storage: "Not identified — record per unit", note: "Believed to be an ARM (MediaTek) model; not on the x86 list. Board must be read from a unit." },
  { model: "Lenovo 300e Chromebook 2nd Gen (Intel)", board: "PHASER360", boardStatus: "identified", arch: "x86_64", storage: "Not identified — record per unit", note: "Not tested by NexWipe." },
  { model: "Lenovo 300e Chromebook Gen 2 AMD", board: "TREEYA360", boardStatus: "identified", arch: "x86_64", storage: "Not identified — record per unit", note: "Not tested by NexWipe." },
  { model: "Lenovo 300e Chromebook Gen 3", board: "VILBOZ360", boardStatus: "identified", arch: "x86_64", storage: "Not identified — record per unit", note: "Not tested by NexWipe." },
  { model: "ASUS Chromebook C203 (C203XA)", board: "Unconfirmed", boardStatus: "unconfirmed", arch: "arm", storage: "Not identified — record per unit", note: "Believed to be an ARM (MediaTek) model; not on the x86 list. Board must be read from a unit." },
];

export type Feasibility = "available_now" | "design_only" | "needs_agent_engineering" | "not_planned";

export const FEASIBILITY: { path: string; status: Feasibility; detail: string }[] = [
  { path: "Stock ChromeOS: Powerwash / recovery guided by technician", status: "available_now", detail: "Built here as a guided record. NexWipe does not perform or verify the reset; it records who did what and what they saw." },
  { path: "Post-reset online setup check", status: "available_now", detail: "Technician observation recorded. An offline setup screen is refused as evidence." },
  { path: "Authorized Google Admin integration (inventory/status read)", status: "design_only", detail: "Requires the owning organization's consent, OAuth, verified scopes and licensing. Not connected; no simulated results." },
  { path: "Google Admin deprovision / remote powerwash commands", status: "design_only", detail: "Only after read access works and API behaviour is validated. An accepted command is not proof of completion." },
  { path: "External USB/PXE boot of a NexWipe agent", status: "needs_agent_engineering", detail: "Stock firmware will not boot third-party media. Would need Developer Mode or firmware changes per board — not enabled, not promised." },
  { path: "x86-64 vs ARM agent builds", status: "needs_agent_engineering", detail: "The existing station image is x86-64 only and is not assumed to work on any Chromebook. ARM would need a separate build." },
  { path: "eMMC / SATA / NVMe sanitization on Chromebooks", status: "needs_agent_engineering", detail: "Requires on-device agent access to storage. Not possible from a web page; method validation per board needed." },
  { path: "Developer Mode workflows", status: "not_planned", detail: "Wipes the device, weakens verified boot and changes the security state. Not enabled automatically." },
  { path: "Firmware flashing", status: "not_planned", detail: "Not part of this product. Risk of bricking; changes the device's security model." },
  { path: "Restoring stock operation after any agent path", status: "needs_agent_engineering", detail: "Would require ChromeOS recovery afterwards and verification on physical hardware." },
];

export const FEASIBILITY_LABEL: Record<Feasibility, { label: string; tone: Tone }> = {
  available_now: { label: "Built (guided record)", tone: "success" },
  design_only: { label: "Design only", tone: "info" },
  needs_agent_engineering: { label: "Needs agent engineering + hardware", tone: "warning" },
  not_planned: { label: "Not enabled", tone: "neutral" },
};
