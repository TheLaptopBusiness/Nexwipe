# Boot environment

## Image

- **Base:** minimal x86-64 Linux (e.g. Debian stable or Alpine with a current LTS kernel ≥ 6.6 for NVMe/ATA sanitize support and current laptop NVMe/SATA controllers). Read-only root (squashfs) + tmpfs overlay.
- **Packages needed by the engine:** `nvme-cli`, `hdparm`, `sg3_utils`, `smartmontools`, `dmidecode`, `util-linux` (`lsblk`, `blkid`), `pciutils`. Pin versions; record them in the image manifest and in every evidence bundle.
- **No** shell login on the console by default, no SSH, no package manager at runtime. Debug images are separately built, visibly marked "DEBUG – NOT FOR PRODUCTION" on screen and in every API request (`agent_version` suffix `-debug`), and must not be enrolled in production organizations.
- **Kernel cmdline:** disable auto-mounting; `nvme_core.default_ps_max_latency_us=0` for stable NVMe behaviour; no swap.
- **Reproducible build** (e.g. mkosi or debos) with an SBOM published per release.

## Boot path 1 — USB (first)

- UEFI only for the first release; Secure Boot **on**, using a shim signed chain (or documented instructions to enrol the NexWipe key) — record `boot_mode` and `secure_boot` in inventory.
- Legacy BIOS: out of scope for v1; report `boot_mode: legacy` and refuse destructive jobs.
- Target laptops: Dell Latitude (F12 boot menu), HP EliteBook/ProBook (F9), Lenovo ThinkPad (F12). Record each laptop's existing firmware settings first and boot with them unchanged; storage-controller mode is changed only when a recorded failure requires it, and the original value is restored afterwards (see PHYSICAL_TEST_CHECKLIST.md). For future erasure work: if RAID/VMD is detected, report drives as `unsupported_other` and do not proceed, BIOS supervisor password state, "frozen" state handling (see capabilities).

## Boot path 2 — network (later)

- UEFI HTTP Boot or PXE + iPXE serving the same signed image. Requires a per-site boot server; out of scope for Milestone 1. The same image identity checks apply (the station reports `kernel` and image version).

## Protection of the boot medium

The station must never select its own boot device as a target and must keep it unmodified.

1. At startup, resolve the boot device from the kernel (`/proc/cmdline` root=UUID/LABEL, `findmnt /run/live/medium` or equivalent) → its block device → serial (`udevadm info`). Record it as `station.boot_medium_serial` and flag that drive `is_boot_medium: true` in every inventory report.
2. The engine keeps a deny-list of: the boot device, any `removable=1` device, any USB-transport device, any device with a NexWipe image partition label. Jobs targeting these are refused locally even if the server sent them.
3. Mount the medium read-only; keep the writable state partition (credential, local event log) separate, small, and encrypted (see credentials doc).
4. Verify the image hash at boot (dm-verity on the squashfs) and refuse to run destructive jobs if verification fails; still allow read-only inventory and report `image_verified: false` in `capabilities` of the station (future field).
