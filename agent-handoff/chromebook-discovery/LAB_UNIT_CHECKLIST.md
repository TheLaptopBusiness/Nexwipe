# Chromebook discovery — lab unit checklist (gates G1–G5)

Unit: authorized, owned lab unit only. Discovery build only — no erasure. Keep every photo.
Hardware compatibility stays **unverified** until this sheet is complete and reviewed.

## Before anything (G1 — before entering Developer Mode)

| Item | Recorded value |
|---|---|
| Model on label | |
| Label serial / asset tag | |
| Board on recovery screen | (candidate SETZER — record what is shown) |
| CPU type (if shown) | |
| ChromeOS version / firmware version (as shown) | |
| Enrollment / management state (as shown) | |
| Write-protect state (only if displayed) | |
| Ownership recorded in tracker (yes/no, by whom) | |
| Deprovisioned by owner (yes/no, evidence) | |
| Written authorization for Developer Mode + lab use (name, time) | |
| Photos: label, recovery screen, about page | |

Stop if any row is empty or the board is not SETZER (then the unit is not the candidate).

## Destructive step 1 — entering Developer Mode (ChromeOS performs a wipe)

| Item | Value |
|---|---|
| Technician, time | |
| Keystrokes / screens used (as on this unit) | |
| Wipe screen seen (photo) | |
| Recorded in tracker as a ChromeOS operation (not NexWipe) | |

## Boot (G2)

| Item | Value |
|---|---|
| Image filename and SHA-256 | |
| USB-boot setting used and how (exact flag/menu on this unit) | |
| Boots? Failure screen / message if not (photo) | |
| Agent version on screen (`0.1.0-cb-discovery`) | |

## Identification and exclusion (G3)

| Identifier | Actual (label/screen) | Reported by the build |
|---|---|---|
| System serial | | |
| Board | | |
| Firmware id | | |
| Storage kind (eMMC/SATA/NVMe) | | |
| Storage model / serial | | |
| Storage capacity | | |
| EXT_CSD readable? | — | |
| Boot USB shown as excluded? | — | |

## Evidence upload (G4)

| Check | Result |
|---|---|
| Enrollment with a one-time token | |
| Report appears in the app's Stations page | |
| Heartbeat continues | |
| Network unplugged / Wi-Fi off → reconnect | |
| Restart and re-report | |
| Credential revoked in the app → station shows revoked, stops reporting | |

## Restoration (G5) — destructive step 2 (ChromeOS performs a wipe)

| Item | Value |
|---|---|
| Recovery media (board, version) | |
| Recovery completed | |
| Left Developer Mode; verified boot screen gone (photo) | |
| Online setup check recorded in tracker (no enrollment prompt?) | |
| Recorded as ChromeOS operations, separate from NexWipe | |
| Unit restored to stock? If not → quarantine | |

Any boot or discovery failure: record the screen, the step and what was tried. Do not change firmware
settings beyond the Developer Mode USB-boot setting, and do not flash firmware.
