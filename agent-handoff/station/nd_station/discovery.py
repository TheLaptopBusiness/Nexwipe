"""
Read-only hardware discovery for the NexWipe station.

Sources: sysfs (/sys), the udev database (/run/udev/data), /proc and, optionally, two read-only
tools (dmidecode for installed memory, smartctl -i for full drive identity strings).

It never opens a block device for reading or writing data, never mounts anything and never reads
file contents. Every path is relative to a configurable root so tests can use a fake sysfs tree.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Callable, Optional

from .safety import run_read_only

PLACEHOLDERS = {
    "", "to be filled by o.e.m.", "to be filled by oem", "default string", "system serial number",
    "not specified", "not applicable", "none", "n/a", "na", "0", "00000000", "123456789", "chassis serial number",
    "system product name", "system manufacturer", "invalid",
}

Runner = Callable[[list], str]


def _is_placeholder(v: Optional[str]) -> bool:
    if v is None:
        return True
    s = v.strip().lower()
    return s in PLACEHOLDERS or set(s) <= {"0", " "} or set(s) <= {"f", " "} or set(s) <= {"x", " "}


@dataclass
class Sys:
    """Filesystem view; root='/' on a real station, a temp dir in tests."""

    root: str = "/"
    run: Runner = run_read_only

    def p(self, *parts: str) -> str:
        return os.path.join(self.root, *[x.lstrip("/") for x in parts])

    def read(self, *parts: str) -> Optional[str]:
        try:
            with open(self.p(*parts), "r", errors="replace") as f:
                return f.read().strip()
        except OSError:
            return None

    def read_bytes(self, *parts: str) -> Optional[bytes]:
        try:
            with open(self.p(*parts), "rb") as f:
                return f.read()
        except OSError:
            return None

    def realpath(self, *parts: str) -> str:
        """Resolve symlinks and return a path relative to root ('/sys/devices/...')."""
        real = os.path.realpath(self.p(*parts))
        root = os.path.realpath(self.root)
        return "/" + os.path.relpath(real, root) if root != "/" else real

    def listdir(self, *parts: str) -> list:
        try:
            return sorted(os.listdir(self.p(*parts)))
        except OSError:
            return []

    def exists(self, *parts: str) -> bool:
        return os.path.exists(self.p(*parts))


def flag(code: str, target: Optional[str] = None, detail: Optional[str] = None) -> dict:
    out = {"code": code}
    if target:
        out["target"] = target[:200]
    if detail:
        out["detail"] = detail[:300]
    return out


# ---------------------------------------------------------------- system identity
def discover_system(s: Sys) -> tuple[dict, list]:
    dmi = lambda k: s.read("/sys/class/dmi/id", k)  # noqa: E731
    vendor, name, version = dmi("sys_vendor"), dmi("product_name"), dmi("product_version")
    serial, sku = dmi("product_serial"), dmi("product_sku")
    flags: list = []
    model = name
    # Lenovo stores the machine-type in product_name and the marketing name in product_version.
    if vendor and vendor.strip().upper().startswith("LENOVO") and not _is_placeholder(version):
        model, sku = version, sku if not _is_placeholder(sku) else name
    system = {
        "manufacturer": None if _is_placeholder(vendor) else vendor.strip()[:80],
        "model": None if _is_placeholder(model) else model.strip()[:120],
        "serial": None,
        "sku": None if _is_placeholder(sku) else sku.strip()[:120],
        "bios_version": None if _is_placeholder(dmi("bios_version")) else dmi("bios_version")[:80],
        "cpu": _cpu(s),
        "ram_bytes": _ram_bytes(s),
        "boot_mode": "uefi" if s.exists("/sys/firmware/efi") else "legacy",
    }
    sb = _secure_boot(s)
    if sb is not None:
        system["secure_boot"] = sb
    if serial is None:
        flags.append(flag("system_serial_missing", detail="SMBIOS product_serial not readable (run as root?)"))
    elif _is_placeholder(serial):
        flags.append(flag("system_serial_placeholder", detail=f"SMBIOS reports {serial!r}"))
    else:
        system["serial"] = serial.strip()[:120]
    if system["manufacturer"] is None:
        flags.append(flag("manufacturer_missing"))
    if system["model"] is None:
        flags.append(flag("model_missing"))
    return {k: v for k, v in system.items() if v is not None}, flags


def _cpu(s: Sys) -> Optional[str]:
    info = s.read("/proc/cpuinfo") or ""
    m = re.search(r"^model name\s*:\s*(.+)$", info, re.M)
    return re.sub(r"\s+", " ", m.group(1)).strip()[:120] if m else None


def _ram_bytes(s: Sys) -> Optional[int]:
    # Installed DIMM sizes (needs root); fall back to kernel-visible memory.
    out = s.run(["dmidecode", "-t", "17"]) or ""
    total = 0
    for m in re.finditer(r"^\s*Size:\s*(\d+)\s*(MB|GB|TB)\s*$", out, re.M):
        total += int(m.group(1)) * {"MB": 2**20, "GB": 2**30, "TB": 2**40}[m.group(2)]
    if total:
        return total
    mem = s.read("/proc/meminfo") or ""
    m = re.search(r"^MemTotal:\s*(\d+)\s*kB", mem, re.M)
    return int(m.group(1)) * 1024 if m else None


def _secure_boot(s: Sys) -> Optional[bool]:
    d = "/sys/firmware/efi/efivars"
    for n in s.listdir(d):
        if n.startswith("SecureBoot-"):
            b = s.read_bytes(d, n)
            if b and len(b) >= 5:
                return b[4] == 1
    return None


# ---------------------------------------------------------------- boot medium (device ancestry)
def _mount_devnum(s: Sys, mountpoints: tuple) -> Optional[str]:
    """major:minor of the block device mounted at the live medium mount point (from mountinfo)."""
    info = s.read("/proc/self/mountinfo") or ""
    for line in info.splitlines():
        f = line.split()
        if len(f) > 4 and f[4] in mountpoints and re.match(r"^\d+:\d+$", f[2]):
            return f[2]
    return None


def _disk_of(s: Sys, devnum: str) -> Optional[str]:
    """Walk from /sys/dev/block/MAJ:MIN to the whole-disk node (partition -> parent)."""
    path = s.realpath(f"/sys/dev/block/{devnum}")
    if not s.exists(path):
        return None
    if s.exists(path, "partition"):
        path = os.path.dirname(path)
    # dm/loop devices: follow 'slaves' to the physical disk
    for _ in range(4):
        slaves = s.listdir(path, "slaves")
        if not slaves:
            break
        path = s.realpath(path, "slaves", slaves[0])
        if s.exists(path, "partition"):
            path = os.path.dirname(path)
    return os.path.basename(path)


USB_DEVICE_RE = re.compile(r"^\d+-[\d.]+$")  # e.g. 2-1, 3-1.4 (a USB device, not an interface)


def physical_ancestor(devpath: str) -> Optional[str]:
    """The physical device a disk hangs off: the USB device node if any, else None."""
    parts = devpath.split("/")
    idx = [i for i, p in enumerate(parts) if USB_DEVICE_RE.match(p)]
    return "/".join(parts[: idx[-1] + 1]) if idx else None


def find_boot_medium(s: Sys, mountpoints=("/run/live/medium", "/lib/live/mount/medium", "/run/initramfs/live")) -> dict:
    devnum = _mount_devnum(s, mountpoints)
    if not devnum:
        return {"disk": None, "ancestor": None, "method": "not_found"}
    disk = _disk_of(s, devnum)
    if not disk:
        return {"disk": None, "ancestor": None, "method": "not_found"}
    devpath = s.realpath("/sys/block", disk)
    return {"disk": disk, "ancestor": physical_ancestor(devpath) or devpath, "method": f"mountinfo {devnum} -> {devpath}"}


# ---------------------------------------------------------------- drives
SKIP_PREFIXES = ("loop", "ram", "zram", "dm-", "md", "sr", "fd", "nbd", "zd")


def _udev(s: Sys, disk: str) -> dict:
    dev = s.read("/sys/block", disk, "dev")
    if not dev:
        return {}
    data = s.read(f"/run/udev/data/b{dev}") or ""
    out = {}
    for line in data.splitlines():
        if line.startswith("E:") and "=" in line:
            k, v = line[2:].split("=", 1)
            out[k] = v
    return out


def _vpd80_serial(s: Sys, disk: str) -> Optional[str]:
    b = s.read_bytes("/sys/block", disk, "device", "vpd_pg80")
    if b and len(b) > 4:
        v = b[4:].decode("ascii", "replace").strip("\x00 ").strip()
        return v or None
    return None


def _clean(v: Optional[str], n: int = 120) -> Optional[str]:
    if v is None:
        return None
    v = re.sub(r"\s+", " ", v).strip()
    return None if _is_placeholder(v) else v[:n]


def _transport(devpath: str, disk: str) -> str:
    if "/usb" in devpath:
        return "usb"
    if disk.startswith("nvme"):
        return "thunderbolt" if "/thunderbolt" in devpath or "/domain" in devpath else "nvme"
    if re.search(r"/ata\d+/", devpath):
        return "sata"
    if disk.startswith("mmcblk"):
        return "mmc"
    if disk.startswith("vd") or "/virtio" in devpath:
        return "virtio"
    return "other"


def _smartctl(s: Sys, disk: str) -> dict:
    raw = s.run(["smartctl", "-i", "-j", f"/dev/{disk}"])
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {}


def discover_drives(s: Sys, boot: dict) -> tuple[list, list]:
    flags: list = []
    drives: list = []
    for disk in s.listdir("/sys/block"):
        if disk.startswith(SKIP_PREFIXES) or not s.exists("/sys/block", disk, "device"):
            continue
        devpath = s.realpath("/sys/block", disk)
        tran = _transport(devpath, disk)
        removable = s.read("/sys/block", disk, "removable") == "1"
        ancestor = physical_ancestor(devpath)
        is_boot = bool(boot.get("disk")) and (disk == boot["disk"] or (ancestor is not None and ancestor == boot.get("ancestor")))
        sectors = s.read("/sys/block", disk, "size")
        capacity = int(sectors) * 512 if sectors and sectors.isdigit() and int(sectors) > 0 else None
        udev = _udev(s, disk)
        model = serial = firmware = None
        extra: dict = {}
        if tran in ("nvme", "thunderbolt"):
            model = _clean(s.read("/sys/block", disk, "device", "model"))
            serial = _clean(s.read("/sys/block", disk, "device", "serial"))
            firmware = _clean(s.read("/sys/block", disk, "device", "firmware_rev"), 60)
            for k, name in (("eui", "nvme_eui64"), ("nguid", "nvme_nguid"), ("wwid", "wwn")):
                v = _clean(s.read("/sys/block", disk, k), 64)
                if v:
                    extra[name] = v
            ctrl = os.path.basename(os.path.dirname(devpath))  # nvme0
            namespaces = [d for d in s.listdir("/sys/block") if re.match(rf"^{re.escape(ctrl)}n\d+$", d)]
            if len(namespaces) > 1:
                flags.append(flag("multiple_nvme_namespaces", target=disk))
        else:
            enc = udev.get("ID_MODEL_ENC")
            decoded = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), enc) if enc else udev.get("ID_MODEL")
            model = _clean(decoded) or _clean(s.read("/sys/block", disk, "device", "model"))
            serial = _clean(udev.get("ID_SERIAL_SHORT")) or _vpd80_serial(s, disk)
            firmware = _clean(udev.get("ID_REVISION"), 60) or _clean(s.read("/sys/block", disk, "device", "rev"), 60)
            if udev.get("ID_WWN"):
                extra["wwn"] = udev["ID_WWN"][:64]
        smart = _smartctl(s, disk) if tran in ("nvme", "sata") else {}
        if smart:
            model = _clean(smart.get("model_name")) or model
            serial = _clean(smart.get("serial_number")) or serial
            firmware = _clean(smart.get("firmware_version"), 60) or firmware
        rotational = s.read("/sys/block", disk, "queue", "rotational") == "1"
        if smart.get("rotation_rate") == 0:
            rotational = False
        interface = {"nvme": "nvme_ssd", "sata": "sata_hdd" if rotational else "sata_ssd"}.get(tran, "unsupported_other")
        internal = tran in ("nvme", "sata", "mmc", "virtio", "other", "thunderbolt") and not removable and not is_boot and tran != "usb"
        bus_path = _clean(udev.get("ID_PATH"), 200)
        d = {
            "serial": serial,
            "model": model,
            "interface": interface,
            "capacity_bytes": capacity,
            "firmware": firmware,
            "transport": tran,
            "bus_path": bus_path,
            "removable": removable or tran == "usb",
            "is_boot_medium": is_boot,
            **extra,
        }
        drives.append({k: v for k, v in d.items() if v is not None and v != ""})
        label = bus_path or disk
        if internal:
            if not serial:
                flags.append(flag("drive_serial_missing", target=label))
            if not model:
                flags.append(flag("drive_model_missing", target=label))
            if tran in ("mmc", "virtio", "other", "thunderbolt"):
                flags.append(flag("unsupported_storage", target=label, detail=f"transport {tran}"))
    serials = [d["serial"].upper() for d in drives if d.get("serial") and not d.get("is_boot_medium")]
    for sn in sorted({x for x in serials if serials.count(x) > 1}):
        flags.append(flag("duplicate_drive_serial", target=sn))
    if not any(not d.get("removable") and not d.get("is_boot_medium") for d in drives):
        flags.append(flag("no_internal_drives"))
    if not boot.get("disk"):
        flags.append(flag("boot_medium_not_identified", detail="All USB/removable devices are treated as excluded"))
    # Boot medium always sorted last for display; internal drives first.
    drives.sort(key=lambda d: (d.get("is_boot_medium", False), d.get("removable", False)))
    return drives[:16], flags


def raid_or_vmd(s: Sys) -> list:
    out = []
    for dev in s.listdir("/sys/bus/pci/devices"):
        cls = (s.read("/sys/bus/pci/devices", dev, "class") or "").lower()
        driver = os.path.basename(s.realpath("/sys/bus/pci/devices", dev, "driver")) if s.exists("/sys/bus/pci/devices", dev, "driver") else ""
        if cls.startswith("0x0104") or driver == "vmd":
            out.append(flag("raid_or_vmd_controller", target=dev, detail=f"class {cls} driver {driver or 'none'}"))
    return out


# ---------------------------------------------------------------- hardware source
VIRTUAL_RE = re.compile(r"qemu|kvm|vmware|virtualbox|vbox|innotek|xen|bochs|parallels|hyper-v|virtual machine|seabios|cloud hypervisor|firecracker", re.I)


def hardware_source(s: Sys, fixture: bool) -> tuple:
    """What the station is reading: 'synthetic' (a test sysfs tree), 'virtual' (a VM/sandbox) or 'physical'.

    'physical' only means no virtualisation was detected. The server treats it as a claim: station
    sign-in proves which station sent the report, not that the hardware physically exists.
    """
    if fixture:
        return "synthetic", "discovery read a test sysfs tree, not a real machine"
    cpu = s.read("/proc/cpuinfo") or ""
    if re.search(r"^flags\s*:.*\bhypervisor\b", cpu, re.M):
        return "virtual", "CPU reports a hypervisor"
    if (s.read("/sys/hypervisor/type") or "").strip():
        return "virtual", "kernel reports a hypervisor"
    for k in ("sys_vendor", "product_name", "board_vendor", "bios_vendor", "chassis_vendor"):
        v = s.read("/sys/class/dmi/id", k) or ""
        if VIRTUAL_RE.search(v):
            return "virtual", f"SMBIOS {k} is {v.strip()[:40]!r}"
    kernel = (s.read("/proc/sys/kernel/osrelease") or "").lower()
    if "gvisor" in kernel or "microsoft-standard" in kernel:
        return "virtual", "sandbox kernel"
    return "physical", "no virtualisation detected (physical presence not proven)"


def discover(root: str = "/", run: Runner = run_read_only, station: Optional[dict] = None) -> dict:
    s = Sys(root, run)
    system, f1 = discover_system(s)
    boot = find_boot_medium(s)
    drives, f2 = discover_drives(s, boot)
    st = dict(station or {})
    st["mode"] = "read_only"
    st["hardware_source"], st["hardware_source_reason"] = hardware_source(s, os.path.realpath(root) != "/")
    boot_serial = next((d.get("serial") for d in drives if d.get("is_boot_medium") and d.get("serial")), None)
    if boot_serial:
        st["boot_medium_serial"] = boot_serial
    kernel = s.read("/proc/sys/kernel/osrelease")
    if kernel:
        st["kernel"] = kernel[:120]
    payload = {"system": system, "station": {k: v for k, v in st.items() if v}, "drives": drives}
    flags = f1 + f2 + raid_or_vmd(s)
    if flags:
        payload["review_flags"] = flags[:50]
    payload["_boot_detection"] = boot  # local display only; stripped before upload
    return payload


def upload_payload(p: dict) -> dict:
    return {k: v for k, v in p.items() if not k.startswith("_")}
