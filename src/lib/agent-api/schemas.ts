// NexWipe Agent API v1 — request schemas shared by the HTTP handler, the simulator and tests.
// The contract is documented in docs/agent-api/openapi.yaml. Keep both in sync.
import { z } from "zod";

export const AGENT_API_VERSION = "1";
export const AGENT_API_BASE = "/api/public/agent/v1";
export const MAX_BODY_BYTES = 400_000;
export const MAX_EVIDENCE_BYTES = 262_144;

const idem = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "idempotency_key may contain letters, digits, . _ : -");
const seq = z.number().int().min(1).max(1_000_000);
const occurredAt = z.string().datetime({ offset: true }).optional();
const shortText = (max: number) => z.string().trim().max(max);
const count = z.number().int().min(0).max(10_000_000);

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

// Erase-related features a drive ADVERTISES in its identify data (read-only discovery).
// Not evidence that an erase works; unknown values stay absent. Unknown keys are dropped.
const flagSet = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial();
const minutes = z.number().int().min(0).max(65_536).nullable();
export const DriveCapabilities = z.object({
  source: z.enum(["ata_identify_sysfs", "nvme_identify_controller", "unavailable"]),
  reason: shortText(160).optional(),
  ata_security: flagSet({
    supported: z.boolean().nullable(),
    enabled: z.boolean(),
    locked: z.boolean(),
    frozen: z.boolean(),
    enhanced_erase_supported: z.boolean(),
    normal_erase_minutes: minutes,
    enhanced_erase_minutes: minutes,
  }).optional(),
  ata_sanitize_feature: flagSet({
    supported: z.boolean(),
    crypto_scramble: z.boolean(),
    overwrite: z.boolean(),
    block_erase: z.boolean(),
  }).optional(),
  trim_supported: z.boolean().optional(),
  nvme_format_nvm: flagSet({
    supported: z.boolean(),
    crypto_erase: z.boolean(),
    applies_to_all_namespaces: z.boolean(),
    erase_applies_to_all_namespaces: z.boolean(),
  }).optional(),
  nvme_sanitize_feature: flagSet({
    supported: z.boolean(),
    crypto_erase: z.boolean(),
    block_erase: z.boolean(),
    overwrite: z.boolean(),
  }).optional(),
  nvme_namespace_count: z.number().int().min(0).max(1_000_000).optional(),
  nvme_namespace_management: z.boolean().optional(),
});

