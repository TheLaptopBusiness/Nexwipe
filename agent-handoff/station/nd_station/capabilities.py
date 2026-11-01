"""
Read-only drive capability discovery: what erase-related features a drive ADVERTISES.

Nothing here runs, prepares or tests an erase. The result only says which features the drive's own
identify data claims to support; it is not evidence that an erase would work or be complete.

Sources
- SATA (libata/AHCI): the IDENTIFY DEVICE data the kernel already read at boot, exposed as text in
  sysfs (``.../ataN/linkN/devN.M/ata_device/devN.M/id``). Reading it sends nothing to the drive.
- NVMe: one Identify Controller admin command (opcode 0x06, CNS 0x01) sent to the controller's
  character device. Identify only transfers data from the drive to memory. The opcode and CNS are
  fixed constants in this file; there is deliberately no general-purpose command function.

Anything unreadable stays unknown (``None``) with a reason; nothing is guessed.
"""
from __future__ import annotations

import os
import re
import struct
from typing import Callable, Optional

# ----------------------------------------------------------------------------- ATA (sysfs)
ATA_ID_WORDS = 256


def parse_ata_identify_text(text: str) -> Optional[list]:
    """libata prints 256 16-bit words as hex, 8 per line."""
    words = re.findall(r"\b[0-9a-fA-F]{4}\b", text or "")
    if len(words) != ATA_ID_WORDS:
        return None
    return [int(w, 16) for w in words]


def _bit(word: int, n: int) -> bool:
    return bool((word >> n) & 1)


def _valid(word: int) -> bool:
    # 0x0000 / 0xFFFF mean "not reported" for most capability words.
    return word not in (0x0000, 0xFFFF)


def _erase_minutes(word: int) -> Optional[int]:
    """Words 89/90: time in 2-minute units. Bit 15 set = extended format (bits 14:0)."""
    if not _valid(word):
        return None
    units = word & 0x7FFF if _bit(word, 15) else word & 0xFF
    return None if units == 0 else units * 2


def ata_capabilities(words: list) -> dict:
    w82, w59, w128 = words[82], words[59], words[128]
    security_supported = _bit(w82, 1) if _valid(w82) else None
    sec: dict = {"supported": security_supported}
    if security_supported:
        sec.update(
            enabled=_bit(w128, 1),
            locked=_bit(w128, 2),
            frozen=_bit(w128, 3),
            enhanced_erase_supported=_bit(w128, 5),
            normal_erase_minutes=_erase_minutes(words[89]),
            enhanced_erase_minutes=_erase_minutes(words[90]),
        )
    sanitize_supported = _bit(w59, 12)
    san: dict = {"supported": sanitize_supported}
    if sanitize_supported:
        san.update(crypto_scramble=_bit(w59, 13), overwrite=_bit(w59, 14), block_erase=_bit(w59, 15))
    out = {"source": "ata_identify_sysfs", "ata_security": sec, "ata_sanitize_feature": san}
    if _valid(words[169]):
        out["trim_supported"] = _bit(words[169], 0)
    return out


def find_ata_identify(s, disk: str) -> tuple:
    """Return (identify text, None) or (None, reason) for a SATA disk."""
    devpath = s.realpath("/sys/block", disk)
    m = re.search(r"^(.*/ata\d+)/", devpath)
    if not m:
        return None, "no libata port in device path"
    port = m.group(1)
    found = []
    for ln in s.listdir(port):
        if not ln.startswith("link"):
            continue
        for dv in s.listdir(port, ln):
            if dv.startswith("dev") and s.exists(port, ln, dv, "ata_device", dv, "id"):
                found.append(os.path.join(port, ln, dv, "ata_device", dv, "id"))
    if len(found) != 1:
        return None, f"{len(found)} ATA devices on this port (port multiplier or unreadable)"
    text = s.read(found[0])
    return (text, None) if text else (None, "identify data not readable")


