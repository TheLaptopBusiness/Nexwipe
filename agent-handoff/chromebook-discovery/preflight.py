#!/usr/bin/env python3
"""
Fail-closed input checks for the NexWipe Chromebook discovery image (stdlib only).

  preflight.py kernel  <bzImage>                     check the kernel blob
  preflight.py rootfs  <filesystem.squashfs> <krel>  check the live root filesystem (needs unsquashfs)
  preflight.py all     <bzImage> <filesystem.squashfs>

Refuses: dummy or truncated files, non-x86-64 kernels, kernels not built from this kit's config
(embedded config missing or required options not built in), kernels without a built-in live-boot
initramfs, initramfs modules for a different kernel release, root filesystems without the
Chromebook program, systemd units or matching kernel modules, and root filesystems containing
storage-destructive, swap-activation, automount or firmware/flag tools.

Passing these checks means the inputs are structurally complete. It does NOT mean the image boots
on any Chromebook; that is only established by booting it on the physical unit.
"""
from __future__ import annotations

import gzip
import json
import lzma
import os
import re
import struct
import subprocess
import sys

REQUIRED_KCONFIG = {
    "CONFIG_X86_64": "y",
    "CONFIG_64BIT": "y",
    "CONFIG_IKCONFIG": "y",
    "CONFIG_BLK_DEV_INITRD": "y",
    "CONFIG_KERNEL_XZ": "y",
    "CONFIG_INITRAMFS_COMPRESSION_XZ": "y",
    "CONFIG_CHROMEOS_ACPI": "y",
    "CONFIG_GOOGLE_VPD": "y",
    "CONFIG_MMC_BLOCK": "y",
    "CONFIG_MMC_SDHCI_PCI": "y",
    "CONFIG_USB_XHCI_PCI": "y",
    "CONFIG_USB_STORAGE": "y",
    "CONFIG_BLK_DEV_SD": "y",
    "CONFIG_DEBUG_FS": "y",
    "CONFIG_SQUASHFS": None,     # y or m (live-boot loads it from the initramfs)
    "CONFIG_OVERLAY_FS": None,
    "CONFIG_VFAT_FS": None,
}
# Paths that must exist inside the built-in initramfs (initramfs-tools + live-boot).
REQUIRED_INITRAMFS = ["init", "scripts/live", "bin/live-boot", "conf/initramfs.conf"]
REQUIRED_INITRAMFS_ANY = [r"^(usr/)?lib/live/boot/9990-main\.sh$"]

REQUIRED_ROOTFS = [
    "opt/nextdrive/nd_chromebook/__main__.py",
    "opt/nextdrive/nd_chromebook/chromeos.py",
    "opt/nextdrive/nd_station/__main__.py",
    "opt/nextdrive/nd_station/safety.py",
    "etc/systemd/system/nd-console.service",
    "etc/systemd/system/nd-console.service.d/chromebook.conf",
    "etc/systemd/system/var-lib-nextdrive.mount",
    "etc/systemd/system/var-lib-nextdrive.mount.d/chromebook.conf",
    "etc/nextdrive/station.json",
    "etc/nextdrive/image-release",
    "usr/lib/systemd/systemd",
]
REQUIRED_ROOTFS_ANY = [r"^usr/bin/python3(\.\d+)?$"]
FORBIDDEN_TOOLS = (
    "blkdiscard blkzone fstrim wipefs mkfs mkswap swapon fdisk sfdisk cfdisk sgdisk parted mke2fs debugfs "
    "resize2fs tune2fs e2fsck fsck badblocks e2image hdparm sdparm nvme sg_sanitize sg_format sg_raw "
    "sg_write_same dd shred cryptsetup flashrom futility crossystem vpd gsctool ectool cgpt mmc "
    "chromeos-firmwareupdate chromeos-setgoodkernel chromeos-install dump_fmap gbb_utility vbutil_firmware "
    "enable_dev_usb_boot tpmc udisksd udisksctl"
).split()
FORBIDDEN_RE = re.compile(r"^(usr/)?(s?bin|local/s?bin|libexec/udisks2)/(" + "|".join(map(re.escape, FORBIDDEN_TOOLS)) + r"|mkfs\.[\w.]+|fsck\.[\w.]+)$")

