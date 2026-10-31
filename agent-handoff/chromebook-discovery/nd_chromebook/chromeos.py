"""
Chromebook discovery (read-only) for the NexWipe Chromebook discovery build.

Adds a `chromebook` block to the standard station report. Every value comes from files the
kernel already exposes (sysfs, the chromeos_acpi driver, the Google VPD driver, debugfs for the
eMMC EXT_CSD register). It never opens a block device, never sends a storage command, never
reads or writes firmware and never changes a firmware flag.

Every value is labelled with where it came from. "Reported" means the firmware or the storage
device said so; it does not mean NexWipe confirmed it. Board, storage and boot compatibility of
a unit are only confirmed when a technician compares these values with the unit itself.
"""
from __future__ import annotations

import os
import re
from typing import Optional

from nd_station.discovery import Sys, flag

from . import VERSION

# chromeos_acpi exposes firmware values as files under the ACPI device GGL0001.
ACPI_DIRS = (
    "/sys/bus/platform/devices/GGL0001:00",
    "/sys/devices/platform/GGL0001:00",
    "/sys/devices/platform/chromeos_acpi",
)
VPD_RO = "/sys/firmware/vpd/ro"

# CHSW bits as used by vboot's crossystem on x86 (CHSW_*). Decoding must be confirmed on a unit.
CHSW_RECOVERY_BOOT = 0x00000002
CHSW_DEV_BOOT = 0x00000020
CHSW_WP_BOOT = 0x00000200

CHROMEOS_PARTS = {"STATE", "KERN-A", "ROOT-A", "KERN-B", "ROOT-B", "EFI-SYSTEM"}

NOTE_NEXWIPE_OPS = ("Discovery-only build: no command that can modify storage or firmware is present "
                    "or callable. NexWipe performed no operation on this unit.")
NOTE_CHROMEOS_OPS = ("Not observable by this program. Developer Mode entry/exit, Powerwash and recovery are "
                     "performed by ChromeOS or the firmware; the technician records them in the tracker, "
                     "separately from NexWipe operations.")


def _clean(v: Optional[str], n: int = 120) -> Optional[str]:
    if v is None:
        return None
    v = re.sub(r"[\x00-\x1f\x7f]", "", v).strip()
    return v[:n] or None


def _acpi(s: Sys, name: str) -> Optional[str]:
    for d in ACPI_DIRS:
        v = s.read(d, name)
        if v is not None:
            return _clean(v)
    return None


def is_chromeos_firmware(s: Sys) -> bool:
    vendor = (s.read("/sys/class/dmi/id/bios_vendor") or "").lower()
    version = s.read("/sys/class/dmi/id/bios_version") or ""
    return "coreboot" in vendor or version.startswith("Google_") or _acpi(s, "FWID") is not None


# ------------------------------------------------------------------ firmware and identity
def firmware_info(s: Sys) -> dict:
    out = {
        "bios_vendor": _clean(s.read("/sys/class/dmi/id/bios_vendor")),
        "bios_version": _clean(s.read("/sys/class/dmi/id/bios_version")),
        "fwid": _acpi(s, "FWID"),       # active firmware id
        "frid": _acpi(s, "FRID"),       # read-only firmware id
        "hwid": _acpi(s, "HWID"),
        "source": "firmware_reported",
    }
    chsw = _acpi(s, "CHSW")
    if chsw is not None and re.fullmatch(r"(0x)?[0-9a-fA-F]+|\d+", chsw):
        val = int(chsw, 16) if chsw.lower().startswith("0x") else int(chsw)
        out["switches"] = {
            "chsw_raw": chsw,
            "developer_boot": bool(val & CHSW_DEV_BOOT),
            "recovery_boot": bool(val & CHSW_RECOVERY_BOOT),
            "write_protect_asserted": bool(val & CHSW_WP_BOOT),
            "decoding": "vboot crossystem CHSW bits; confirm against the unit's screens before relying on it",
        }
    return {k: v for k, v in out.items() if v is not None}


def _board_from_fwid(v: Optional[str]) -> Optional[str]:
    m = re.match(r"^Google_([A-Za-z0-9]+)\.", v or "")
    return m.group(1).upper() if m else None


def _board_from_hwid(v: Optional[str]) -> Optional[str]:
    m = re.match(r"^([A-Z0-9]+)[ -]", (v or "").upper())
    return m.group(1) if m else None


