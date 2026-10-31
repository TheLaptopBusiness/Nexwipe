"""preflight.py must refuse dummy, incomplete and incompatible inputs. All inputs here are SYNTHETIC
(built in the test); a pass means "structurally complete", never "boots".
Run: python3 tests/test_preflight.py   (rootfs tests need mksquashfs/unsquashfs on PATH; skipped otherwise)"""
import gzip
import io
import lzma
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import preflight  # noqa: E402

KREL = "6.12.0-nexwipe-cb"
GOOD_CFG = "\n".join(f"{k}={v or 'y'}" for k, v in preflight.REQUIRED_KCONFIG.items()) + '\nCONFIG_INITRAMFS_SOURCE="/build/initramfs"\n'
GOOD_INITRAMFS = {
    "init": b"#!/bin/sh\n", "dev/console": b"", "scripts/live": b"", "conf/initramfs.conf": b"", "conf/conf.d/zz-nexwipe.conf": b"RESUME=none\nMODULES=list\n",
    "usr/bin/live-boot": b"", "usr/lib/live/boot/9990-main.sh": b"", "usr/lib/live/boot/0020-read-only": b"",
    "usr/sbin/blockdev": b"", f"usr/lib/modules/{KREL}/modules.dep": b"",
}


def cpio(files: dict) -> bytes:
    out = io.BytesIO()
    for i, (name, body) in enumerate(list(files.items()) + [("TRAILER!!!", b"")]):
        n = name.encode() + b"\0"
        hdr = b"070701" + b"".join(f"{x:08x}".encode() for x in (i, 0o100644, 0, 0, 1, 0, len(body), 0, 0, 0, 0, len(n), 0))
        out.write(hdr + n)
        out.write(b"\0" * ((4 - (110 + len(n)) % 4) % 4))
        out.write(body)
        out.write(b"\0" * ((4 - len(body) % 4) % 4))
    return out.getvalue()


def bzimage(cfg=GOOD_CFG, initramfs=GOOD_INITRAMFS, krel=KREL, payload_xz=True, ikconfig=True, hdr=b"HdrS",
            xload=1, size=preflight.MIN_KERNEL + 4096) -> bytes:
    vm = b"\0" * 64 + f"Linux version {krel} (builder) #1 SMP".encode() + b"\0" * 64
    if ikconfig:
        vm += b"IKCFG_ST" + gzip.compress(cfg.encode()) + b"IKCFG_ED"
    if initramfs is not None:
        vm += b"\0" * 32 + lzma.compress(cpio(initramfs), format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC32)
    payload = lzma.compress(vm, format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC32) if payload_xz else gzip.compress(vm)
    setup_sects = 4
    pm = (setup_sects + 1) * 512
    data = bytearray(max(size, pm + 0x100 + len(payload)))
    data[0x1F1] = setup_sects
    data[0x202:0x206] = hdr
    struct.pack_into("<H", data, 0x206, 0x020F)
    struct.pack_into("<H", data, 0x236, xload)
    struct.pack_into("<II", data, 0x248, 0x100, len(payload))
    data[pm + 0x100: pm + 0x100 + len(payload)] = payload
    return bytes(data)


