"""Chromebook discovery tests against a fake sysfs tree. Run from agent-handoff/chromebook-discovery:
   PYTHONPATH=.:../station python3 -m unittest discover -s tests
The tree below is SYNTHETIC: values are invented to exercise parsing, not taken from a real unit."""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "station"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "station", "tests"))

from nd_station import safety  # noqa: E402
from test_discovery import disk, link, w  # noqa: E402

from nd_chromebook import __main__ as cbmain  # noqa: E402
from nd_chromebook import chromeos  # noqa: E402


def ext_csd(sanitize=True, rev=8):
    b = bytearray(512)
    b[192] = rev
    b[231] = 0x55 if sanitize else 0x15
    b[181] = 0
    b[212:216] = (30777344).to_bytes(4, "little")  # ~15.75 GB in 512-byte sectors (synthetic)
    b[226] = 32  # 4 MiB boot partitions
    b[168] = 32  # 4 MiB RPMB
    b[221], b[224] = 1, 1
    return b.hex()


def chromebook_tree(root, ext=True, hwid="SETZER E2A-B3C-D4E", sd_card=False):
    w(root, "/sys/class/dmi/id/bios_vendor", "coreboot\n")
    w(root, "/sys/class/dmi/id/bios_version", "Google_Setzer.7287.999.0\n")
    w(root, "/sys/class/dmi/id/product_name", "Setzer\n")
    w(root, "/sys/class/dmi/id/sys_vendor", "HP\n")
    w(root, "/sys/class/dmi/id/product_serial", "SYNTH0000CB1\n")
    acpi = "/sys/bus/platform/devices/GGL0001:00"
    w(root, f"{acpi}/FWID", "Google_Setzer.7287.999.0")
    w(root, f"{acpi}/FRID", "Google_Setzer.7287.100.0")
    w(root, f"{acpi}/HWID", hwid)
    w(root, f"{acpi}/CHSW", "0x20")
    w(root, "/sys/firmware/vpd/ro/serial_number", "SYNTH0000CB1")
    w(root, "/proc/sys/kernel/arch", "x86_64")
    w(root, "/proc/cpuinfo", "processor : 0\nflags : fpu sse\n")
    card = "/sys/devices/pci0000:00/0000:00:10.0/mmc_host/mmc0/mmc0:0001"
    disk(root, card, "mmcblk0", "179:0", 30777344, device_files={
        "type": "MMC", "name": "SYNTHE", "manfid": "0x000015", "serial": "0x0badcafe", "fwrev": "0x1", "rev": "0x8",
        "cid": "15010053594e5448450badcafe1234"})
    for i, (name, label) in enumerate([("mmcblk0p1", "STATE"), ("mmcblk0p2", "KERN-A"), ("mmcblk0p3", "ROOT-A")]):
        w(root, f"{card}/block/mmcblk0/{name}/uevent", f"MAJOR=179\nMINOR={i + 1}\nPARTNAME={label}\n")
        w(root, f"{card}/block/mmcblk0/{name}/size", "2048")
    disk(root, card, "mmcblk0boot0", "179:8", 8192)
    disk(root, card, "mmcblk0boot1", "179:16", 8192)
    if ext:
        w(root, "/sys/kernel/debug/mmc0/mmc0:0001/ext_csd", ext_csd())
    usb = "/sys/devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1:1.0/host0/target0:0:0/0:0:0:0"
    disk(root, usb, "sda", "8:0", 60000000, removable="1")
    w(root, "/run/udev/data/b8:0", "E:ID_SERIAL_SHORT=SYNTHUSB01\nE:ID_MODEL=NexWipe_Stick\n")
    if sd_card:
        sd = "/sys/devices/pci0000:00/0000:00:12.0/mmc_host/mmc1/mmc1:aaaa"
        disk(root, sd, "mmcblk1", "179:32", 1000000, device_files={"type": "SD", "name": "SDCARD"})


class ChromebookDiscovery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def run_discover(self):
        return cbmain.discover(self.root, run=lambda argv: "")

    def test_board_storage_and_regions(self):
        chromebook_tree(self.root)
        r = self.run_discover()
        cb = r["chromebook"]
        self.assertEqual(cb["identity"]["board_reported"], "SETZER")
        self.assertEqual(cb["identity"]["board_status"], "reported_not_confirmed")
        self.assertEqual(cb["compatibility"], "unverified")
        self.assertEqual(len(cb["storage"]), 1)
        st = cb["storage"][0]
        self.assertEqual(st["kind"], "emmc")
        self.assertTrue(st["ext_csd"]["sec_feature_support"]["sanitize_bit"])
        regions = {x["region"] for x in st["regions"]}
        self.assertTrue({"user_data_area", "boot_partition_0", "boot_partition_1", "rpmb",
                         "device_internal_spare_and_mapping"} <= regions)
        self.assertTrue(all(x["scope_decision"] == "pending_engineering_review" for x in st["regions"]))
        self.assertTrue(st["chromeos_layout_present"])
        self.assertTrue(cb["firmware"]["switches"]["developer_boot"])

    def test_boot_usb_and_hw_partitions_excluded(self):
        chromebook_tree(self.root, sd_card=True)
        cb = self.run_discover()["chromebook"]
        disks = [x["disk"] for x in cb["storage"]]
        self.assertEqual(disks, ["mmcblk0"])  # no sda (boot USB), no boot0/boot1, no SD card

    def test_no_operations_and_separate_chromeos_note(self):
        chromebook_tree(self.root)
        cb = self.run_discover()["chromebook"]
        self.assertEqual(cb["nexwipe_operations"], [])
        self.assertIn("ChromeOS", cb["chromeos_operations"])

    def test_unknowns_stay_unknown(self):
        chromebook_tree(self.root, ext=False)
        r = self.run_discover()
        st = r["chromebook"]["storage"][0]
        self.assertIsNone(st["ext_csd"])
        codes = {f["code"] for f in r["review_flags"]}
        self.assertIn("ext_csd_not_readable", codes)

    def test_board_disagreement_is_flagged_not_resolved(self):
        chromebook_tree(self.root, hwid="RELM A1B-C2D")
        r = self.run_discover()
        self.assertNotIn("board_reported", r["chromebook"]["identity"])
        self.assertIn("board_sources_disagree", {f["code"] for f in r["review_flags"]})

    def test_non_chromebook_flagged(self):
        w(self.root, "/sys/class/dmi/id/bios_vendor", "Dell Inc.\n")
        r = self.run_discover()
        self.assertIn("chromeos_firmware_not_detected", {f["code"] for f in r["review_flags"]})

    def test_firmware_tools_refused(self):
        for tool in ("flashrom", "futility", "crossystem", "gsctool", "mmc", "cgpt"):
            with self.assertRaises(safety.Refused):
                safety.check([tool, "--help"])

    def test_synthetic_tree_reports_synthetic_source(self):
        chromebook_tree(self.root)
        self.assertEqual(self.run_discover()["station"]["hardware_source"], "synthetic")

    def test_ext_csd_rejects_short_input(self):
        self.assertIsNone(chromeos.parse_ext_csd("00ff"))


if __name__ == "__main__":
    unittest.main()
