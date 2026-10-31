# Chromebook erasure — engineering plan (revision 2, 2026-10-31)

**Status: plan only. No Chromebook erasure exists. Hardware support and sanitization claims are
unverified.** The processing tracker records what technicians and administrators did; it is not an
erasure engine. Real erasure stays disabled, no Chromebook erasure certificate is issued, and no
result is called NIST Purge until every gate in section 8 is passed.

Changes from revision 1: Developer Mode entry and exit are treated as destructive steps; identity,
authorization and baseline evidence are captured before either; ChromeOS-performed wipes are kept
separate from NexWipe operations; HP 11 G5 / SETZER is a candidate, not a target; "sanitize, then
read the whole drive" is replaced by a storage-specific procedure that needs engineering review; the
first build is a discovery-only image.

## 1. Candidate unit (not confirmed)

| | |
|---|---|
| Candidate | **HP Chromebook 11 G5** / board **SETZER** (third-party MrChromebox list, retrieved 2026-10-31) |
| Status | **Candidate.** Stays a candidate until the exact physical unit confirms board, storage and boot compatibility (gate G1) |
| Expected, unconfirmed | x86-64 (Intel); soldered eMMC |
| Not the same board | HP Chromebook 11 G5 **EE** = RELM |
| Fallback candidate | HP Chromebook 14 G5 / SNAPPY |
| If the unit differs | Board, CPU or storage kind not as expected → stop, record, re-plan. Do not adapt the procedure on the bench |

## 2. Event classes — who did what

Every action is recorded under exactly one class. They are never merged.

| Class | Examples | Recorded by | May count as NexWipe sanitization? |
|---|---|---|---|
| **ChromeOS/firmware-performed** | Developer Mode entry wipe, leaving Developer Mode, Powerwash, recovery reinstall | Technician, in the tracker (method, time, screen photos) | **No.** ChromeOS's own wipe is reported as what ChromeOS did, never as a NexWipe result |
| **NexWipe-performed** | Discovery (read-only); later, reviewed storage commands | The Chromebook agent, through the Agent API | Only after gates G1–G7 and the method review |
| **Owner/administrator-reported** | Deprovisioning, ownership | Tracker, existing rules | No |

The discovery build reports `nexwipe_operations: []` and states that ChromeOS operations are not
observable by it.

## 3. Destructive transitions and what must exist before them

Entering Developer Mode wipes the unit's local user data and changes its boot security state.
Leaving Developer Mode wipes it again. Both are **destructive steps**, done only by a technician,
manually, on an authorized lab unit. NexWipe never triggers them.

Before **entering** Developer Mode (all required; stop if any is missing):

1. **Identity**: model, label serial, asset tag, board name from the recovery screen, photos of
   label and screen. Recorded in the tracker as physically observed.
2. **Processing authorization**: ownership recorded; device deprovisioned by its owner (management
   policy normally blocks Developer Mode — never bypass it); written authorization that this unit may
   be put into Developer Mode and used for lab work, with name and time.
3. **Baseline evidence**: ChromeOS version, firmware version shown on the recovery/`chrome://system`
   pages, enrollment state as shown, write-protect state if displayed, photos. Stated as observed,
   not as verified.

Before **leaving** Developer Mode: the discovery report (or failure notes) is uploaded and the unit's
reported identifiers have been compared with the label and screens.

## 4. Boot path

Developer Mode + USB media signed with the **public ChromeOS developer keys**, booted from the
developer screen. No firmware writes (no RW_LEGACY payload, no replacement firmware, write-protect
untouched). The exact developer-boot flag name and keystroke differ between firmware versions and
are confirmed on the unit, not assumed. PXE is not available on stock firmware.

## 5. Discovery-only build (deliverable now)

`agent-handoff/chromebook-discovery/` — read-only, no erasure commands, no firmware/flag tools.

- Runs the unchanged laptop station program and adds a `chromebook` block: firmware ids
  (FWID/FRID/HWID), reported switch state, reported board with every source, internal storage
  identity, eMMC EXT_CSD values (device-reported), storage regions, partition labels, boot-USB exclusion.
- Unknown values stay unknown; disagreeing board sources are flagged, not resolved.
- Uses the existing read-only enrollment / heartbeat / revocation / inventory contract.
- Deny-list adds firmware and flag tools (`flashrom`, `futility`, `crossystem`, `gsctool`, `mmc`, …);
  image checker refuses them.
- What has been tested and what has not: see the kit README.

