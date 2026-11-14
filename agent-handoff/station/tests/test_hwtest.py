"""Hardware-test logic on a fake sysfs tree (no hardware needed). Run: python3 -m unittest discover -s tests"""
import os
import re
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from nd_station import hwtest, safety  # noqa: E402

LAYOUT_TS = os.path.join(os.path.dirname(__file__), "../../../src/lib/keyboard-layout.ts")


def w(root, path, content=""):
    full = os.path.join(root, path.lstrip("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(content)


def bitmap(*bits):
    """Encode bit numbers the way sysfs does: 64-bit hex words, most significant first."""
    words = [0] * (max(bits) // 64 + 1)
    for b in bits:
        words[b // 64] |= 1 << (b % 64)
    return " ".join(f"{x:x}" for x in reversed(words))


def input_dev(root, n, name, ev, key=(), abs_=(), rel=(), props=(), bus="0011"):
    d = f"/sys/class/input/event{n}/device"
    w(root, f"{d}/name", name)
    w(root, f"{d}/id/bustype", bus)
    w(root, f"{d}/capabilities/ev", bitmap(*ev))
    w(root, f"{d}/capabilities/key", bitmap(*key) if key else "0")
    w(root, f"{d}/capabilities/abs", bitmap(*abs_) if abs_ else "0")
    w(root, f"{d}/capabilities/rel", bitmap(*rel) if rel else "0")
    w(root, f"{d}/properties", bitmap(*props) if props else "0")


class HwTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def test_key_ids_match_pc_scancodes(self):
        self.assertEqual(hwtest.key_id(30), "SC_1E")      # A
        self.assertEqual(hwtest.key_id(88), "SC_58")      # F12
        self.assertEqual(hwtest.key_id(97), "E0_1D")      # right Ctrl
        self.assertEqual(hwtest.key_id(105), "E0_4B")     # Left arrow
        self.assertEqual(hwtest.key_id(125), "E0_5B")     # Win
        self.assertEqual(hwtest.key_id(224), "LK_224")    # brightness down: extra key, not on the map

    def test_key_rows_match_web_keyboard_map(self):
        if not os.path.exists(LAYOUT_TS):
            self.skipTest("web app source not present")
        web = re.findall(r'id: "([A-Z0-9_]+)"', open(LAYOUT_TS).read())
        ours = [kid for row in hwtest.KEY_ROWS for _l, kid in row]
        self.assertEqual(ours, web)
        self.assertEqual(len(ours), len(set(ours)))

    def test_every_map_key_is_reachable_from_a_kernel_code(self):
        reachable = {hwtest.key_id(c) for c in range(1, 256)}
        missing = [kid for row in hwtest.KEY_ROWS for _l, kid in row if kid not in reachable]
        self.assertEqual(missing, [])

    def test_parse_events(self):
        buf = struct.pack("llHHi", 1, 2, 1, 30, 1) + struct.pack("llHHi", 1, 3, 0, 0, 0) + b"\x00" * 5
        self.assertEqual(hwtest.parse_events(buf), [(1, 30, 1), (0, 0, 0)])

    def test_input_classification(self):
        input_dev(self.root, 0, "Power Button", ev=(0, 1), key=(116,))
        input_dev(self.root, 3, "AT Translated Set 2 keyboard", ev=(0, 1, 4, 17), key=tuple(range(1, 128)))
        input_dev(self.root, 7, "ELAN Touchpad", ev=(0, 1, 3), key=(0x110, 0x14A), abs_=(0, 1, 53, 54), props=(0, 2), bus="0018")
        input_dev(self.root, 9, "Touchscreen", ev=(0, 1, 3), key=(0x14A,), abs_=(0, 1), props=(1,))
        input_dev(self.root, 12, "USB Mouse", ev=(0, 1, 2), key=(0x110, 0x111), rel=(0, 1), bus="0003")
        got = {d["name"]: (d["kind"], d["buttonpad"]) for d in hwtest.input_devices(self.root)}
        self.assertEqual(got, {"Power Button": ("keys", False), "AT Translated Set 2 keyboard": ("keyboard", False),
                               "ELAN Touchpad": ("touchpad", True), "Touchscreen": ("touchscreen", False),
                               "USB Mouse": ("mouse", False)})
        self.assertEqual([os.path.basename(d["node"]) for d in hwtest.input_devices(self.root)],
                         ["event0", "event3", "event7", "event9", "event12"])  # numeric order, not text order

    def test_battery_health_and_verdict(self):
        b = "/sys/class/power_supply/BAT0"
        w(self.root, f"{b}/type", "Battery")
        w(self.root, f"{b}/energy_full_design", "50000000")
        w(self.root, f"{b}/energy_full", "41000000")
        w(self.root, f"{b}/capacity", "77")
        w(self.root, f"{b}/cycle_count", "312")
        w(self.root, f"{b}/status", "Discharging")
        w(self.root, "/sys/class/power_supply/hidpp_battery_0/type", "Battery")
        w(self.root, "/sys/class/power_supply/hidpp_battery_0/scope", "Device")  # wireless mouse: ignored
        info = hwtest.battery_info(self.root)
        self.assertEqual((info["health_pct"], info["charge_pct"], info["cycles"]), (82, 77, 312))
        self.assertEqual(hwtest.battery_verdict(info)["outcome"], "pass")
        self.assertEqual(hwtest.battery_verdict(dict(info, health_pct=31))["outcome"], "fail")
        self.assertEqual(hwtest.battery_verdict(dict(info, health_pct=None))["outcome"], "incomplete")
        self.assertEqual(hwtest.battery_verdict(None)["outcome"], "fail")

    def test_charge_full_fallback(self):
        b = "/sys/class/power_supply/BAT1"
        w(self.root, f"{b}/type", "Battery")
        w(self.root, f"{b}/charge_full_design", "4000000")
        w(self.root, f"{b}/charge_full", "3000000")
        self.assertEqual(hwtest.battery_info(self.root)["health_pct"], 75)

    def test_charger_online(self):
        self.assertIsNone(hwtest.charger_online(self.root))
        w(self.root, "/sys/class/power_supply/AC/type", "Mains")
        w(self.root, "/sys/class/power_supply/AC/online", "0")
        w(self.root, "/sys/class/power_supply/ucsi-source-psy-1/type", "USB")
        w(self.root, "/sys/class/power_supply/ucsi-source-psy-1/online", "0")
        self.assertIs(hwtest.charger_online(self.root), False)
        w(self.root, "/sys/class/power_supply/ucsi-source-psy-1/online", "1")  # USB-C charger counts
        self.assertIs(hwtest.charger_online(self.root), True)

    def test_wifi(self):
        self.assertEqual(hwtest.wifi_verdict(self.root)["outcome"], "fail")
        os.makedirs(os.path.join(self.root, "sys/class/net/wlp2s0/phy80211"))
        w(self.root, "/sys/class/net/wlp2s0/operstate", "up")
        w(self.root, "/sys/class/net/enp1s0/operstate", "up")
        self.assertEqual(hwtest.wifi_verdict(self.root), {"outcome": "pass", "values": {"adapter": "wlp2s0", "connected": True}})

    def test_sound_devices_skip_hdmi_and_put_dmic_first(self):
        w(self.root, "/proc/asound/pcm", "\n".join([
            "00-00: HDA Analog (*) :  : playback 1 : capture 1",
            "00-03: HDMI 0 (*) :  : playback 1",
            "00-06: DMIC (*) :  : capture 1",
            "01-07: HDMI 1 : HDMI 1 : playback 1",
        ]))
        got = [(d["card"], d["dev"], d["playback"], d["capture"]) for d in hwtest.sound_devices(self.root)]
        self.assertEqual(got, [(0, 6, False, True), (0, 0, True, True)])

    def test_cameras_skip_metadata_and_ir_nodes(self):
        for n, name, idx in ((0, "Integrated Camera: Integrated C", "0"), (1, "Integrated Camera: Integrated C", "1"),
                             (2, "Integrated Camera: Integrated I", "0"), (10, "IR Camera", "0")):
            w(self.root, f"/sys/class/video4linux/video{n}/name", name)
            w(self.root, f"/sys/class/video4linux/video{n}/index", idx)
        self.assertEqual([c[0] for c in hwtest.cameras(self.root)], ["/dev/video0", "/dev/video2"])

    def test_signal_helpers(self):
        self.assertEqual(hwtest.luma_stdev(bytes([128, 128]) * 1000), 0.0)
        self.assertGreater(hwtest.luma_stdev(bytes(range(256)) * 100), hwtest.CAM_MIN_STDEV)
        self.assertEqual(hwtest.pcm_rms(b""), 0.0)
        self.assertAlmostEqual(hwtest.pcm_rms(struct.pack("<4h", 1000, -1000, 1000, -1000)), 1000.0)

    def test_overall_and_payload(self):
        kb = {"outcome": "pass", "keys_registered": [f"SC_{i:02X}" for i in range(1, 30)]}
        ok = {"keyboard": kb, "display": {"outcome": "pass"}, "webcam": {"outcome": "skipped", "note": "No webcam fitted"}}
        self.assertEqual(hwtest.overall(ok), "pass")
        self.assertEqual(hwtest.overall(dict(ok, speakers={"outcome": "fail"})), "fail")
        self.assertEqual(hwtest.overall(dict(ok, battery={"outcome": "incomplete"})), "incomplete")
        self.assertEqual(hwtest.overall(dict(ok, keyboard={"outcome": "skipped"})), "incomplete")  # no pass without a keyboard pass
        p = hwtest.build_payload(dict(ok, speakers={"outcome": "fail", "note": "No sound from the left speaker"}))
        self.assertEqual((p["test"], p["outcome"]), ("full", "fail"))
        self.assertEqual(p["detail"], "2 pass, 1 fail, 1 skipped (failed: Speakers)")
        self.assertIn("keyboard", p["result"]["tests"])

    def test_suite_marker_from_windows_runs_once_and_only_when_fresh(self):
        import datetime as dt
        now = dt.datetime(2026, 11, 14, 12, 0, tzinfo=dt.timezone.utc)
        self.assertIsNone(hwtest.suite_marker(self.root, [], now))                      # no file
        w(self.root, "/run/live/medium/nexwipe-run-tests.json", '{"id":"abc123","requested_at":"2026-11-14T06:30:00Z"}')
        self.assertEqual(hwtest.suite_marker(self.root, [], now), "abc123")            # local-time clock skew tolerated
        self.assertIsNone(hwtest.suite_marker(self.root, ["abc123"], now))              # already used: never twice
        self.assertIsNone(hwtest.suite_marker(self.root, [], now + dt.timedelta(days=2)))  # stale request ignored
        w(self.root, "/run/live/medium/nexwipe-run-tests.json", "not json")
        self.assertIsNone(hwtest.suite_marker(self.root, [], now))
        w(self.root, "/run/live/medium/nexwipe-run-tests.json", '{"id":"x","requested_at":"yesterday"}')
        self.assertIsNone(hwtest.suite_marker(self.root, [], now))

    def test_start_screen_lists_every_test_and_permission(self):
        self.assertEqual(len(hwtest.SUITE), len(hwtest.STEPS))
        perms = " ".join(hwtest.PERMISSIONS)
        for needed in ("Keyboard", "Camera", "Microphone", "Speakers", "Touchpad", "Charger"):
            self.assertIn(needed, perms)

    def test_safety_allows_only_exact_test_commands(self):
        ok = [
            ["v4l2-ctl", "-d", "/dev/video0", "--set-fmt-video=width=640,height=480,pixelformat=YUYV", "--get-fmt-video"],
            ["v4l2-ctl", "-d", "/dev/video0", "--set-fmt-video=width=640,height=480,pixelformat=YUYV", "--stream-mmap", "--stream-count=200", "--stream-to=-"],
            ["arecord", "-q", "-D", "plughw:0,6", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw", "-d", "8"],
            ["speaker-test", "-D", "plughw:0,0", "-c", "2", "-t", "sine", "-f", "440", "-s", "1"],
            ["amixer", "-q", "-c", "0", "sset", "Internal Mic", "80%", "cap"],
        ]
        for argv in ok:
            safety.check(argv)
        bad = [
            ["v4l2-ctl", "-d", "/dev/video0", "--set-fmt-video=width=640,height=480,pixelformat=YUYV", "--stream-mmap", "--stream-count=1", "--stream-to=/dev/sda"],
            ["arecord", "-q", "-D", "plughw:0,6", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw", "-d", "8", "/dev/nvme0n1"],
            ["amixer", "-c", "0", "cset", "numid=1", "0"],
            ["v4l2-ctl", "-d", "/dev/sda", "--get-fmt-video"],
        ]
        for argv in bad:
            with self.assertRaises(safety.Refused):
                safety.check(argv)


if __name__ == "__main__":
    unittest.main()