XZ_MAGIC = b"\xfd7zXZ\x00"
MIN_KERNEL = 4 * 1024 * 1024
MIN_SQUASHFS = 80 * 1024 * 1024


class Fail(Exception):
    pass


def _xz_streams(data: bytes, limit: int = 64):
    """Yield (offset, decompressed) for every xz stream that decodes."""
    pos, n = 0, 0
    while n < limit:
        i = data.find(XZ_MAGIC, pos)
        if i < 0:
            return
        pos = i + 1
        d = lzma.LZMADecompressor(format=lzma.FORMAT_XZ)
        try:
            out = d.decompress(data[i:])
        except lzma.LZMAError:
            continue
        n += 1
        yield i, out


def parse_cpio_names(blob: bytes) -> list:
    names, off = [], 0
    while off + 110 <= len(blob):
        if blob[off:off + 6] not in (b"070701", b"070702"):
            # concatenated archives may be padded with zeros
            nxt = blob.find(b"070701", off)
            if nxt < 0:
                break
            off = nxt
            continue
        hdr = blob[off:off + 110]
        fsize = int(hdr[54:62], 16)
        nsize = int(hdr[94:102], 16)
        name = blob[off + 110:off + 110 + nsize - 1].decode("utf-8", "replace")
        off = (off + 110 + nsize + 3) & ~3
        off = (off + fsize + 3) & ~3
        if name == "TRAILER!!!":
            continue
        names.append(name.lstrip("./"))
    return names


def check_kernel(path: str) -> dict:
    data = open(path, "rb").read()
    if len(data) < MIN_KERNEL:
        raise Fail(f"kernel: {len(data)} bytes — too small to be a real bzImage (dummy or truncated file?)")
    if data[0x202:0x206] != b"HdrS":
        raise Fail("kernel: not an x86 bzImage (no 'HdrS' boot header) — wrong architecture or not a kernel")
    proto = struct.unpack_from("<H", data, 0x206)[0]
    if proto < 0x020C:
        raise Fail(f"kernel: boot protocol {proto:#x} is too old")
    xloadflags = struct.unpack_from("<H", data, 0x236)[0]
    if not xloadflags & 0x1:
        raise Fail("kernel: not a 64-bit kernel (XLF_KERNEL_64 not set)")
    setup_sects = data[0x1F1] or 4
    pm_start = (setup_sects + 1) * 512
    payload_off, payload_len = struct.unpack_from("<II", data, 0x248)
    payload = data[pm_start + payload_off: pm_start + payload_off + payload_len]
    if not payload.startswith(XZ_MAGIC):
        raise Fail("kernel: payload is not xz-compressed — not built with this kit's config (CONFIG_KERNEL_XZ)")
    try:
        vmlinux = lzma.LZMADecompressor(format=lzma.FORMAT_XZ).decompress(payload)
    except lzma.LZMAError as e:
        raise Fail(f"kernel: payload does not decompress ({e})")
    m = re.search(rb"Linux version (\S+)", vmlinux)
    if not m:
        raise Fail("kernel: no 'Linux version' string in the decompressed kernel")
    krel = m.group(1).decode()
    s = vmlinux.find(b"IKCFG_ST")
    e = vmlinux.find(b"IKCFG_ED", s)
    if s < 0 or e < 0:
        raise Fail("kernel: no embedded config (CONFIG_IKCONFIG) — not built with this kit's config")
    cfg_text = gzip.decompress(vmlinux[s + 8:e]).decode("utf-8", "replace")
    cfg = dict(re.findall(r"^(CONFIG_\w+)=(.*)$", cfg_text, re.M))
    missing = []
    for k, want in REQUIRED_KCONFIG.items():
        have = cfg.get(k)
        if want is None and have not in ("y", "m") or want is not None and have != want:
            missing.append(f"{k}={have or 'unset'} (need {want or 'y/m'})")
    src = cfg.get("CONFIG_INITRAMFS_SOURCE", '""').strip('"')
    if not src:
        missing.append("CONFIG_INITRAMFS_SOURCE is empty (no built-in initramfs)")
    if missing:
        raise Fail("kernel: required options not built in: " + "; ".join(missing))
    initramfs = None
    for off, out in _xz_streams(vmlinux):
        if out[:6] in (b"070701", b"070702"):
            names = parse_cpio_names(out)
            if "init" in names:
                initramfs = names
                break
    if initramfs is None:
        raise Fail("kernel: built-in initramfs not found or contains no /init")
    have = set(initramfs)
    lacks = [p for p in REQUIRED_INITRAMFS if p not in have]
    lacks += [r for r in REQUIRED_INITRAMFS_ANY if not any(re.match(r, n) for n in initramfs)]
    if lacks:
        raise Fail("kernel: built-in initramfs lacks startup components: " + ", ".join(lacks))
    mod_dirs = set()
    for n in initramfs:
        m = re.match(r"^(?:usr/)?lib/modules/([^/]+)/", n)
        if m:
            mod_dirs.add(m.group(1))
    if krel not in mod_dirs:
        raise Fail(f"kernel: initramfs modules are for {sorted(mod_dirs) or 'no kernel'}, not {krel}")
    return {"kernel_release": krel, "initramfs_entries": len(initramfs), "boot_protocol": f"{proto:#x}"}