class Kernel(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, blob):
        p = os.path.join(self.tmp.name, "bzImage")
        open(p, "wb").write(blob)
        return preflight.check_kernel(p)

    def refused(self, blob, text):
        with self.assertRaises(preflight.Fail) as e:
            self.check(blob)
        self.assertIn(text, str(e.exception))

    def test_well_formed_synthetic_kernel_passes_structure_only(self):
        self.assertEqual(self.check(bzimage())["kernel_release"], KREL)

    def test_dummy_file(self):
        self.refused(b"not a kernel" * 10, "too small")

    def test_not_x86_bzimage(self):
        self.refused(bzimage(hdr=b"ARMd"), "not an x86 bzImage")

    def test_32bit(self):
        self.refused(bzimage(xload=0), "not a 64-bit kernel")

    def test_stock_style_payload(self):
        self.refused(bzimage(payload_xz=False), "not xz-compressed")

    def test_no_embedded_config(self):
        self.refused(bzimage(ikconfig=False), "no embedded config")

    def test_missing_required_option(self):
        self.refused(bzimage(cfg=GOOD_CFG.replace("CONFIG_CHROMEOS_ACPI=y", "CONFIG_CHROMEOS_ACPI=m")), "CONFIG_CHROMEOS_ACPI")

    def test_no_builtin_initramfs_source(self):
        self.refused(bzimage(cfg=GOOD_CFG.replace('"/build/initramfs"', '""')), "INITRAMFS_SOURCE is empty")

    def test_initramfs_absent(self):
        self.refused(bzimage(initramfs=None), "built-in initramfs not found")

    def test_initramfs_without_live_boot(self):
        f = {k: v for k, v in GOOD_INITRAMFS.items() if k != "scripts/live"}
        self.refused(bzimage(initramfs=f), "scripts/live")

    def test_initramfs_without_read_only_support(self):
        f = {k: v for k, v in GOOD_INITRAMFS.items() if k != "usr/sbin/blockdev"}
        self.refused(bzimage(initramfs=f), "blockdev")

    def test_resume_not_disabled(self):
        f = dict(GOOD_INITRAMFS, **{"conf/conf.d/zz-nexwipe.conf": b"RESUME=UUID=1234\n"})
        self.refused(bzimage(initramfs=f), "RESUME=none")

    def test_modules_for_other_kernel(self):
        f = {k.replace(KREL, "6.12.107+deb13-amd64"): v for k, v in GOOD_INITRAMFS.items()}
        self.refused(bzimage(initramfs=f), "not 6.12.0-nexwipe-cb")

    def test_real_stock_debian_kernel_if_available(self):
        p = os.environ.get("ND_STOCK_KERNEL")
        if not p or not os.path.exists(p):
            self.skipTest("set ND_STOCK_KERNEL to a stock Debian vmlinuz")
        with self.assertRaises(preflight.Fail):
            preflight.check_kernel(p)


@unittest.skipUnless(shutil.which("mksquashfs") and shutil.which("unsquashfs"), "squashfs-tools not installed")
class Rootfs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "root")
        for p in preflight.REQUIRED_ROOTFS + ["usr/bin/python3", f"usr/lib/modules/{KREL}/modules.dep"]:
            full = os.path.join(self.root, p)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            open(full, "w").write("x")
        open(os.path.join(self.root, "etc/fstab"), "w").write("# UNCONFIGURED FSTAB\n")
        self.old_min = preflight.MIN_SQUASHFS
        preflight.MIN_SQUASHFS = 1024

    def tearDown(self):
        preflight.MIN_SQUASHFS = self.old_min
        self.tmp.cleanup()

    def squash(self):
        out = os.path.join(self.tmp.name, "fs.squashfs")
        subprocess.run(["mksquashfs", self.root, out, "-noappend", "-no-progress", "-quiet"], check=True, capture_output=True)
        return out

    def add(self, path, content="x"):
        full = os.path.join(self.root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        open(full, "w").write(content)

    def refused(self, text):
        with self.assertRaises(preflight.Fail) as e:
            preflight.check_rootfs(self.squash(), KREL)
        self.assertIn(text, str(e.exception))

    def test_complete_synthetic_rootfs_passes_structure_only(self):
        self.assertEqual(preflight.check_rootfs(self.squash(), KREL)["kernel_modules"], KREL)

    def test_not_squashfs(self):
        p = os.path.join(self.tmp.name, "dummy")
        open(p, "wb").write(b"\0" * 4096)
        with self.assertRaises(preflight.Fail):
            preflight.check_rootfs(p, KREL)

    def test_too_small_real_check(self):
        preflight.MIN_SQUASHFS = self.old_min
        self.refused("too small")

    def test_missing_chromebook_program(self):
        os.remove(os.path.join(self.root, "opt/nextdrive/nd_chromebook/__main__.py"))
        self.refused("nd_chromebook/__main__.py")

    def test_missing_read_only_lock(self):
        os.remove(os.path.join(self.root, "usr/local/sbin/nd-internal-ro"))
        self.refused("nd-internal-ro")

    def test_modules_missing_for_kernel(self):
        shutil.rmtree(os.path.join(self.root, f"usr/lib/modules/{KREL}"))
        self.refused("kernel modules for")

    def test_forbidden_tools(self):
        for tool in ("usr/sbin/swapon", "usr/sbin/flashrom", "usr/bin/dd", "usr/sbin/mkfs.ext4", "usr/libexec/udisks2/udisksd"):
            with self.subTest(tool=tool):
                self.add(tool)
                self.refused("forbidden tools")
                os.remove(os.path.join(self.root, tool))

    def test_fstab_entries(self):
        self.add("etc/fstab", "/dev/mmcblk0p1 /mnt ext4 rw 0 0\n")
        self.refused("/etc/fstab has entries")

    def test_other_kernel_modules(self):
        self.add("usr/lib/modules/6.12.107+deb13-amd64/modules.dep")
        self.refused("modules for other kernels")


if __name__ == "__main__":
    unittest.main()