export const InventoryRequest = z.object({
  system: z.object({
    manufacturer: shortText(80).optional(),
    model: shortText(120).optional(),
    // Optional so a laptop with a missing/placeholder serial can still be reported and flagged for review.
    serial: shortText(120).optional(),
    sku: shortText(120).optional(),
    cpu: shortText(120).optional(),
    ram_bytes: z.number().int().nonnegative().optional(),
    bios_version: shortText(80).optional(),
    boot_mode: z.enum(["uefi", "legacy", "unknown"]).optional(),
    secure_boot: z.boolean().optional(),
    uuid: shortText(64).optional(),
    asset_tag: shortText(120).optional(),
    chassis: shortText(60).optional(),
    cpu_cores: count.optional(),
    cpu_threads: count.optional(),
    bios_vendor: shortText(80).optional(),
    bios_date: shortText(40).optional(),
    board: shortText(120).optional(),
  }),
  // Further detail shown on the Connected devices page. All optional, read-only identity data.
  os: z
    .object({
      name: shortText(120).optional(),
      version: shortText(60).optional(),
      build: shortText(60).optional(),
      architecture: shortText(40).optional(),
    })
    .optional(),
  memory_modules: z
    .array(
      z.object({
        slot: shortText(60).optional(),
        size_bytes: z.number().int().nonnegative().optional(),
        speed_mhz: count.optional(),
        type: shortText(40).optional(),
        manufacturer: shortText(80).optional(),
        part_number: shortText(80).optional(),
        serial: shortText(80).optional(),
      }),
    )
    .max(32)
    .optional(),
  batteries: z
    .array(
      z.object({
        name: shortText(80).optional(),
        manufacturer: shortText(80).optional(),
        serial: shortText(80).optional(),
        chemistry: shortText(40).optional(),
        design_capacity_mwh: count.optional(),
        full_charge_capacity_mwh: count.optional(),
        cycle_count: count.optional(),
        health_pct: z.number().min(0).max(200).optional(),
        status: shortText(40).optional(),
      }),
    )
    .max(4)
    .optional(),
  gpus: z
    .array(
      z.object({
        name: shortText(120).optional(),
        driver_version: shortText(60).optional(),
        vram_bytes: z.number().int().nonnegative().optional(),
      }),
    )
    .max(8)
    .optional(),
  network_adapters: z
    .array(
      z.object({
        name: shortText(120).optional(),
        mac: shortText(40).optional(),
        kind: z.enum(["wifi", "ethernet", "bluetooth", "other"]).optional(),
      }),
    )
    .max(16)
    .optional(),
  security: z
    .object({
      tpm_present: z.boolean().optional(),
      tpm_version: shortText(40).optional(),
      bitlocker: z
        .array(
          z.object({
            volume: shortText(20).optional(),
            protection: z.enum(["on", "off", "unknown"]).optional(),
          }),
        )
        .max(16)
        .optional(),
    })
    .optional(),
  station: z
    .object({
      agent_version: shortText(40).optional(),
      boot_medium_serial: shortText(120).optional(),
      kernel: shortText(120).optional(),
      mode: z.enum(["read_only"]).optional(),
      image_version: shortText(60).optional(),
      // Station's own declaration; the server still classifies it (undeclared or virtual = synthetic).
      hardware_source: z.enum(["physical", "virtual", "synthetic"]).optional(),
      hardware_source_reason: shortText(200).optional(),
    })
    .optional(),
  review_flags: z
    .array(
      z.object({
        code: z.string().regex(/^[a-z0-9_]{3,60}$/),
        target: shortText(200).optional(),
        detail: shortText(300).optional(),
      }),
    )
    .max(50)
    .optional(),
  drives: z
    .array(
      z.object({
        serial: shortText(120).optional(),
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
        capabilities: DriveCapabilities.optional(),
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

// Result of a station action the heartbeat delivered (only Reboot into NexWipe reports one).
export const ActionResultRequest = z.object({
  action: z.enum(["reboot_to_usb"]),
  ok: z.boolean(),
  detail: shortText(300).optional(),
});

// Result of a diagnostic. Reads hardware only; never touches storage.
// keys_registered / keys_flagged are physical scancode names (e.g. "SC_1E", "E0_1D"), not characters.
// A keyboard cannot "pass" without this many keys actually registering — otherwise a test that
// captured nothing could be marked all-good. The station (hwtest.py) enforces the same floor.
export const KEYBOARD_PASS_MIN_KEYS = 20;
const keyIds = z.array(shortText(24)).max(200);

// "keyboard": the retired Windows-helper test (still accepted for requests delivered before 0025).
const KeyboardDiagnostic = z
  .object({
    test: z.literal("keyboard"),
    outcome: z.enum(["pass", "fail", "incomplete"]),
    result: z
      .object({
        layout: shortText(20).optional(),
        keys_registered: keyIds.default([]),
        keys_flagged: keyIds.optional(),
        note: shortText(500).optional(),
      })
      .default({ keys_registered: [] }),
    detail: shortText(300).optional(),
  })
  .refine(
    (v) => v.outcome !== "pass" || v.result.keys_registered.length >= KEYBOARD_PASS_MIN_KEYS,
    {
      message: `A keyboard test cannot pass with fewer than ${KEYBOARD_PASS_MIN_KEYS} keys registered`,
      path: ["outcome"],
    },
  );

// "full": the hardware test run on the NexWipe boot stick (agent-handoff/station/nd_station/hwtest.py).
export const FULL_TEST_PARTS = [
  "keyboard",
  "display",
  "webcam",
  "microphone",
  "speakers",
  "touchpad",
  "battery",
  "charging",
  "wifi",
  "ports",
  "hinges",
  "body",
] as const;
const partValues = z
  .record(z.string().max(40), z.union([shortText(200), z.number(), z.boolean(), z.null()]))
  .refine((v) => Object.keys(v).length <= 30, { message: "Too many values" });
const FullPart = z.object({
  outcome: z.enum(["pass", "fail", "skipped", "incomplete"]),
  note: shortText(500).optional(),
  values: partValues.optional(),
});
const FullKeyboardPart = FullPart.extend({
  keys_registered: keyIds.default([]),
  keys_flagged: keyIds.optional(),
  extra_keys: keyIds.optional(),
});
const FullDiagnostic = z
  .object({
    test: z.literal("full"),
    // handoff: the Windows helper restarted into the stick, which runs the suite and reports the result.
    outcome: z.enum(["pass", "fail", "incomplete", "handoff"]),
    result: z.object({
      layout: shortText(20).optional(),
      tests: z.object({
        keyboard: FullKeyboardPart,
        display: FullPart.optional(),
        webcam: FullPart.optional(),
        microphone: FullPart.optional(),
        speakers: FullPart.optional(),
        touchpad: FullPart.optional(),
        battery: FullPart.optional(),
        charging: FullPart.optional(),
        wifi: FullPart.optional(),
        ports: FullPart.optional(),
        hinges: FullPart.optional(),
        body: FullPart.optional(),
      }),
    }),
    detail: shortText(300).optional(),
  })
  .refine(
    (v) => {
      if (v.outcome !== "pass") return true;
      const t = v.result.tests;
      const parts = Object.values(t).filter(Boolean) as { outcome: string }[];
      return (
        t.keyboard.outcome === "pass" &&
        t.keyboard.keys_registered.length >= KEYBOARD_PASS_MIN_KEYS &&
        parts.every((p) => p.outcome === "pass" || p.outcome === "skipped")
      );
    },
    {
      message: `A full test passes only when the keyboard passes (${KEYBOARD_PASS_MIN_KEYS}+ keys) and no part failed or was incomplete`,
      path: ["outcome"],
    },
  );

export const DiagnosticResultRequest = z.union([KeyboardDiagnostic, FullDiagnostic]);

export const ReconcileRequest = z.object({
  jobs: z
    .array(z.object({ job_id: z.string().uuid(), agent_last_seq: z.number().int().min(0) }))
    .max(50),
});

/** Build the payload stored with a job event: everything except transport fields. */
export function eventPayload<T extends Record<string, unknown>>(body: T): Record<string, unknown> {
  const {
    seq: _s,
    idempotency_key: _i,
    type: _t,
    occurred_at: _o,
    stage: _st,
    ...rest
  } = body as Record<string, unknown>;
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
