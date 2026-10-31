# NexWipe bootable agent — engineering handoff

This package is for the team building the **NexWipe Agent**: the bootable x86-64 Linux environment that runs on a laptop, identifies its drives, and — later, after qualification — performs sanitization and collects evidence. It is a **separate deliverable** from NexWipe Cloud (this web application). Nothing in the web application can erase a drive.

**Current state:** the erasure agent is not built. What exists is the **Milestone 1 read-only station**: a station program (`station/`) and a bootable USB build package (`usb-image/`). Both were built and booted in a virtual machine only; neither has been booted on a physical laptop. They contain no erasure commands and must not be extended with them inside this repository.

## Contents

| File | Covers |
|---|---|
| [BOOT_ENVIRONMENT.md](./BOOT_ENVIRONMENT.md) | Bootable x86-64 Linux image, USB boot first, network boot later, target laptops, boot-medium protection |
| [DISCOVERY_AND_CAPABILITIES.md](./DISCOVERY_AND_CAPABILITIES.md) | Hardware discovery, stable drive identification, capability detection, method selection |
| [SAFETY_EXECUTION_EVIDENCE.md](./SAFETY_EXECUTION_EVIDENCE.md) | Local technician confirmation, execution, verification, evidence |
| [CREDENTIALS_UPDATES_RECOVERY.md](./CREDENTIALS_UPDATES_RECOVERY.md) | Credential storage, revocation, signed updates, network interruption and restart recovery |
| [MILESTONES.md](./MILESTONES.md) | Milestone 1 (read-only), Stage 2 (controlled destructive testing on disposable drives), method-qualification evidence |
| [station/](./station/) | Read-only station program `nd_station` (discovery, enrollment, console, heartbeat, rotation) + tests |
| [usb-image/](./usb-image/) | Reproducible bootable USB build, pinned versions, checksums, USB creation instructions |
| [PHYSICAL_TEST_CHECKLIST.md](./PHYSICAL_TEST_CHECKLIST.md) | First physical read-only test: instructions (existing firmware settings first) and the record to fill in per laptop. VM results: `usb-image/vm-test-evidence/` |

API contract: `../docs/agent-api/CONTRACT.md` (+ `openapi.yaml`, `transcript.md`, `station-auth.md`).

## Architecture rule: keep the privileged engine separate

```text
+----------------------------- Laptop under test (booted from NexWipe USB) -----------------------------+
|                                                                                                       |
|  nd-console (UI, unprivileged)  <--local socket-->  nd-agent (network, state, unprivileged user)      |
|        shows target, operator confirms                    talks to NexWipe Cloud over HTTPS          |
|                                                                 |                                     |
|                                                     narrow IPC, signed job spec only                  |
|                                                                 v                                     |
|                                              nd-engine (root, no network, minimal code)               |
|                                              discovery ioctls, sanitize commands, read-back           |
+-------------------------------------------------------------------------------------------------------+
```

- **nd-engine** is the only component with raw device access. It has no network access (separate network namespace / seccomp), accepts a single job spec over a local socket, re-reads drive identity itself immediately before any command, and refuses anything not in the spec. Kept small enough to review line by line.
- **nd-agent** handles enrollment, heartbeat, inventory upload, job retrieval, event logging, retries and reconciliation. It never issues device commands.
- **nd-console** displays target and status on the laptop screen and collects the operator's confirmation.
- The web application never sends shell commands, scripts or device paths. It sends a job (target identity + permitted methods + policy version); the engine decides how to execute a permitted method on the drive it has itself identified.

## Scope (initial)

In scope: x86-64 Dell, HP, Lenovo business laptops (Latitude, EliteBook/ProBook, ThinkPad lines first) with **directly attached** SATA HDD, SATA SSD and NVMe SSD. Out of scope until separately qualified: Macs, Chromebooks, phones/tablets, RAID/HBA controllers, Intel RST/VMD in RAID mode, USB bridges/enclosures, eMMC/SD, Thunderbolt-attached storage, self-encrypting-drive key management beyond the policy's explicit methods.

## Non-negotiables

1. No destructive command without: a live authorization from the server, matching identity re-read by the engine, and local operator confirmation (last 4 serial characters typed).
2. The boot medium is never a target (see BOOT_ENVIRONMENT.md).
3. A command returning success is not verification. Verification is a separate step with its own evidence.
4. Unknown state is never reported as success. When in doubt: report `interrupted`/`unsupported` and stop.
5. No claim that a method is "supported" until it passes the qualification evidence in MILESTONES.md for that drive model + firmware + laptop model.