def check_rootfs(path: str, krel: str) -> dict:
    head = open(path, "rb").read(4)
    size = os.path.getsize(path)
    if head != b"hsqs":
        raise Fail("rootfs: not a squashfs image")
    if size < MIN_SQUASHFS:
        raise Fail(f"rootfs: {size} bytes — too small for a complete root filesystem (dummy?)")
    try:
        listing = subprocess.run(["unsquashfs", "-l", "-d", "", path], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        raise Fail(f"rootfs: unsquashfs failed ({e})")
    names = [l.strip().lstrip("/") for l in listing.splitlines() if l.strip() and not l.startswith(("Parallel", "squashfs-root"))]
    names = [re.sub(r"^squashfs-root/?", "", n) for n in names]
    have = set(names)
    lacks = [p for p in REQUIRED_ROOTFS if p not in have]
    lacks += [r for r in REQUIRED_ROOTFS_ANY if not any(re.match(r, n) for n in names)]
    for mod_root in (f"lib/modules/{krel}/modules.dep", f"usr/lib/modules/{krel}/modules.dep"):
        if mod_root in have:
            break
    else:
        lacks.append(f"kernel modules for {krel} (lib/modules/{krel}/modules.dep)")
    if lacks:
        raise Fail("rootfs: missing startup components: " + ", ".join(lacks))
    bad = sorted(n for n in names if FORBIDDEN_RE.match(n))
    if bad:
        raise Fail("rootfs: forbidden tools present: " + ", ".join(bad))
    other_kernels = sorted({n.split("/")[-1] for n in names if re.fullmatch(r"(usr/)?lib/modules/[^/]+", n)} - {krel})
    if other_kernels:
        raise Fail(f"rootfs: modules for other kernels present: {other_kernels}")
    fstab = subprocess.run(["unsquashfs", "-cat", path, "etc/fstab"], capture_output=True, text=True).stdout
    if any(l.strip() and not l.lstrip().startswith("#") for l in fstab.splitlines()):
        raise Fail("rootfs: /etc/fstab has entries (internal filesystems or swap could be activated)")
    return {"rootfs_entries": len(names), "kernel_modules": krel}


def main(argv: list) -> int:
    try:
        if argv[:1] == ["kernel"] and len(argv) == 2:
            r = check_kernel(argv[1])
        elif argv[:1] == ["rootfs"] and len(argv) == 3:
            r = check_rootfs(argv[1], argv[2])
        elif argv[:1] == ["all"] and len(argv) == 3:
            r = check_kernel(argv[1])
            r.update(check_rootfs(argv[2], r["kernel_release"]))
        else:
            print(__doc__, file=sys.stderr)
            return 2
    except Fail as e:
        print(f"PREFLIGHT FAILED: {e}", file=sys.stderr)
        return 1
    r["note"] = "Inputs are structurally complete. This is not evidence that the image boots on any Chromebook."
    print(json.dumps(r, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
