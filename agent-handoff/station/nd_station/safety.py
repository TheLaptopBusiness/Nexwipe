"""
Command allow-list for the read-only station.

The station may only run the exact command shapes below. None of them can write to, erase,
partition, format, trim or read data from a storage device. Anything else raises.
"""
from __future__ import annotations

import re
import shutil
import subprocess

_DEV = r"/dev/(nvme\d+n\d+|sd[a-z]{1,2}|mmcblk\d+|vd[a-z]{1,2})"

# (tool, regex over the remaining argv joined by single spaces)
ALLOWED = [
    ("dmidecode", re.compile(r"-t 17")),                     # memory device table (read SMBIOS)
    ("smartctl", re.compile(rf"-i -j {_DEV}")),              # identity only; no -s/-t/-o/--set
    ("ip", re.compile(r"-j (addr|route|link) show")),
    ("nmcli", re.compile(r"-t -f [A-Z,.-]+ (device|general|connection show --active)")),
    ("nmtui", re.compile(r"connect")),                       # interactive Wi-Fi setup
    ("timedatectl", re.compile(r"show -p NTPSynchronized --value")),
]

DESTRUCTIVE_TOOLS = {
    "dd", "blkdiscard", "wipefs", "hdparm", "sdparm", "nvme", "sg_sanitize", "sg_format", "sg_raw",
    "shred", "mkfs", "fdisk", "sfdisk", "sgdisk", "parted", "cryptsetup", "badblocks", "e2fsck", "fsck",
}


class Refused(RuntimeError):
    pass


def check(argv: list) -> None:
    if not argv:
        raise Refused("empty command")
    tool, rest = argv[0], " ".join(argv[1:])
    if tool in DESTRUCTIVE_TOOLS or tool.startswith("mkfs"):
        raise Refused(f"destructive tool is never run by the station: {tool}")
    for t, pattern in ALLOWED:
        if t == tool and pattern.fullmatch(rest):
            return
    raise Refused(f"command not on the read-only allow-list: {argv}")


def run_read_only(argv: list, timeout: int = 20) -> str:
    """Run an allow-listed command; return stdout, or '' if the tool is missing or fails."""
    check(argv)
    if shutil.which(argv[0]) is None:
        return ""
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""
