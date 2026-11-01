"""Capability decoding tests (no hardware). Run: python3 -m unittest discover -s tests"""
import os, re, struct, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from nd_station import capabilities as caps, discovery  # noqa: E402
from test_discovery import build, w  # noqa: E402


def ata_text(**words):
    ws = [0] * 256
    for k, v in words.items():
        ws[int(k[1:])] = v
    return "\n".join(" ".join(f"{x:04x}" for x in ws[i:i + 8]) for i in range(0, 256, 8)) + "\n"


def nvme_idc(oacs=0, fna=0, sanicap=0, nn=1):
    b = bytearray(4096)
    struct.pack_into("<H", b, 256, oacs)
    struct.pack_into("<I", b, 328, sanicap)
    struct.pack_into("<I", b, 516, nn)
    b[524] = fna
    return bytes(b)


class AtaDecode(unittest.TestCase):
    def test_frozen_security_and_sanitize(self):
        words = caps.parse_ata_identify_text(ata_text(w82=0x0002, w128=0b101001, w89=0x0002, w90=0x8010, w59=0b1011 << 12, w169=1))
        c = caps.ata_capabilities(words)
        self.assertEqual(c["ata_security"], {"supported": True, "enabled": False, "locked": False, "frozen": True,
                                             "enhanced_erase_supported": True, "normal_erase_minutes": 4, "enhanced_erase_minutes": 32})
        self.assertEqual(c["ata_sanitize_feature"], {"supported": True, "crypto_scramble": False, "overwrite": True, "block_erase": True})
        self.assertTrue(c["trim_supported"])

    def test_unreported_words_stay_unknown(self):
        c = caps.ata_capabilities(caps.parse_ata_identify_text(ata_text()))
        self.assertIsNone(c["ata_security"]["supported"])
        self.assertEqual(c["ata_sanitize_feature"], {"supported": False})

    def test_malformed_text_rejected(self):
        self.assertIsNone(caps.parse_ata_identify_text("0000 ffff"))


class NvmeDecode(unittest.TestCase):
    def test_format_crypto_and_sanitize(self):
        c = caps.nvme_capabilities(nvme_idc(oacs=0b1010, fna=0b100, sanicap=0b011, nn=1))
        self.assertEqual(c["nvme_format_nvm"], {"supported": True, "crypto_erase": True, "applies_to_all_namespaces": False, "erase_applies_to_all_namespaces": False})
        self.assertEqual(c["nvme_sanitize_feature"], {"crypto_erase": True, "block_erase": True, "overwrite": False, "supported": True})
        self.assertTrue(c["nvme_namespace_management"])

    def test_no_sanitize(self):
        c = caps.nvme_capabilities(nvme_idc(oacs=0))
        self.assertFalse(c["nvme_sanitize_feature"]["supported"])
        self.assertEqual(c["nvme_format_nvm"], {"supported": False})

    def test_only_identify_can_be_sent(self):
        # The module contains exactly one NVMe opcode constant and no generic command function.
        src = open(caps.__file__).read()
        self.assertEqual(caps.IDENTIFY_OPCODE, 0x06)
        self.assertEqual(caps.NVME_IOCTL_ADMIN_CMD, 0xC0484E41)
        self.assertEqual(len(re.findall(r"OPCODE\s*=", src)), 1)
        self.assertIn("os.O_RDONLY", src)
        self.assertNotIn("O_RDWR", src)
        self.assertNotIn("O_WRONLY", src)
        with self.assertRaises(ValueError):
            caps._identify_controller_ioctl("/dev/nvme0n1")


class DiscoveryIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = self.tmp.name
        build(self.root)
        sata = "/sys/devices/pci0000:00/0000:00:17.0/ata1"
        w(self.root, f"{sata}/link1/dev1.0/ata_device/dev1.0/id", ata_text(w82=2, w128=0b1001, w59=1 << 12 | 1 << 15))
        w(self.root, "/dev/nvme0.identify", nvme_idc(oacs=2, fna=4, sanicap=1))

    def tearDown(self):
        self.tmp.cleanup()

    def drives(self):
        p = discovery.discover(self.root, run=lambda a: "")
        return {d["transport"]: d for d in p["drives"]}, p.get("review_flags", [])

    def test_internal_drives_report_capabilities(self):
        d, flags = self.drives()
        self.assertEqual(d["nvme"]["capabilities"]["source"], "nvme_identify_controller")
        self.assertTrue(d["nvme"]["capabilities"]["nvme_format_nvm"]["crypto_erase"])
        self.assertEqual(d["sata"]["capabilities"]["source"], "ata_identify_sysfs")
        self.assertTrue(d["sata"]["capabilities"]["ata_security"]["frozen"])
        self.assertIn("ata_security_frozen", [f["code"] for f in flags])

    def test_boot_usb_gets_no_capabilities(self):
        d, _ = self.drives()
        self.assertNotIn("capabilities", d["usb"])

    def test_missing_identify_stays_unknown_and_flagged(self):
        os.remove(os.path.join(self.root, "dev/nvme0.identify"))
        d, flags = self.drives()
        self.assertEqual(d["nvme"]["capabilities"]["source"], "unavailable")
        self.assertIn("drive_capabilities_unknown", [f["code"] for f in flags])


if __name__ == "__main__":
    unittest.main()