def identity(s: Sys, fw: dict) -> tuple[dict, list]:
    flags: list = []
    candidates = []
    for value, src in (
        (_board_from_hwid(fw.get("hwid")), "hwid"),
        (_board_from_fwid(fw.get("frid")), "frid"),
        (_board_from_fwid(fw.get("fwid")), "fwid"),
        (_board_from_fwid(fw.get("bios_version")), "smbios_bios_version"),
        ((_clean(s.read("/sys/class/dmi/id/product_name")) or "").upper() or None, "smbios_product_name"),
    ):
        if value:
            candidates.append({"value": value, "source": src})
    values = {c["value"] for c in candidates}
    board = None
    if len(values) == 1:
        board = next(iter(values))
    elif len(values) > 1:
        flags.append(flag("board_sources_disagree", detail=", ".join(f"{c['source']}={c['value']}" for c in candidates)))
    else:
        flags.append(flag("board_not_identified"))
    vpd = {k: _clean(s.read(VPD_RO, k)) for k in ("serial_number", "model_name", "sku_number", "region")}
    vpd = {k: v for k, v in vpd.items() if v}
    if not vpd.get("serial_number"):
        flags.append(flag("vpd_serial_not_readable", detail="Compare the serial on the label with the system serial in this report"))
    out = {
        "board_reported": board,
        "board_status": "reported_not_confirmed" if board else "unknown",
        "board_candidates": candidates,
        "smbios": {k: _clean(s.read("/sys/class/dmi/id", k)) for k in ("sys_vendor", "product_name", "product_serial", "board_name")},
        "vpd": vpd or None,
        "architecture": _clean(s.read("/proc/sys/kernel/arch")) or os.uname().machine if s.root == "/" else _clean(s.read("/proc/sys/kernel/arch")),
    }
    out["smbios"] = {k: v for k, v in out["smbios"].items() if v} or None
    return {k: v for k, v in out.items() if v is not None}, flags


# ------------------------------------------------------------------ storage
def parse_ext_csd(hexstr: str) -> Optional[dict]:
    """Decode selected EXT_CSD fields (JEDEC JESD84-B51 byte offsets). Values are device-reported."""
    h = re.sub(r"\s+", "", hexstr or "")
    if len(h) < 1024 or not re.fullmatch(r"[0-9a-fA-F]+", h):
        return None
    b = bytes.fromhex(h[:1024])
    sec = b[231]
    gp = []
    wp_grp, erase_grp = b[221], b[224]
    for i in range(4):
        mult = b[143 + 3 * i] | (b[144 + 3 * i] << 8) | (b[145 + 3 * i] << 16)
        gp.append(mult * wp_grp * erase_grp * 512 * 1024)
    return {
        "ext_csd_rev": b[192],
        "sec_count_sectors": int.from_bytes(b[212:216], "little"),
        "sec_feature_support": {
            "raw": sec,
            "secure_erase_trim_bit": bool(sec & 0x01),
            "secure_bad_block_bit": bool(sec & 0x04),
            "secure_gc_bit": bool(sec & 0x10),
            "sanitize_bit": bool(sec & 0x40),
        },
        "erased_mem_cont": b[181],
        "erase_group_def": b[175],
        "hc_erase_grp_size": erase_grp,
        "hc_wp_grp_size": wp_grp,
        "partition_support": b[160],
        "partition_setting_completed": b[155],
        "boot_partition_bytes_each": b[226] * 128 * 1024,
        "rpmb_bytes": b[168] * 128 * 1024,
        "gp_partition_bytes": gp,
        "cache_size_kib": int.from_bytes(b[249:253], "little"),
        "life_time_est_a": b[268],
        "life_time_est_b": b[269],
        "pre_eol_info": b[267],
        "meaning": "Register values reported by the device. They describe advertised features only and do not "
                   "show how the device behaves; any sanitization procedure needs engineering review.",
    }


def _mmc_host_card(devpath: str) -> tuple[Optional[str], Optional[str]]:
    m = re.search(r"/(mmc\d+)/(mmc\d+:[0-9a-fA-F]+)/block/", devpath)
    return (m.group(1), m.group(2)) if m else (None, None)


def _partitions(s: Sys, disk: str) -> list:
    out = []
    for p in s.listdir("/sys/block", disk):
        if not re.fullmatch(rf"{re.escape(disk)}p?\d+", p):
            continue
        uevent = s.read("/sys/block", disk, p, "uevent") or ""
        m = re.search(r"^PARTNAME=(.*)$", uevent, re.M)
        size = s.read("/sys/block", disk, p, "size")
        out.append({"name": p, "label": _clean(m.group(1), 40) if m else None,
                    "bytes": int(size) * 512 if size and size.isdigit() else None})
    return [{k: v for k, v in x.items() if v is not None} for x in out]


