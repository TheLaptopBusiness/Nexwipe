"""
Command allow-list for the read-only station.

The station may only run the exact command shapes below. None of them can write to, erase,
partition, format, trim or read data from a storage device. Anything else raises.
The hardware-test tools (camera frames, microphone, speaker tone, mixer volume) touch only the
camera and sound card, and stream to stdout; they never name a file.
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
    # hardware test (hwtest.py)
    ("v4l2-ctl", re.compile(r"-d /dev/video\d+ --set-fmt-video=width=\d+,height=\d+,pixelformat=YUYV --get-fmt-video")),
    ("v4l2-ctl", re.compile(r"-d /dev/video\d+ --set-fmt-video=width=\d+,height=\d+,pixelformat=YUYV --stream-mmap --stream-count=\d+ --stream-to=-")),
    ("arecord", re.compile(r"-q -D plughw:\d+,\d+ -f S16_LE -r 16000 -c 1 -t raw -d \d+")),  # no file: writes to stdout
    ("speaker-test", re.compile(r"-D plughw:\d+,\d+ -c 2 -t sine -f \d+ -s [12]")),
    ("amixer", re.compile(r"-q -c \d+ sset (Master|Speaker|PCM|Headphone) 80% unmute")),
    ("amixer", re.compile(r"-q -c \d+ sset (Capture|Mic|Internal Mic) 80% cap")),
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


def popen_read_only(argv: list):
    """Start an allow-listed streaming command (stdout piped); None if the tool is missing."""
    check(argv)
    if shutil.which(argv[0]) is None:
        return None
    try:
        return subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return None
