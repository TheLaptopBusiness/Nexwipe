// Display rules for where a laptop/drive record's identity came from.
// A station's sign-in proves WHICH station sent a report; it never proves the hardware physically exists.
// Synthetic (test-tree, VM, sandbox) hardware stays synthetic permanently — enforced by database triggers.
export type HardwareOrigin = "not_station_reported" | "station_reported" | "synthetic";

export interface HardwareOriginInput {
  hardware_origin: string;
  hardware_verified: boolean;
  source: string;
  is_simulated?: boolean;
  /** True when the record was added from a station report (a linked discovery exists). */
  from_station?: boolean;
}

export interface HardwareOriginLabel {
  label: string;
  tone: "warning" | "info" | "neutral";
  explanation: string;
}

export const STATION_REPORT_CAVEAT =
  "An authenticated station reported this identity. Station sign-in proves which station sent it, not that the hardware physically exists.";

export function hardwareOriginLabel(r: HardwareOriginInput): HardwareOriginLabel {
  if (r.is_simulated) {
    return { label: "Simulated", tone: "warning", explanation: "Created by the simulator. No hardware was involved." };
  }
  if (r.hardware_origin === "synthetic") {
    return {
      label: "Synthetic test hardware",
      tone: "warning",
      explanation: "Reported from test data or a virtual machine by a real station program. Not a real laptop; it can never get an erasure job.",
    };
  }
  if (r.hardware_origin === "station_reported" && r.hardware_verified) {
    return { label: "Station-reported identity", tone: "info", explanation: STATION_REPORT_CAVEAT };
  }
  if (r.source === "agent_reported" || r.from_station) {
    return { label: "Needs re-scan", tone: "warning", explanation: "Added from a station report. The station must scan this laptop once more to confirm it: start NexWipe on the laptop (it re-scans automatically) or press Rescan." };
  }
  return {
    label: r.source === "csv_import" ? "CSV · not station-reported" : "Manual · not station-reported",
    tone: "neutral",
    explanation: "Entered by a person. No station has reported this identity.",
  };
}