def _emmc(s: Sys, disk: str, devpath: str, drive: dict) -> tuple[dict, list]:
    flags: list = []
    dev = ("/sys/block", disk, "device")
    ident = {k: _clean(s.read(*dev, k), 64) for k in
             ("type", "name", "manfid", "oemid", "serial", "cid", "fwrev", "hwrev", "prv", "rev", "date", "life_time", "pre_eol_info")}
    ident = {k: v for k, v in ident.items() if v}
    host, card = _mmc_host_card(devpath)
    ext = None
    if host and card:
        raw = s.read("/sys/kernel/debug", host, card, "ext_csd")
        ext = parse_ext_csd(raw) if raw else None
    if ext is None:
        flags.append(flag("ext_csd_not_readable", target=disk,
                          detail="EXT_CSD could not be read from debugfs; storage capabilities stay unknown"))
    regions = [{"region": "user_data_area", "device": disk, "bytes": drive.get("capacity_bytes"), "host_visible": True}]
    for hw in ("boot0", "boot1"):
        name = f"{disk}{hw}"
        size = s.read("/sys/block", name, "size")
        regions.append({"region": f"boot_partition_{hw[-1]}", "device": name if size else None,
                        "bytes": int(size) * 512 if size and size.isdigit() else (ext or {}).get("boot_partition_bytes_each"),
                        "host_visible": bool(size)})
    rpmb_visible = s.exists("/sys/block", f"{disk}rpmb") or bool(s.listdir("/sys/bus/mmc_rpmb/devices"))
    regions.append({"region": "rpmb", "bytes": (ext or {}).get("rpmb_bytes"), "host_visible": rpmb_visible,
                    "note": "Authenticated area; not writable without its key"})
    for i, size in enumerate((ext or {}).get("gp_partition_bytes") or []):
        if size:
            regions.append({"region": f"general_purpose_{i + 1}", "bytes": size, "host_visible": None})
    regions.append({"region": "device_internal_spare_and_mapping", "bytes": None, "host_visible": False,
                    "note": "Not addressable by the host; read-back can never inspect it"})
    for r in regions:
        r["scope_decision"] = "pending_engineering_review"
    return {"kind": "emmc", "identity": ident or None, "ext_csd": ext, "regions": [{k: v for k, v in r.items() if v is not None} for r in regions]}, flags


def storage(s: Sys, drives: list) -> tuple[list, list]:
    flags: list = []
    out = []
    internal = [d for d in drives if not d.get("removable") and not d.get("is_boot_medium")]
    names = {d for d in s.listdir("/sys/block")}
    by_bus = {}
    for disk in names:
        if s.exists("/sys/block", disk, "device"):
            by_bus[disk] = s.realpath("/sys/block", disk)
    for disk, devpath in sorted(by_bus.items()):
        if re.fullmatch(r"mmcblk\d+(boot\d+|rpmb)", disk):
            continue  # hardware partitions of an eMMC; reported as regions of the parent
        d = next((x for x in internal if (x.get("bus_path") and x.get("bus_path") in devpath) or x.get("serial") and x.get("serial") == _clean(s.read("/sys/block", disk, "device", "serial"), 120)), None)
        removable = s.read("/sys/block", disk, "removable") == "1" or "/usb" in devpath
        if removable:
            continue
        size = s.read("/sys/block", disk, "size")
        base = {"disk": disk, "capacity_bytes": int(size) * 512 if size and size.isdigit() else None}
        if disk.startswith("mmcblk"):
            if (s.read("/sys/block", disk, "device", "type") or "").upper() == "SD":
                continue  # SD card slot, not internal storage
            info, f = _emmc(s, disk, devpath, base)
            flags += f
        elif disk.startswith("nvme"):
            info = {"kind": "nvme", "identity": {k: _clean(s.read("/sys/block", disk, "device", k), 64) for k in ("model", "serial", "firmware_rev")},
                    "capabilities": "not_read_in_discovery_build"}
        elif re.search(r"/ata\d+/", devpath):
            info = {"kind": "sata", "identity": {"model": (d or {}).get("model"), "serial": (d or {}).get("serial"), "firmware": (d or {}).get("firmware")},
                    "capabilities": "not_read_in_discovery_build"}
        else:
            info = {"kind": "other"}
        parts = _partitions(s, disk)
        labels = {p.get("label") for p in parts}
        out.append({**{k: v for k, v in base.items() if v is not None}, **info, "partitions": parts,
                    "chromeos_layout_present": bool(CHROMEOS_PARTS & labels) if parts else None})
    if not out:
        flags.append(flag("no_internal_storage_found"))
    elif len(out) > 1:
        flags.append(flag("multiple_internal_storage_devices", detail=", ".join(x["disk"] for x in out)))
    return out, flags


def discover_chromebook(s: Sys, report: dict) -> tuple[dict, list]:
    flags: list = []
    if not is_chromeos_firmware(s):
        flags.append(flag("chromeos_firmware_not_detected", detail="This build is only for Chromebooks"))
    fw = firmware_info(s)
    ident, f1 = identity(s, fw)
    stor, f2 = storage(s, report.get("drives", []))
    boot = report.get("_boot_detection") or {}
    block = {
        "profile": "chromebook-discovery",
        "build": VERSION,
        "firmware": fw,
        "identity": ident,
        "storage": stor,
        "boot_medium": {"disk": boot.get("disk"), "excluded": True, "identified": bool(boot.get("disk"))},
        "nexwipe_operations": [],
        "nexwipe_operations_note": NOTE_NEXWIPE_OPS,
        "chromeos_operations": NOTE_CHROMEOS_OPS,
        "compatibility": "unverified",
    }
    return block, flags + f1 + f2