## 6. Storage-specific procedure (requires engineering review before any code)

Replaces "run sanitize, then read the whole drive". Produce one written procedure **per storage
device model** found in gate G1, reviewed before implementation:

1. **Identify the device**: exact storage model, kind (eMMC/SATA/NVMe/UFS), firmware, capacity,
   advertised capabilities (for eMMC: EXT_CSD revision, SEC_FEATURE_SUPPORT bits, ERASED_MEM_CONT,
   partition configuration). From discovery reports, never from the model name alone.
2. **Command sequence and prerequisites**: from the applicable specification (e.g. JEDEC eMMC
   JESD84-B51 for the reported EXT_CSD revision, or the relevant ATA/NVMe specification) **and** the
   storage manufacturer's documentation for that part. Include prerequisites (e.g. erase group
   definition, write protection, partition access) and what the device does when a prerequisite
   is not met. No vendor documentation → no procedure.
3. **Affected regions**: for each region — user data area, boot partitions, RPMB, general-purpose
   partitions, enhanced areas, internal spare/remapped blocks, cache — state whether the procedure
   affects it, how that is known, and whether it is in scope. Firmware SPI flash is out of scope and
   never touched.
4. **Completion status**: how completion is determined (device status, register values, timeouts),
   and which states mean "failed" or "unknown". Unknown is never reported as success.
5. **Failure handling**: every error path ends as failed or interrupted, with the evidence kept.
6. **Interruption recovery**: power loss, USB removal, lid close, crash — what state the device may be
   in, how the agent detects it on next boot, how the job resumes or is re-run, and that history is kept.
7. **Read-back**: what reading host-visible regions back verifies (e.g. host-addressable blocks return
   the expected pattern) and what it **cannot** establish (contents of spare/remapped blocks,
   internal caches, regions not addressable by the host, controller behaviour). Read-back is a check,
   not proof.
8. **Classification**: command success plus read-back is **never** enough to call a result Purge.
   The classification (if any) is decided in the method review (G7) from the reviewed procedure and
   test evidence. Until then the wording is "procedure completed; read-back checked (host-visible
   regions only)".

## 7. Restoration

Official ChromeOS recovery media for the board → leave Developer Mode → confirm verified boot is back
→ online setup check in the tracker → diagnostics → review as today. A unit that cannot be restored is
quarantined. Restoration must be demonstrated (G5) before any destructive test.

## 8. Gates

| # | Gate | Where | Exit evidence |
|---|---|---|---|
| G0 | Discovery image built from the kit with its final kernel; checker passes | External build host | Image file, checksums, build log — **done 2026-10-31 in the sandbox with deviations; VM-booted only** (`agent-handoff/chromebook-discovery/BUILD_RESULT_2026-10-31.md`); clean Debian 13 VM reproduction pending |
| G1 | One authorized lab unit identified **physically** (section 3) | Hardware + tracker | Board, CPU and storage kind confirmed; candidate stays candidate if any differ |
| G2 | Discovery image boots on that unit | Hardware | Photos of boot; agent version on screen |
| G3 | Internal storage identified; reported vs actual identifiers compared; boot USB excluded | Hardware + app | Filled checklist; report in the app |
| G4 | Evidence upload: enrollment, report, heartbeat, disconnect/reconnect, revocation | Hardware + app | Results recorded in the checklist |
| G5 | Restoration to stock ChromeOS demonstrated | Hardware | Recovery, Developer Mode off, online setup check recorded |
| G6 | Storage procedure (section 6) written for the confirmed storage part and reviewed | Engineering review | Signed-off procedure |
| G7 | Method review of destructive test evidence on disposable units, incl. interrupted runs | Independent reviewer | Written decision on wording/classification |
| G8 | Enable for that board and storage part only, behind owner/admin control, reviewed wording only | This project | Database checks; still off elsewhere |

No destructive testing before G1–G6. Real erasure stays disabled in NexWipe until G8.

## 9. Work split

| Here (web project) | External build host | Physical hardware / people |
|---|---|---|
| Discovery program, tests on synthetic sysfs trees, image packaging and checker (done) | Kernel build with built-in initramfs, full image (G0) | Authorized lab unit(s), recovery media, photos (G1–G5) |
| Later: Chromebook evidence display, agent evidence schema, DB checks | Separate destructive build, separate version/checksum (after G6) | Engineering and method reviewers (G6, G7) |

Windows-laptop work is unaffected.
