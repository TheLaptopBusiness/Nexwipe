# Local confirmation, execution, verification and evidence

> Not part of Milestone 1. Implement only in Stage 2 on designated disposable test drives.

## Local technician confirmation (before any destructive command)

1. `GET /jobs` returns a queued job with `authorization` and `target`.
2. Engine re-reads drive identity (DISCOVERY doc) and system serial.
3. Console shows, full screen, in large type:
   `ERASE drive <model> serial <FULL SERIAL> in laptop <asset_tag> (S/N <system serial)> using <method>. This cannot be undone.`
4. Operator types the **last 4 characters of the drive serial** and presses Enter. Wrong input 3 times → abort, `events` type=`log` + no ack.
5. Agent sends `POST /jobs/{id}/ack` with `observed` (what the engine read) and `local_confirmation` (`confirmed: true`, `typed_serial_suffix`, `operator`, `confirmed_at`). Only `proceed: true` permits execution.
6. Physical safeguards: the console shows a countdown (10 s) with a visible "Cancel" (Esc) after ack and before the command is issued.

## Execution (nd-engine)

- One drive at a time per engine. Before issuing: re-read identity a final time; confirm not boot medium/removable; check the drive is not frozen/locked.
- ATA Security Erase requires setting a temporary user password; the engine must generate a random one, log *that a password was set* (never the value), and attempt to clear it on failure so the drive is not left locked.
- Poll progress from the device (`nvme sanitize-log` SPROG, ATA sanitize status) — send `progress` with `measured: true` only for device-reported progress; otherwise phase only.
- Timeouts per method from the drive's own estimate × 2 (+ floor). On timeout: `interrupted`, never success.
- Power loss during sanitize: NVMe/ATA sanitize resumes on next power-on; on reboot the agent must reconcile and report the device-reported sanitize status.
- `result` stage=execution with `method` and `detail` (command, device status codes, timings, tool versions).

## Verification (separate step)

- `full_read`: read every LBA and confirm the expected post-sanitize pattern (zeros, ones, or "not equal to pre-sample" for crypto erase where vendor-defined). Report bytes read, mismatches, duration.
- `sample_read`: at least the policy's `verification_sample_pct`, using a seeded random sample of LBA ranges plus first/last 1 MiB and partition-table areas. Seed and ranges go in evidence.
- Pre-execution sample: before executing, the engine records hashes of N random sectors (not contents) to prove change after crypto erase.
- Verification passed → `result` stage=verification outcome=passed, method `full_read`/`sample_read`, `sample_pct`.

## Evidence bundle (upload before the verification result)

Text files, each ≤ 256 KB, SHA-256 computed by the agent and recomputed by the server:

| `kind` | Content |
|---|---|
| `device_report` | identity tuple, capabilities, SMART before/after, laptop SMBIOS |
| `execution_log` | exact commands (argv), device status codes, timestamps, tool versions, image version + hash |
| `verification_log` | method, seed, ranges, bytes read, mismatch count, duration |
| `smart_data` | raw `smartctl -x` / `nvme smart-log` before and after |

Larger raw logs: split; binary evidence storage is planned server-side (not built).
