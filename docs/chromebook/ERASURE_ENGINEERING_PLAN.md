# Chromebook erasure — engineering plan (not started)

**Status: plan only.** NexWipe cannot erase a Chromebook today. The Chromebook processing tracker records
what technicians and administrators did; it is **not** an erasure engine, and a Powerwash or ChromeOS
recovery recorded there is not a verified sanitization. No successful erasure certificate is issued for
any Chromebook until every gate in section 6 is passed. Developer Mode and firmware changes are never
switched on automatically.

## 1. First target: one model, one board

| | |
|---|---|
| Model | **HP Chromebook 11 G5** (not the 11 G5 EE, which is board RELM) |
| Board | **SETZER** (third-party MrChromebox list, retrieved 2026-10-31 — confirm on each unit) |
| CPU architecture | x86-64 (Intel, per the same list — confirm on unit) |
| Storage | Expected soldered eMMC — **not confirmed**; confirm on the first unit |
| Why this one | x86-64 lets us reuse the existing station build tooling and Linux tooling; the board name is identified; the model is common in school refresh batches; it is end-of-life, so lab units are cheap and disposable |
| Fallback | HP Chromebook 14 G5 (SNAPPY), same approach |
| Later | Lenovo 300e Gen 2 Intel/AMD (PHASER360 / TREEYA360), then ARM models (Lenovo 300e 1st gen, ASUS C203XA — boards unconfirmed) with a separate ARM build |

Confirm on the unit before any work: board name on the recovery screen or `chrome://version`, the
storage device model and type (eMMC/SATA/NVMe), and capacity. If the storage is not eMMC, stop and re-plan.

## 2. Chosen boot path: Developer Mode + developer-signed USB, no firmware writes

| Path | Firmware written? | Decision |
|---|---|---|
| A. Developer Mode, USB boot of a NexWipe kernel signed with the ChromeOS **developer keys** | No | **Chosen.** The stock firmware can boot developer-signed media once USB boot is allowed in Developer Mode |
| B. RW_LEGACY payload (SeaBIOS/UEFI) installed into the firmware's legacy slot | Yes (RW region) | Not used — counts as firmware modification |
| C. Full replacement UEFI firmware (needs write-protect removed) | Yes | Not used — bricking risk, changes the security model |
| D. Network boot (PXE) | — | Not available on stock Chromebook firmware |

What path A requires, all **manual, physical and per device** (cannot be automated from the app):

1. Device already deprovisioned by its owner and processing authorized in the tracker. Enrolled devices
   normally block Developer Mode by policy; never try to get around that.
2. Technician enters Recovery (Esc + Refresh + Power), then Developer Mode (Ctrl + D). **Entering
   Developer Mode wipes the user data area** — record it as an event, not as sanitization.
3. From the developer shell, allow USB boot (`crossystem dev_boot_usb=1`; the exact flag name differs
   between firmware versions — confirm on the unit).
4. Boot the NexWipe USB from the developer screen (Ctrl + U).

## 3. Candidate sanitization method (to be validated, not claimed)

- Read the eMMC's extended registers (EXT_CSD) first: eMMC version, whether **Sanitize** is supported,
  erased-memory value, capacity. If Sanitize is not supported, refuse and report — no fallback is assumed.
- Candidate: erase/discard the whole user data area, then issue the eMMC **Sanitize** command, then
  verify by reading back the full user area and comparing against the device's reported erased value.
- Record what is **out of scope** on eMMC: boot partitions, RPMB and vendor-reserved areas. Chromebook
  firmware lives on separate SPI flash and is never touched.
- Which NIST SP 800-88 category (Clear or Purge) this method meets must be decided by an independent
  reviewer from test evidence. Until then the result may only be called "sanitize command completed and
  read-back checked", never "NIST Purge".

## 4. Restoring the device

1. ChromeOS recovery from official recovery media (Chromebook Recovery Utility image for this board).
2. Leave Developer Mode (Space at the warning screen, or recovery), confirm verified boot is back.
3. Online setup check in the tracker (no enrollment prompt), then diagnostics and review as today.

A unit that cannot be restored is quarantined.

## 5. Work split

**Can be built in this web project (no hardware needed):**

- A separate `chromebook` job type and Agent API extension (read-only discovery first), with
  `device_class = 'chromebook'` checks so laptop drive-erasure jobs stay blocked on Chromebooks.
- Evidence schema for the Chromebook agent: board, eMMC EXT_CSD values, method, start/end, read-back
  result, out-of-scope areas, restore result. Agent-reported only; browsers can never write it.
- A Chromebook processing-record section that shows agent evidence next to technician steps, with
  certificate eligibility hard-off until section 6 is complete.
- Database acceptance checks for the above, in the style of `tests/db/phase2e_chromebook.sql`.
- Simulator scenarios clearly labelled as simulated, using the same API handler as real agents.

**Needs an external build environment:**

- Building a developer-key-signed kernel and image in ChromeOS USB layout (vboot tools from the
  ChromiumOS project), with only the tools needed for discovery (and, from M2, sanitize/read-back).
- A read-only build and a separate destructive build, each with its own version and checksum; the same
  safety scanner idea as `agent-handoff/usb-image/verify-image.sh`.
- A separate ARM build later.

**Needs physical hardware and people:**

- Disposable, owned, deprovisioned HP Chromebook 11 G5 lab units (at least 3).
- Recovery media, a USB stick per build, photos of every screen.
- An independent reviewer for the method decision.

## 6. Milestones and gates

| # | Milestone | Where | Exit gate |
|---|---|---|---|
| C0 | Identify 3 units: board, storage type and model, capacity, firmware version | Hardware | All three SETZER with eMMC, recorded in the tracker as "physically observed" |
| C1 | Read-only Chromebook agent boots through path A, reports identity and EXT_CSD to the read-only API; no writes | Build env + hardware + this project | Reported identifiers match the unit; restore to stock ChromeOS succeeds on all 3 |
| C2 | Destructive build on one disposable unit: known test data written, sanitize, full read-back | Build env + hardware | Test data not recoverable by read-back; timing and EXT_CSD recorded; restore works |
| C3 | Repeat on all 3 units plus one interrupted run (power cut mid-sanitize) | Hardware | Interrupted run is reported failed, never as success; history kept |
| C4 | Independent method review | External | Written decision on what the method may be called |
| C5 | Enable for HP 11 G5 / SETZER only, behind an owner/admin switch, with certificates using the reviewed wording | This project | Database checks pass; still off for every other board |

Real erasure stays disabled in NexWipe until C5, and only for the board that passed.
