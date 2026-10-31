# Hardware discovery, drive identity and capability detection

## Laptop identity (SMBIOS)

| Field | Source |
|---|---|
| `system.manufacturer` | `dmidecode -s system-manufacturer` (e.g. "Dell Inc.", "HP", "LENOVO") |
| `system.model` | `dmidecode -s system-product-name` (Lenovo: also `system-version`, which holds the marketing name) |
| `system.serial` | `dmidecode -s system-serial-number` (Dell service tag, HP serial, Lenovo serial). Reject placeholders: empty, "To Be Filled By O.E.M.", "Default string", all zeros → report as missing and stop. |
| `system.sku` | `dmidecode -s system-sku-number` |
| `system.bios_version` | `dmidecode -s bios-version` |
| `system.cpu`, `ram_bytes` | `/proc/cpuinfo` model name; `/proc/meminfo` MemTotal × 1024 |
| `boot_mode`, `secure_boot` | `/sys/firmware/efi` presence; `mokutil --sb-state` |

## Drive enumeration

Enumerate `/sys/block/*` excluding loop/ram/zram/dm/md. For each disk record `bus_path` from `/dev/disk/by-path` (stable across boots, e.g. `pci-0000:02:00.0-nvme-1`, `pci-0000:00:17.0-ata-1`) and `transport` (`lsblk -dno TRAN`).

- Only `nvme` and `sata` transports attached to the laptop's own controller are candidates. `usb`, `mmc`, `sas`, `iscsi`, RAID/HBA-backed devices → `interface: unsupported_other`.
- Intel VMD/RST: if the NVMe controller is behind VMD (`/sys/bus/pci/drivers/vmd`), report `unsupported_other` with `capabilities.reason: "vmd"`.

## Stable drive identity

Never identify a target by `/dev/sdX` or `/dev/nvmeXnY` alone. The identity tuple is:

| Interface | Serial | Model | Extra identifiers |
|---|---|---|---|
| NVMe | `nvme id-ctrl` → `sn` (trim spaces) | `mn` | firmware `fr`; namespace `eui64`, `nguid` from `nvme id-ns`; controller `subnqn` |
| SATA | `hdparm -I` / `smartctl -i` → Serial Number | Model Number | firmware revision; `wwn` (Logical Unit WWN) |

The engine must re-read this tuple directly from the device (not from the agent's cache) immediately before any destructive command and compare it with the job's `target.drive_serial` (+ model). Any difference → abort, report `drive_identity_mismatch`.

Multi-namespace NVMe: v1 supports single-namespace drives only; multiple namespaces → `unsupported_other`.

## Capability detection (report in `drives[].capabilities`)

NVMe (`nvme id-ctrl -H`):
- `sanicap`: crypto erase / block erase / overwrite support bits; `nodmmas`; `sanitize_in_progress` from `nvme sanitize-log`.
- `fna` (format attributes: crypto erase supported, applies to all namespaces).
- `oacs` bit for Format NVM and Sanitize.
- Namespace count, LBA format in use, `nvme_opal` (from `sedutil-cli --query` if present) for SED awareness.

SATA (`hdparm -I`):
- Security feature set: supported / enabled / locked / **frozen** / enhanced erase supported, estimated erase times.
- Sanitize feature set: crypto scramble / block erase / overwrite supported.
- Rotation rate (HDD vs SSD), TRIM support, SED/Opal presence.
- Frozen drives: suspend-to-RAM and resume (`rtcwake -m mem -s 5`) is the usual unfreeze; report `frozen_after_unfreeze: true` → `unsupported` if still frozen.

Also record SMART health (`smartctl -H -A`) — a failing drive is reported for manual assessment, not processed.

## Method selection

1. Server sends `policy.allowed_methods` already filtered to the drive's interface.
2. Engine intersects that list with detected capabilities, in the policy's order of preference.
3. Empty intersection → `events` type=`unsupported` with `capabilities` and `reason`.
4. Method names (fixed vocabulary, shared with the server):

| Method | Interface | Command family |
|---|---|---|
| `nvme_sanitize_crypto` | NVMe | Sanitize, Crypto Erase action |
| `nvme_sanitize_block` | NVMe | Sanitize, Block Erase action |
| `nvme_format_crypto` | NVMe | Format NVM, SES=2 |
| `ata_sanitize_crypto` | SATA SSD | SANITIZE CRYPTO SCRAMBLE EXT |
| `ata_sanitize_block` | SATA | SANITIZE BLOCK ERASE EXT |
| `ata_enhanced_secure_erase` | SATA | SECURITY ERASE UNIT (enhanced) |
| `ata_secure_erase` | SATA | SECURITY ERASE UNIT (normal) |
| `overwrite_single_pass` | SATA HDD only | full-LBA write of a pattern |

Single-pass overwrite on an SSD is never permitted (the server already rejects it).
