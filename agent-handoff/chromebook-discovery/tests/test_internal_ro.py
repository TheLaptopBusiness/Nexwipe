"""Tests for rootfs/usr/local/sbin/nd-internal-ro on a SYNTHETIC sysfs tree (no real devices touched).
Run: python3 tests/test_internal_ro.py"""
import os
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "rootfs", "usr", "local", "sbin", "nd-internal-ro")


def w(root, path, content=""):
    full = os.path.join(root, path.lstrip("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, "w").write(content)


def blockdev(root, devdir, name, parts=()):
    base = f"{devdir}/block/{name}"
    os.makedirs(os.path.join(root, base.lstrip("/")), exist_ok=True)
    os.makedirs(os.path.join(root, "sys/block"), exist_ok=True)
    os.makedirs(os.path.join(root, "sys/class/block"), exist_ok=True)
    os.symlink(os.path.join(root, base.lstrip("/")), os.path.join(root, "sys/block", name))
    os.symlink(os.path.join(root, base.lstrip("/")), os.path.join(root, "sys/class/block", name))
    for p in parts:
        os.makedirs(os.path.join(root, base.lstrip("/"), p))
        os.symlink(os.path.join(root, base.lstrip("/"), p), os.path.join(root, "sys/class/block", p))
        w(root, f"/dev/{p}")


class InternalReadOnly(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.log = os.path.join(self.root, "calls.log")
        fake = os.path.join(self.root, "fake-blockdev")
        open(fake, "w").write(f'#!/bin/sh\necho "$@" >> {self.log}\n')
        os.chmod(fake, 0o755)
        self.env = {**os.environ, "ND_SYSROOT": self.root, "ND_BLOCKDEV": fake}
        blockdev(self.root, "/sys/devices/pci0000:00/0000:00:10.0/mmc_host/mmc0/mmc0:0001", "mmcblk0", ("mmcblk0p1", "mmcblk0p2"))
        blockdev(self.root, "/sys/devices/pci0000:00/0000:00:10.0/mmc_host/mmc0/mmc0:0001", "mmcblk0boot0")
        blockdev(self.root, "/sys/devices/pci0000:00/0000:00:14.0/usb1/1-1/host0/target0:0:0/0:0:0:0", "sda", ("sda1", "sda2", "sda3"))
        blockdev(self.root, "/sys/devices/virtual", "loop0")

    def tearDown(self):
        self.tmp.cleanup()

    def calls(self):
        return open(self.log).read().split("\n") if os.path.exists(self.log) else []

    def run_script(self, *args):
        return subprocess.run(["sh", SCRIPT, *args], env=self.env, capture_output=True, text=True, check=True)

    def mount_boot(self):
        w(self.root, "/proc/self/mountinfo", "30 22 8:1 / /run/live/medium ro,noatime - vfat /dev/sda1 ro\n")

    def test_internal_set_read_only_boot_usb_left_writable(self):
        self.mount_boot()
        self.run_script()
        c = self.calls()
        for d in ("mmcblk0", "mmcblk0p1", "mmcblk0p2", "mmcblk0boot0"):
            self.assertIn(f"--setro /dev/{d}", c)
        self.assertFalse(any("sda" in x for x in c))
        self.assertFalse(any("loop0" in x for x in c))

    def test_unknown_boot_disk_sets_everything_read_only(self):
        r = self.run_script()
        self.assertIn("NOT identified", r.stderr)
        self.assertIn("--setro /dev/sda", self.calls())
        self.assertIn("--setro /dev/mmcblk0", self.calls())

    def test_hotplug_device(self):
        self.mount_boot()
        self.run_script("--device", "mmcblk0p2")
        self.run_script("--device", "sda2")
        self.assertEqual([x for x in self.calls() if x], ["--setro /dev/mmcblk0p2"])

    def test_script_uses_only_setro(self):
        src = open(SCRIPT).read()
        cmds = {line.split("--")[1].split()[0] for line in src.splitlines() if "$BLOCKDEV --" in line}
        self.assertEqual(cmds, {"setro"})


if __name__ == "__main__":
    unittest.main()
