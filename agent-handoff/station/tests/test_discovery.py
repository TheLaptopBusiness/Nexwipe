"""Discovery tests against a fake sysfs tree (no hardware needed). Run: python3 -m unittest discover -s tests"""
import builtins
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from nd_station import discovery, safety  # noqa: E402


def w(root, path, content=""):
    full = os.path.join(root, path.lstrip("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    mode = "wb" if isinstance(content, bytes) else "w"
    with open(full, mode) as f:
        f.write(content)


def link(root, linkpath, target):
    full = os.path.join(root, linkpath.lstrip("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    os.symlink(os.path.join(root, target.lstrip("/")), full)


def disk(root, devdir, name, dev, size, removable="0", rotational="0", device_files=None, device_dir=None):
    base = f"{devdir}/block/{name}"
    w(root, f"{base}/dev", dev)
    w(root, f"{base}/size", str(size))
    w(root, f"{base}/removable", removable)
    w(root, f"{base}/queue/rotational", rotational)
    dd = device_dir or devdir
    for k, v in (device_files or {}).items():
        w(root, f"{dd}/{k}", v)
    link(root, f"{base}/device", dd)
    link(root, f"/sys/block/{name}", base)
    link(root, f"/sys/dev/block/{dev}", base)
    return base


def build(root, *, vendor="Dell Inc.", product="Latitude 5420", version="", serial="7XK2Q93", mount_boot=True, dup=False, nvme_serial="S5H9NX0R123456"):
    w(root, "/sys/class/dmi/id/sys_vendor", vendor)
    w(root, "/sys/class/dmi/id/product_name", product)
    w(root, "/sys/class/dmi/id/product_version", version)
    w(root, "/sys/class/dmi/id/product_serial", serial)
    w(root, "/sys/class/dmi/id/bios_version", "1.21.0")
    w(root, "/proc/cpuinfo", "processor\t: 0\nmodel name\t: 11th Gen Intel(R) Core(TM) i5-1145G7 @ 2.60GHz\n")
    w(root, "/proc/meminfo", "MemTotal:       16127236 kB\n")
    os.makedirs(os.path.join(root, "sys/firmware/efi"), exist_ok=True)
    # Internal NVMe
    nv = "/sys/devices/pci0000:00/0000:00:1d.0/0000:02:00.0/nvme/nvme0"
    w(root, f"{nv}/model", "SAMSUNG MZVLB512HBJQ-000L7   ")
    w(root, f"{nv}/serial", nvme_serial + "  ")
    w(root, f"{nv}/firmware_rev", "5M2QEXF7")
    disk(root, nv, "nvme0n1", "259:0", 1000215216, device_dir=nv)
    w(root, f"{nv}/block/nvme0n1/eui", "0025388b91b2c3d4")
    # Internal SATA SSD on AHCI
    sata = "/sys/devices/pci0000:00/0000:00:17.0/ata1/host0/target0:0:0/0:0:0:0"
    disk(root, sata, "sda", "8:0", 976773168, device_files={"model": "Samsung SSD 860 ", "rev": "4B6Q", "vpd_pg80": b"\x00\x80\x00\x0eS3Z9NB0K000001"})
    w(root, "/run/udev/data/b8:0", "E:ID_MODEL_ENC=Samsung\\x20SSD\\x20860\\x20EVO\\x20500GB\nE:ID_SERIAL_SHORT=" + (nvme_serial if dup else "S3Z9NB0K000001") + "\nE:ID_REVISION=RVT04B6Q\nE:ID_PATH=pci-0000:00:17.0-ata-1\n")
    # Boot USB (whole disk + partition), plus a second LUN on the same USB device (card reader)
    usb = "/sys/devices/pci0000:00/0000:00:14.0/usb2/2-1/2-1:1.0/host6/target6:0:0"
    b = disk(root, f"{usb}/6:0:0:0", "sdb", "8:16", 60063744, removable="1")
    w(root, f"{b}/sdb1/partition", "1")
    w(root, f"{b}/sdb1/dev", "8:17")
    link(root, "/sys/dev/block/8:17", f"{b}/sdb1")
    w(root, "/run/udev/data/b8:16", "E:ID_SERIAL_SHORT=4C530001234567\nE:ID_MODEL=Ultra\n")
    disk(root, f"{usb}/6:0:0:1", "sdc", "8:32", 0, removable="1")
    # Unrelated USB stick in another port
    other = "/sys/devices/pci0000:00/0000:00:14.0/usb2/2-2/2-2:1.0/host7/target7:0:0/7:0:0:0"
    disk(root, other, "sdd", "8:48", 15000000, removable="1")
    w(root, "/run/udev/data/b8:48", "E:ID_SERIAL_SHORT=OTHERSTICK01\n")
    # Loop device for the squashfs (must be ignored)
    os.makedirs(os.path.join(root, "sys/block/loop0"), exist_ok=True)
    mi = "22 1 0:21 / / rw - overlay overlay rw\n"
    if mount_boot:
        mi += "30 22 8:17 / /run/live/medium ro,noatime - vfat /dev/sdb1 ro\n"
    w(root, "/proc/self/mountinfo", mi)


def fake_run(argv):
    safety.check(argv)  # every command the discovery wants to run must be allow-listed
    return ""


class Discovery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def by_serial(self, p):
        return {d.get("serial"): d for d in p["drives"]}

    def test_reports_laptop_identity(self):
        build(self.root)
        p = discovery.discover(self.root, fake_run)
        s = p["system"]
        self.assertEqual((s["manufacturer"], s["model"], s["serial"]), ("Dell Inc.", "Latitude 5420", "7XK2Q93"))
        self.assertIn("i5-1145G7", s["cpu"])
        self.assertEqual(s["ram_bytes"], 16127236 * 1024)
        self.assertEqual(s["boot_mode"], "uefi")

    def test_internal_drives_with_identity(self):
        build(self.root)
        d = self.by_serial(discovery.discover(self.root, fake_run))
        nv = d["S5H9NX0R123456"]
        self.assertEqual((nv["interface"], nv["model"], nv["firmware"], nv["capacity_bytes"]), ("nvme_ssd", "SAMSUNG MZVLB512HBJQ-000L7", "5M2QEXF7", 1000215216 * 512))
        self.assertFalse(nv["is_boot_medium"])
        sa = d["S3Z9NB0K000001"]
        self.assertEqual((sa["interface"], sa["model"], sa["firmware"]), ("sata_ssd", "Samsung SSD 860 EVO 500GB", "RVT04B6Q"))
        self.assertEqual(sa["bus_path"], "pci-0000:00:17.0-ata-1")

    def test_boot_medium_found_by_ancestry(self):
        build(self.root)
        p = discovery.discover(self.root, fake_run)
        boot = p["_boot_detection"]
        self.assertEqual(boot["disk"], "sdb")
        self.assertTrue(boot["ancestor"].endswith("/usb2/2-1"))
        d = {x.get("serial") or x.get("transport") + str(x.get("capacity_bytes")): x for x in p["drives"]}
        self.assertTrue(d["4C530001234567"]["is_boot_medium"])
        # second LUN behind the same USB device is also excluded as boot medium
        siblings = [x for x in p["drives"] if x.get("transport") == "usb" and not x.get("serial")]
        self.assertTrue(all(x["is_boot_medium"] for x in siblings))
        other = d["OTHERSTICK01"]
        self.assertFalse(other["is_boot_medium"])
        self.assertTrue(other["removable"])
        self.assertEqual(p["station"]["boot_medium_serial"], "4C530001234567")

    def test_boot_medium_not_guessed_by_name(self):
        build(self.root, mount_boot=False)
        p = discovery.discover(self.root, fake_run)
        self.assertFalse(any(x.get("is_boot_medium") for x in p["drives"]))
        self.assertIn("boot_medium_not_identified", [f["code"] for f in p["review_flags"]])
        # USB devices are still never treated as internal
        self.assertTrue(all(x["removable"] for x in p["drives"] if x.get("transport") == "usb"))

    def test_loop_devices_ignored(self):
        build(self.root)
        self.assertNotIn("loop0", str(discovery.discover(self.root, fake_run)["drives"]))

    def test_placeholder_serial_flagged(self):
        build(self.root, serial="To Be Filled By O.E.M.")
        p = discovery.discover(self.root, fake_run)
        self.assertNotIn("serial", p["system"])
        self.assertIn("system_serial_placeholder", [f["code"] for f in p["review_flags"]])

    def test_missing_serial_flagged(self):
        build(self.root)
        os.remove(os.path.join(self.root, "sys/class/dmi/id/product_serial"))
        p = discovery.discover(self.root, fake_run)
        self.assertIn("system_serial_missing", [f["code"] for f in p["review_flags"]])

    def test_duplicate_drive_serial_flagged(self):
        build(self.root, dup=True)
        flags = discovery.discover(self.root, fake_run)["review_flags"]
        self.assertIn({"code": "duplicate_drive_serial", "target": "S5H9NX0R123456"}, flags)

    def test_missing_drive_serial_flagged(self):
        build(self.root, nvme_serial="")
        flags = [f["code"] for f in discovery.discover(self.root, fake_run)["review_flags"]]
        self.assertIn("drive_serial_missing", flags)

    def test_lenovo_marketing_name(self):
        build(self.root, vendor="LENOVO", product="21AH00BLUS", version="ThinkPad T14 Gen 3")
        s = discovery.discover(self.root, fake_run)["system"]
        self.assertEqual((s["model"], s["sku"]), ("ThinkPad T14 Gen 3", "21AH00BLUS"))

    def test_never_opens_device_nodes(self):
        build(self.root)
        real_open, opened = builtins.open, []

        def spy(path, *a, **k):
            opened.append(str(path))
            return real_open(path, *a, **k)

        builtins.open = spy
        try:
            discovery.discover(self.root, fake_run)
        finally:
            builtins.open = real_open
        self.assertFalse([p for p in opened if p.startswith("/dev/") or "/dev/" in p.replace(self.root, "")])

    def test_test_tree_is_declared_synthetic(self):
        build(self.root)
        st = discovery.upload_payload(discovery.discover(self.root, fake_run))["station"]
        self.assertEqual(st["hardware_source"], "synthetic")

    def test_virtual_machine_detected(self):
        build(self.root)
        s = discovery.Sys(self.root, fake_run)
        self.assertEqual(discovery.hardware_source(s, fixture=False)[0], "physical")
        w(self.root, "/sys/class/dmi/id/sys_vendor", "QEMU")
        self.assertEqual(discovery.hardware_source(s, fixture=False)[0], "virtual")

    def test_hypervisor_cpu_flag_detected(self):
        build(self.root)
        w(self.root, "/proc/cpuinfo", "model name\t: Intel(R) Core(TM) i5\nflags\t\t: fpu vme sse2 hypervisor\n")
        self.assertEqual(discovery.hardware_source(discovery.Sys(self.root, fake_run), fixture=False)[0], "virtual")

    def test_upload_payload_strips_local_fields(self):
        build(self.root)
        p = discovery.upload_payload(discovery.discover(self.root, fake_run))
        self.assertNotIn("_boot_detection", p)
        self.assertEqual(p["station"]["mode"], "read_only")


class Safety(unittest.TestCase):
    def test_refuses_destructive(self):
        for argv in (["nvme", "sanitize", "/dev/nvme0"], ["hdparm", "--security-erase", "x", "/dev/sda"], ["dd", "if=/dev/zero", "of=/dev/sda"],
                     ["blkdiscard", "/dev/sda"], ["wipefs", "-a", "/dev/sda"], ["mkfs.ext4", "/dev/sda"], ["smartctl", "-t", "long", "/dev/sda"],
                     ["smartctl", "-s", "on", "/dev/sda"], ["sg_sanitize", "/dev/sg0"], ["sh", "-c", "dd if=/dev/zero of=/dev/sda"]):
            with self.assertRaises(safety.Refused, msg=argv):
                safety.check(argv)

    def test_allows_identity_reads(self):
        for argv in (["smartctl", "-i", "-j", "/dev/sda"], ["smartctl", "-i", "-j", "/dev/nvme0n1"], ["dmidecode", "-t", "17"], ["ip", "-j", "addr", "show"]):
            safety.check(argv)


if __name__ == "__main__":
    unittest.main()
