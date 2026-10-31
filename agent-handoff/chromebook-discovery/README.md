# NexWipe Chromebook discovery build (read-only) — 0.1.0-cb-discovery

**Status: source and build scripts ready. Final image NOT built. NOT booted on any Chromebook.
Hardware compatibility unverified.** Contains no erasure commands and no firmware or flag tools.

Plan and gates: `docs/chromebook/ERASURE_ENGINEERING_PLAN.md`. Lab checklist: `LAB_UNIT_CHECKLIST.md`.

## Two different things — do not confuse them

| | What it does |
|---|---|
| **Writing this image to a USB stick** | **Erases the USB stick.** Pick the right device. |
| **Putting the Chromebook into Developer Mode** | **ChromeOS wipes the Chromebook's local data.** A destructive step done by the technician, only on an authorized lab unit, after identity/authorization/baseline are recorded. NexWipe does not do it. |
| **Booting this image on the Chromebook** | Read-only toward internal storage: reads identity and registers the kernel exposes; sends nothing to the storage device. |
| **Leaving Developer Mode / recovery** | ChromeOS wipes and restores. Recorded as a ChromeOS operation, not a NexWipe one. |

## Contents

| Path | Purpose |
|---|---|
| `nd_chromebook/` | Wrapper around the unchanged laptop station program (`../station`); adds the `chromebook` report block; adds firmware/flag tools to the deny-list |
| `tests/test_chromeos.py` | Tests on a **synthetic** sysfs tree |
| `kernel/nexwipe-cb.config` | Kernel config fragment (built-in initramfs, chromeos_acpi, VPD, eMMC, USB) |
| `rootfs/` | Overlay: console service starts `nd_chromebook` |
| `build.sh` | Full build on an external Debian 13 host (stages A rootfs, B kernel ×2, C image) |
| `assemble.sh` | Stage C: ChromeOS USB layout, signed with the public developer keys |
| `verify-cb-image.sh` | Image and rootfs checker |

## What the report contains

Firmware ids (FWID, FRID, HWID) and reported switch bits; reported board with each source (HWID,
FWID, SMBIOS) and a flag if they disagree; VPD serial when exposed; internal storage kind and
identity; for eMMC, device-reported EXT_CSD values (revision, SEC_FEATURE_SUPPORT bits,
ERASED_MEM_CONT, boot/RPMB/GP sizes, life time); storage regions, each marked
`scope_decision: pending_engineering_review`; partition labels and whether a ChromeOS layout is
present; boot-USB exclusion; `nexwipe_operations: []`; `compatibility: unverified`.
"Reported" means the firmware or device said so — it is not confirmation.

## What was actually tested (2026-10-31, in the project sandbox)

- 9 Chromebook discovery tests on a synthetic tree: board from three sources; disagreeing sources
  flagged, not resolved; eMMC regions incl. boot0/boot1/RPMB/internal spare; boot USB, eMMC hardware
  partitions and SD card excluded from internal storage; unreadable EXT_CSD stays unknown; non-Chromebook
  flagged; firmware tools refused; synthetic tree reported as synthetic. 17 existing station tests pass.
- `assemble.sh` run with a **stock Debian 6.12 cloud kernel and a dummy root filesystem** —
  a packaging test only: layout (NEXTDRIVE / KERN-A / ND-STATE), KERN-A attributes, kernel signature
  against the public developer subkey, command line. A tampered kernel partition is rejected.
  That test image cannot boot a Chromebook and was not kept.

## Not tested

- `build.sh` stages A–B (kernel build with built-in initramfs) — needs an external build host.
- Boot on any Chromebook; whether SETZER's stock firmware accepts this media; chromeos_acpi/VPD paths
  and CHSW decoding on a real unit; EXT_CSD readability under the service sandbox; Wi-Fi on the unit.

## Build (external host)

```
sudo ./build.sh                       # produces build/nexwipe-chromebook-discovery-0.1.0-cb-discovery.img
./verify-cb-image.sh build/*.img /usr/share/vboot/devkeys
```

Record the build log, `*.sha256` and `components.sha256` with the image.