# ----------------------------------------------------------------------------- NVMe (Identify)
# struct nvme_admin_cmd (linux/nvme_ioctl.h), 72 bytes:
#   u8 opcode, u8 flags, u16 rsvd1, u32 nsid, u32 cdw2, u32 cdw3, u64 metadata, u64 addr,
#   u32 metadata_len, u32 data_len, u32 cdw10..cdw15, u32 timeout_ms, u32 result
_ADMIN_CMD = struct.Struct("<BBHIIIQQII6III")
NVME_IOCTL_ADMIN_CMD = (3 << 30) | (_ADMIN_CMD.size << 16) | (ord("N") << 8) | 0x41  # _IOWR('N', 0x41, 72)
IDENTIFY_OPCODE = 0x06  # the only NVMe opcode this program can send
IDENTIFY_CNS_CONTROLLER = 0x01
IDENTIFY_LEN = 4096

IdentifyReader = Callable[[str], bytes]


def _identify_controller_ioctl(char_dev: str) -> bytes:
    """Send Identify Controller to /dev/nvmeN (read-only open) and return the 4096-byte structure."""
    import ctypes
    import fcntl

    if not re.fullmatch(r"/dev/nvme\d+", char_dev):
        raise ValueError("not an NVMe controller device")
    buf = ctypes.create_string_buffer(IDENTIFY_LEN)
    cmd = bytearray(_ADMIN_CMD.pack(
        IDENTIFY_OPCODE, 0, 0, 0, 0, 0, 0, ctypes.addressof(buf), 0, IDENTIFY_LEN,
        IDENTIFY_CNS_CONTROLLER, 0, 0, 0, 0, 0, 5000, 0,
    ))
    fd = os.open(char_dev, os.O_RDONLY)
    try:
        rc = fcntl.ioctl(fd, NVME_IOCTL_ADMIN_CMD, cmd, True)
    finally:
        os.close(fd)
    if rc != 0:
        raise OSError(0, f"NVMe status 0x{rc:x}")
    return bytes(buf.raw)


def nvme_capabilities(idc: bytes) -> dict:
    """Decode the erase-relevant fields of an Identify Controller structure."""
    if len(idc) < 1024:
        return {"source": "unavailable", "reason": "short identify data"}
    oacs = struct.unpack_from("<H", idc, 256)[0]
    fna = idc[524]
    sanicap = struct.unpack_from("<I", idc, 328)[0]
    nn = struct.unpack_from("<I", idc, 516)[0]
    fmt = {"supported": _bit(oacs, 1)}
    if fmt["supported"]:
        fmt.update(crypto_erase=_bit(fna, 2), applies_to_all_namespaces=_bit(fna, 0), erase_applies_to_all_namespaces=_bit(fna, 1))
    san = {"crypto_erase": _bit(sanicap, 0), "block_erase": _bit(sanicap, 1), "overwrite": _bit(sanicap, 2)}
    san["supported"] = any(san.values())
    return {
        "source": "nvme_identify_controller",
        "nvme_format_nvm": fmt,
        "nvme_sanitize_feature": san,
        "nvme_namespace_count": nn,
        "nvme_namespace_management": _bit(oacs, 3),
    }


def drive_capabilities(s, disk: str, transport: str, identify: Optional[IdentifyReader] = None) -> dict:
    """Capabilities for one internal drive. Never raises; unknown stays unknown with a reason."""
    try:
        if transport == "sata":
            text, why = find_ata_identify(s, disk)
            if text is None:
                return {"source": "unavailable", "reason": why}
            words = parse_ata_identify_text(text)
            if words is None:
                return {"source": "unavailable", "reason": "identify data malformed"}
            return ata_capabilities(words)
        if transport == "nvme":
            m = re.fullmatch(r"(nvme\d+)n\d+", disk)
            if not m:
                return {"source": "unavailable", "reason": "unexpected NVMe device name"}
            reader = identify or _identify_controller_ioctl
            return nvme_capabilities(reader(f"/dev/{m.group(1)}"))
        return {"source": "unavailable", "reason": f"not detected for transport {transport}"}
    except PermissionError:
        return {"source": "unavailable", "reason": "permission denied (station not running as root)"}
    except OSError as e:
        return {"source": "unavailable", "reason": f"identify failed: {e.strerror or e.__class__.__name__}"[:120]}
    except Exception as e:  # noqa: BLE001 - discovery must never crash on odd hardware
        return {"source": "unavailable", "reason": f"identify failed: {e.__class__.__name__}"}
