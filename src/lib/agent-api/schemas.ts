// NextDrive Agent API v1 — request schemas shared by the HTTP handler, the simulator and tests.
// The contract is documented in docs/agent-api/openapi.yaml. Keep both in sync.
import { z } from "zod";

export const AGENT_API_VERSION = "1";
export const AGENT_API_BASE = "/api/public/agent/v1";
export const MAX_BODY_BYTES = 400_000;
export const MAX_EVIDENCE_BYTES = 262_144;

const idem = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/, "idempotency_key may contain letters, digits, . _ : -");
const seq = z.number().int().min(1).max(1_000_000);
const occurredAt = z.string().datetime({ offset: true }).optional();
const shortText = (max: number) => z.string().trim().max(max);

export const EnrollRequest = z.object({
  enrollment_token: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(100),
  agent_version: shortText(40).optional(),
  platform: shortText(80).optional(),
  hostname: shortText(120).optional(),
});

export const HeartbeatRequest = z.object({
  state: z.enum(["idle", "busy", "reconciling"]).default("idle"),
  agent_version: shortText(40).optional(),
});

export const DriveInterface = z.enum(["sata_hdd", "sata_ssd", "nvme_ssd", "unsupported_other"]);

export const InventoryRequest = z.object({
  system: z.object({
    manufacturer: shortText(80).optional(),
    model: shortText(120).optional(),
    serial: shortText(120).min(1),
    sku: shortText(120).optional(),
    cpu: shortText(120).optional(),
    ram_bytes: z.number().int().nonnegative().optional(),
    bios_version: shortText(80).optional(),
    boot_mode: z.enum(["uefi", "legacy", "unknown"]).optional(),
    secure_boot: z.boolean().optional(),
  }),
  station: z
    .object({
      agent_version: shortText(40).optional(),
      boot_medium_serial: shortText(120).optional(),
      kernel: shortText(120).optional(),
    })
    .optional(),
  drives: z
    .array(
      z.object({
        serial: shortText(120).min(1),
        model: shortText(120).optional(),
        interface: DriveInterface.optional(),
        capacity_bytes: z.number().int().nonnegative().optional(),
        firmware: shortText(60).optional(),
        bus_path: shortText(200).optional(),
        transport: shortText(40).optional(),
        removable: z.boolean().optional(),
        is_boot_medium: z.boolean().optional(),
        wwn: shortText(64).optional(),
        nvme_eui64: shortText(64).optional(),
        nvme_nguid: shortText(64).optional(),
        capabilities: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(16),
});

export const AckRequest = z.object({
  seq,
  idempotency_key: idem,
  authorization_id: z.string().uuid(),
  observed: z.object({
    system_serial: shortText(120).optional(),
    drive_serial: shortText(120).min(1),
    drive_model: shortText(120).optional(),
    capacity_bytes: z.number().int().nonnegative().optional(),
  }),
  local_confirmation: z.object({
    confirmed: z.boolean(),
    typed_serial_suffix: shortText(16),
    operator: shortText(120).optional(),
    confirmed_at: z.string().datetime({ offset: true }).optional(),
  }),
  occurred_at: occurredAt,
});

export const EventRequest = z.object({
  seq,
  idempotency_key: idem,
  type: z.enum(["progress", "log", "unsupported", "interrupted", "resume"]),
  phase: shortText(120).optional(),
  progress_pct: z.number().min(0).max(100).optional(),
  measured: z.boolean().optional(),
  message: shortText(500).optional(),
  reason: shortText(1000).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  occurred_at: occurredAt,
});

export const EvidenceRequest = z.object({
  idempotency_key: idem,
  kind: z.enum(["execution_log", "verification_log", "device_report", "smart_data", "other"]),
  filename: shortText(200).min(1),
  content_type: shortText(100).optional(),
  content: z.string().max(MAX_EVIDENCE_BYTES),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export const ResultRequest = z.object({
  seq,
  idempotency_key: idem,
  stage: z.enum(["execution", "verification"]),
  outcome: z.enum(["succeeded", "failed", "passed"]),
  method: shortText(60).optional(),
  sample_pct: z.number().int().min(1).max(100).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
  occurred_at: occurredAt,
});

export const ReconcileRequest = z.object({
  jobs: z.array(z.object({ job_id: z.string().uuid(), agent_last_seq: z.number().int().min(0) })).max(50),
});

/** Build the payload stored with a job event: everything except transport fields. */
export function eventPayload<T extends Record<string, unknown>>(body: T): Record<string, unknown> {
  const { seq: _s, idempotency_key: _i, type: _t, occurred_at: _o, stage: _st, ...rest } = body as Record<string, unknown>;
  return rest;
}

/** Map a database error code raised by the agent RPCs to an HTTP status. */
export function statusForDbCode(code: string | undefined): number {
  switch (code) {
    case "ND401":
      return 401;
    case "ND403":
      return 403;
    case "ND404":
    case "P0002":
      return 404;
    case "ND409":
      return 409;
    case "ND410":
      return 410;
    case "ND422":
    case "22P02":
    case "22023":
    case "23514":
    case "23502":
      return 422;
    case "23505":
      return 409;
    default:
      return 500;
  }
}

/** Accept ISO-8601 or Unix seconds in X-ND-Timestamp. */
export function parseTimestampHeader(value: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{9,11}$/.test(trimmed)) return new Date(Number(trimmed) * 1000);
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}
