"""Full hardware test on the NexWipe stick, run from the station console (T, or "Run full test").

Reads the hardware straight through Linux, so it behaves the same on every laptop whatever state its
own Windows is in: keys and touchpad from kernel input events (/dev/input), battery and charger from
sysfs, camera through v4l2-ctl, microphone and speakers through ALSA. It never touches storage and the
result never changes a grade; it is a technician test record.

Pure helpers (parsing, verdicts, payload) are at the top and unit-tested in tests/test_hwtest.py; the
curses screens below them are checked on real laptops (PHYSICAL_TEST_CHECKLIST.md).
"""
from __future__ import annotations

import array
import curses
import fcntl
import glob
import math
import os
import re
import select
import struct
import time

from .safety import popen_read_only, run_read_only

# Calibration knobs: tune on real laptops, not in theory.
KEYBOARD_PASS_MIN_KEYS = 20  # same floor as the server (KEYBOARD_PASS_MIN_KEYS in schemas.ts)
FINISH_HOLD_S = 2.0          # hold Esc or Enter this long to finish the keyboard test
BATTERY_FAIL_BELOW_PCT = 50  # battery health (full / design) below this is reported as a fail
MIC_SOUND_RMS = 600          # 16-bit RMS that counts as "sound heard"...
MIC_OVER_FLOOR = 4.0         # ...and must also be this many times the room's noise floor
CAM_MIN_STDEV = 6.0          # luma spread of a real scene; a covered/dead sensor is near-uniform

# Same rows and ids as src/lib/keyboard-layout.ts (the web report's keyboard map). Ids are PC set-1
# scancodes (E0_ = extended) so left/right modifiers, arrows and numpad stay distinct.
KEY_ROWS = [
    [("Esc", "SC_01"), ("F1", "SC_3B"), ("F2", "SC_3C"), ("F3", "SC_3D"), ("F4", "SC_3E"), ("F5", "SC_3F"), ("F6", "SC_40"),
     ("F7", "SC_41"), ("F8", "SC_42"), ("F9", "SC_43"), ("F10", "SC_44"), ("F11", "SC_57"), ("F12", "SC_58")],
    [("`", "SC_29"), ("1", "SC_02"), ("2", "SC_03"), ("3", "SC_04"), ("4", "SC_05"), ("5", "SC_06"), ("6", "SC_07"), ("7", "SC_08"),
     ("8", "SC_09"), ("9", "SC_0A"), ("0", "SC_0B"), ("-", "SC_0C"), ("=", "SC_0D"), ("Back", "SC_0E")],
    [("Tab", "SC_0F"), ("Q", "SC_10"), ("W", "SC_11"), ("E", "SC_12"), ("R", "SC_13"), ("T", "SC_14"), ("Y", "SC_15"), ("U", "SC_16"),
     ("I", "SC_17"), ("O", "SC_18"), ("P", "SC_19"), ("[", "SC_1A"), ("]", "SC_1B"), ("\\", "SC_2B")],
    [("Caps", "SC_3A"), ("A", "SC_1E"), ("S", "SC_1F"), ("D", "SC_20"), ("F", "SC_21"), ("G", "SC_22"), ("H", "SC_23"), ("J", "SC_24"),
     ("K", "SC_25"), ("L", "SC_26"), (";", "SC_27"), ("'", "SC_28"), ("Enter", "SC_1C")],
    [("LShift", "SC_2A"), ("Z", "SC_2C"), ("X", "SC_2D"), ("C", "SC_2E"), ("V", "SC_2F"), ("B", "SC_30"), ("N", "SC_31"), ("M", "SC_32"),
     (",", "SC_33"), (".", "SC_34"), ("/", "SC_35"), ("RShift", "SC_36")],
    [("LCtrl", "SC_1D"), ("Win", "E0_5B"), ("LAlt", "SC_38"), ("Space", "SC_39"), ("RAlt", "E0_38"), ("Menu", "E0_5D"), ("RCtrl", "E0_1D")],
    [("Ins", "E0_52"), ("Del", "E0_53"), ("Home", "E0_47"), ("End", "E0_4F"), ("PgUp", "E0_49"), ("PgDn", "E0_51"), ("PrSc", "E0_37"),
     ("Left", "E0_4B"), ("Up", "E0_48"), ("Down", "E0_50"), ("Right", "E0_4D")],
    [("Num", "SC_45"), ("N/", "E0_35"), ("N*", "SC_37"), ("N-", "SC_4A"), ("N7", "SC_47"), ("N8", "SC_48"), ("N9", "SC_49"), ("N+", "SC_4E"),
     ("N4", "SC_4B"), ("N5", "SC_4C"), ("N6", "SC_4D"), ("N1", "SC_4F"), ("N2", "SC_50"), ("N3", "SC_51"), ("N0", "SC_52"), ("N.", "SC_53"),
     ("NEnt", "E0_1C")],
]

# Linux key codes 1..88 equal the set-1 scancode; the extended keys need this table.
_EXT = {96: "E0_1C", 97: "E0_1D", 98: "E0_35", 99: "E0_37", 100: "E0_38", 102: "E0_47", 103: "E0_48", 104: "E0_49",
        105: "E0_4B", 106: "E0_4D", 107: "E0_4F", 108: "E0_50", 109: "E0_51", 110: "E0_52", 111: "E0_53", 119: "E1_1D",
        125: "E0_5B", 126: "E0_5C", 127: "E0_5D"}

EV_KEY, EV_REL, EV_ABS = 1, 2, 3
KEY_ESC, KEY_ENTER = 1, 28
BTN_LEFT, BTN_RIGHT, BTN_TOUCH = 0x110, 0x111, 0x14A
PROP_DIRECT, PROP_BUTTONPAD = 1, 2
EVIOCGRAB = 0x40044590
EVIOCGABS = 0x80184540  # + axis
_EVENT = struct.Struct("llHHi")  # struct input_event on 64-bit Linux


def key_id(code: int) -> str:
    """Kernel key code -> report id. Keys with no PC scancode (media, Fn hotkeys) become LK_<code>."""
    if 1 <= code <= 88:
        return f"SC_{code:02X}"
    return _EXT.get(code, f"LK_{code}")


def parse_events(buf: bytes) -> list:
    """Raw /dev/input bytes -> [(type, code, value)]."""
    return [_EVENT.unpack_from(buf, o)[2:] for o in range(0, len(buf) - _EVENT.size + 1, _EVENT.size)]


def _read(path: str) -> str:
    try:
        with open(path, errors="replace") as f:
            return f.read().strip()
    except OSError:
        return ""


def _bits(text: str) -> set:
    """sysfs capability bitmap (hex words, most significant first, 64-bit each) -> set of bit numbers."""
    out = set()
    for i, word in enumerate(reversed(text.split())):
        v, b = int(word, 16), 0
        while v:
            if v & 1:
                out.add(i * 64 + b)
            v, b = v >> 1, b + 1
    return out


def input_devices(sysroot: str = "/") -> list:
    """Input devices Linux sees, classified: keyboard | keys (hotkeys/power) | touchpad | mouse | touchscreen."""
    out = []
    for d in sorted(glob.glob(os.path.join(sysroot, "sys/class/input/event*")), key=lambda p: int(re.sub(r"\D", "", os.path.basename(p)) or 0)):
        dev = os.path.join(d, "device")
        cap = lambda k: _bits(_read(os.path.join(dev, "capabilities", k)) or "0")  # noqa: E731
        ev, key, ab, rel = cap("ev"), cap("key"), cap("abs"), cap("rel")
        props = _bits(_read(os.path.join(dev, "properties")) or "0")
        if EV_ABS in ev and 0 in ab and PROP_DIRECT in props:
            kind = "touchscreen"
        elif EV_ABS in ev and 0 in ab and (BTN_TOUCH in key or BTN_LEFT in key):
            kind = "touchpad"
        elif EV_REL in ev and 0 in rel and BTN_LEFT in key:
            kind = "mouse"
        elif EV_KEY in ev and {30, 44, 57} <= key:  # A, Z, Space
            kind = "keyboard"
        elif EV_KEY in ev and key:
            kind = "keys"
        else:
            continue
        out.append({"node": os.path.join(sysroot, "dev/input", os.path.basename(d)), "name": _read(os.path.join(dev, "name")),
                    "kind": kind, "bus": _read(os.path.join(dev, "id/bustype")), "buttonpad": PROP_BUTTONPAD in props})
    return out


def battery_info(sysroot: str = "/"):
    """The laptop battery from sysfs, or None. Device batteries (wireless mice) are ignored."""
    for d in sorted(glob.glob(os.path.join(sysroot, "sys/class/power_supply/*"))):
        if _read(os.path.join(d, "type")) != "Battery" or _read(os.path.join(d, "scope")) == "Device":
            continue
        num = lambda k: int(v) if (v := _read(os.path.join(d, k))).isdigit() else None  # noqa: E731
        design = num("energy_full_design") or num("charge_full_design")
        full = num("energy_full") or num("charge_full")
        return {"health_pct": round(100 * full / design) if design and full else None, "charge_pct": num("capacity"),
                "cycles": num("cycle_count"), "status": _read(os.path.join(d, "status")) or None,
                "manufacturer": _read(os.path.join(d, "manufacturer")) or None, "model": _read(os.path.join(d, "model_name")) or None}
    return None


def battery_verdict(b) -> dict:
    if not b:
        return {"outcome": "fail", "note": "No battery detected"}
    h = b["health_pct"]
    if h is None:
        return {"outcome": "incomplete", "note": "The battery did not report its capacity", "values": b}
    if h < BATTERY_FAIL_BELOW_PCT:
        return {"outcome": "fail", "note": f"Battery health {h}% (below {BATTERY_FAIL_BELOW_PCT}%)", "values": b}
    return {"outcome": "pass", "values": b}


def charger_online(sysroot: str = "/"):
    """True/False if any mains or USB-C charger input is plugged in; None when the laptop reports none."""
    seen = None
    for d in glob.glob(os.path.join(sysroot, "sys/class/power_supply/*")):
        if _read(os.path.join(d, "type")) in ("Mains", "USB"):
            seen = bool(seen) or _read(os.path.join(d, "online")) == "1"
    return seen


def wifi_verdict(sysroot: str = "/") -> dict:
    ifs = sorted({os.path.basename(os.path.dirname(p)) for pat in ("*/wireless", "*/phy80211")
                  for p in glob.glob(os.path.join(sysroot, "sys/class/net", pat))})
    if not ifs:
        return {"outcome": "fail", "note": "No Wi-Fi adapter found by Linux"}
    up = [i for i in ifs if _read(os.path.join(sysroot, "sys/class/net", i, "operstate")) == "up"]
    return {"outcome": "pass", "values": {"adapter": ifs[0], "connected": bool(up)}}


def sound_devices(sysroot: str = "/") -> list:
    """ALSA PCM devices from /proc/asound/pcm, HDMI/DisplayPort outputs left out; microphones (DMIC) first."""
    out = []
    for line in _read(os.path.join(sysroot, "proc/asound/pcm")).splitlines():
        m = re.match(r"(\d+)-(\d+): (.*?) :", line)
        if not m or re.search(r"HDMI|DisplayPort|\bDP\b", m.group(3)):
            continue
        out.append({"card": int(m.group(1)), "dev": int(m.group(2)), "name": m.group(3).strip(),
                    "playback": "playback" in line, "capture": "capture" in line})
    return sorted(out, key=lambda d: "dmic" not in d["name"].lower())


def cameras(sysroot: str = "/") -> list:
    """[(/dev/videoN, name)] for real cameras: first node of each, IR (Windows Hello) sensors skipped."""
    out = []
    for d in sorted(glob.glob(os.path.join(sysroot, "sys/class/video4linux/video*")), key=lambda p: int(re.sub(r"\D", "", os.path.basename(p)) or 0)):
        name = _read(os.path.join(d, "name"))
        if (_read(os.path.join(d, "index")) or "0") != "0" or re.search(r"\bIR\b|infrared", name, re.I):
            continue
        out.append(("/dev/" + os.path.basename(d), name))
    return out


def luma_stdev(frame: bytes) -> float:
    """Spread of brightness in a YUYV frame (Y = every even byte), sampled."""
    y = frame[0::32]
    if not y:
        return 0.0
    mean = sum(y) / len(y)
    return math.sqrt(sum((v - mean) ** 2 for v in y) / len(y))


def pcm_rms(buf: bytes) -> float:
    a = array.array("h")
    a.frombytes(buf[: len(buf) // 2 * 2])
    return math.sqrt(sum(s * s for s in a) / len(a)) if a else 0.0


SUITE_MARKER = "run/live/medium/nexwipe-run-tests.json"  # written by the Windows helper before it restarts into the stick
SUITE_MARKER_MAX_AGE_H = 24  # Windows keeps the hardware clock in local time, so allow a wide window


def suite_marker(sysroot: str, used: list, now=None):
    """Id of a fresh, unused "run the test suite" request left on the stick by the Windows helper, else None."""
    import datetime as dt
    import json

    try:
        with open(os.path.join(sysroot, SUITE_MARKER)) as f:
            m = json.load(f)
        mid = str(m.get("id", ""))[:64]
        at = dt.datetime.strptime(str(m.get("requested_at", "")), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except (OSError, ValueError, AttributeError):
        return None
    now = now or dt.datetime.now(dt.timezone.utc)
    if not mid or mid in used or abs((now - at).total_seconds()) > SUITE_MARKER_MAX_AGE_H * 3600:
        return None
    return mid


def overall(tests: dict) -> str:
    """fail if any test failed; pass only with a passing keyboard and nothing incomplete; else incomplete."""
    vals = [t["outcome"] for t in tests.values()]
    if "fail" in vals:
        return "fail"
    if tests.get("keyboard", {}).get("outcome") == "pass" and "incomplete" not in vals:
        return "pass"
    return "incomplete"


def build_payload(tests: dict) -> dict:
    counts = {o: sum(1 for t in tests.values() if t["outcome"] == o) for o in ("pass", "fail", "skipped", "incomplete")}
    failed = [LABELS.get(k, k) for k, t in tests.items() if t["outcome"] == "fail"]
    detail = ", ".join(f"{n} {o}" for o, n in counts.items() if n) + (f" (failed: {', '.join(failed)})" if failed else "")
    return {"test": "full", "outcome": overall(tests), "result": {"layout": "ansi", "tests": tests}, "detail": detail[:300]}


LABELS = {"keyboard": "Keyboard", "display": "Display", "webcam": "Webcam", "microphone": "Microphone", "speakers": "Speakers",
          "touchpad": "Touchpad", "battery": "Battery", "charging": "Charging port", "wifi": "Wi-Fi", "ports": "USB ports",
          "hinges": "Hinges", "body": "Screen & case"}


# ============================================================== screens (curses, real hardware)
class UI:
    def __init__(self, scr):
        self.scr = scr
        curses.init_pair(20, curses.COLOR_BLACK, curses.COLOR_GREEN)
        curses.init_pair(21, curses.COLOR_GREEN, -1)
        curses.init_pair(22, curses.COLOR_RED, -1)
        curses.init_pair(23, curses.COLOR_YELLOW, -1)
        self.step, self.total = 0, 9

    def page(self, title: str, lines=(), start: int = 2) -> int:
        s = self.scr
        s.bkgd(" ", 0)
        s.erase()
        h, w = s.getmaxyx()
        s.addnstr(0, 0, f" NexWipe hardware test · step {self.step}/{self.total} · {title} ".ljust(w - 1), w - 1, curses.A_REVERSE)
        y = start
        for line in lines:
            if y < h - 1:
                s.addnstr(y, 0, line, w - 1)
            y += 1
        s.refresh()
        return y

    def put(self, y: int, x: int, text: str, attr=0) -> None:
        h, w = self.scr.getmaxyx()
        if 0 <= y < h - 1 and x < w - 1:
            self.scr.addnstr(y, x, text, w - 1 - x, attr)

    def key(self, timeout_ms: int = -1):
        self.scr.timeout(timeout_ms)
        try:
            return self.scr.getkey()
        except curses.error:
            return None

    def ask(self, y: int, question: str, default: str = "y", extra: str = "s", hint: str = "S = skip (not fitted)") -> str:
        """Single-key answer: y / n / one of `extra`; Enter takes the default."""
        opts = "[Y/n]" if default == "y" else "[y/N]"
        self.put(y, 0, f"{question} {opts}   {hint}", curses.A_BOLD)
        self.scr.refresh()
        curses.flushinp()
        while True:
            k = (self.key() or "").lower()
            if k in ("\n", "\r", "key_enter"):
                return default
            if k in ("y", "n") or (k and k in extra):
                return k

    def text(self, y: int, label: str) -> str:
        self.put(y, 0, label, curses.A_BOLD)
        curses.flushinp()  # keys typed before the question must not end up in the note
        curses.echo()
        curses.curs_set(1)
        try:
            v = self.scr.getstr(y, min(len(label), self.scr.getmaxyx()[1] - 2), 120).decode(errors="replace").strip()
        finally:
            curses.noecho()
            curses.curs_set(0)
        return v


def _open_inputs(devs: list, grab: bool) -> list:
    """[(fd, dev)] for the devices that could be opened."""
    fds = []
    for d in devs:
        try:
            fd = os.open(d["node"], os.O_RDONLY | os.O_NONBLOCK)
        except OSError:
            continue
        if grab:
            try:
                fcntl.ioctl(fd, EVIOCGRAB, 1)  # keys go only to the test: no console input, no Ctrl+Alt+Del, no VT switch
            except OSError:
                pass
        fds.append((fd, d))
    return fds


def _read_events(fds: list, wait: float) -> list:
    out = []
    for fd in select.select(fds, [], [], wait)[0] if fds else []:
        try:
            out += [(fd,) + e for e in parse_events(os.read(fd, _EVENT.size * 64))]
        except (BlockingIOError, OSError):
            pass
    return out


def _close(fds: list) -> None:
    for fd in fds:
        try:
            fcntl.ioctl(fd, EVIOCGRAB, 0)
        except OSError:
            pass
        os.close(fd)


def test_keyboard(ui: UI, sysroot: str) -> dict:
    devs = [d for d in input_devices(sysroot) if d["kind"] in ("keyboard", "keys")]
    names = [d["name"] for d in devs if d["kind"] == "keyboard"][:5]
    if not names:
        return {"outcome": "fail", "note": "Linux found no keyboard", "keys_registered": []}
    fds = [fd for fd, _d in _open_inputs(devs, grab=True)]
    if not fds:
        return {"outcome": "incomplete", "note": "Could not read the keyboard (station not running as root?)", "keys_registered": []}
    hit, extra, held = set(), set(), {}
    try:
        while True:
            y = ui.page("Keyboard", ["Press EVERY key. Each one turns GREEN. Keys this laptop does not have stay grey - that is fine.",
                                     "Also try Fn + F-keys (brightness, volume): they count as extra keys.",
                                     "When finished, HOLD Esc (or Enter) for 2 seconds."])
            y += 1
            for row in KEY_ROWS:
                x = 0
                for label, kid in row:
                    cell = f" {label} "
                    if x + len(cell) >= ui.scr.getmaxyx()[1] - 1:
                        y, x = y + 1, 0
                    ui.put(y, x, cell, curses.color_pair(20) | curses.A_BOLD if kid in hit else curses.A_DIM | curses.A_REVERSE)
                    x += len(cell) + 1
                y += 2
            ui.put(y, 0, f"Keys working: {len(hit)}    Extra keys (Fn / media): {len(extra)}", curses.A_BOLD)
            ui.scr.refresh()
            for _fd, typ, code, val in _read_events(fds, 0.1):
                if typ != EV_KEY or 0x100 <= code < 0x160:  # mouse/touch buttons are not keys
                    continue
                if val == 1:
                    kid = key_id(code)
                    (extra if kid.startswith("LK_") else hit).add(kid)
                    held[code] = time.monotonic()
                elif val == 0:
                    held.pop(code, None)
            if any(time.monotonic() - t >= FINISH_HOLD_S for c, t in held.items() if c in (KEY_ESC, KEY_ENTER)):
                break
    finally:
        _close(fds)
    res = {"keys_registered": sorted(hit), "extra_keys": sorted(extra), "values": {"keyboards": ", ".join(names)[:200]}}
    y = ui.page("Keyboard", [f"{len(hit)} keys registered, {len(extra)} extra (Fn / media) keys."])
    a = ui.ask(y + 1, "Did EVERY key on this laptop turn green?", extra="", hint="")
    if a == "n":
        res["note"] = ui.text(y + 3, "Type the keys that did NOT work (e.g. J, RShift, Space): ")[:500] or "Technician reported faulty keys"
        return {"outcome": "fail", **res}
    if len(hit) < KEYBOARD_PASS_MIN_KEYS:
        return {"outcome": "incomplete", "note": f"Only {len(hit)} keys registered (at least {KEYBOARD_PASS_MIN_KEYS} needed)", **res}
    return {"outcome": "pass", **res}


def test_display(ui: UI, sysroot: str) -> dict:
    ui.page("Display", ["The screen will fill with RED, GREEN, BLUE, WHITE and BLACK.",
                        "Look for dots that stay one colour, lines, dark patches, flicker or light bleeding at the edges.",
                        "Press any key to move to the next colour.", "", "Press any key to start."])
    ui.key()
    saved = None
    if curses.can_change_color():  # the text console's "white" is grey until we redefine it
        saved = curses.color_content(curses.COLOR_WHITE)
        curses.init_color(curses.COLOR_WHITE, 1000, 1000, 1000)
    try:
        for c in (curses.COLOR_RED, curses.COLOR_GREEN, curses.COLOR_BLUE, curses.COLOR_WHITE, curses.COLOR_BLACK):
            curses.init_pair(30, c, c)
            ui.scr.bkgd(" ", curses.color_pair(30))
            ui.scr.erase()
            ui.scr.refresh()
            ui.key()
    finally:
        ui.scr.bkgd(" ", 0)
        if saved:
            curses.init_color(curses.COLOR_WHITE, *saved)
    y = ui.page("Display")
    a = ui.ask(y, "Did you see dead/stuck pixels, lines, dark patches or flicker?", default="n", extra="r", hint="R = show again")
    if a == "r":
        return test_display(ui, sysroot)
    if a == "y":
        return {"outcome": "fail", "note": ui.text(y + 2, "Describe it (e.g. 'line at top', 'dead pixel centre'): ")[:500] or "Screen fault"}
    return {"outcome": "pass"}


def _not_found(ui: UI, what: str, question: str) -> dict:
    y = ui.page(what, [f"Linux did not find a {what.lower()} on this laptop."])
    if ui.ask(y + 1, question, extra="", hint="") == "y":
        return {"outcome": "fail", "note": f"{what} not detected"}
    return {"outcome": "skipped", "note": f"No {what.lower()} fitted"}


def test_webcam(ui: UI, sysroot: str) -> dict:
    cams = cameras(sysroot)
    if not cams:
        return _not_found(ui, "Webcam", "Does this laptop HAVE a webcam?")
    dev, name = cams[0]
    fmt_arg = "--set-fmt-video=width=640,height=480,pixelformat=YUYV"
    info = run_read_only(["v4l2-ctl", "-d", dev, fmt_arg, "--get-fmt-video"])
    m, pf = re.search(r"Width/Height\s*:\s*(\d+)\s*/\s*(\d+)", info), re.search(r"Pixel Format\s*:\s*'(\w+)", info)
    if not m or not pf or pf.group(1) != "YUYV":
        return {"outcome": "incomplete", "note": f"Camera '{name}' found but could not be read for a preview", "values": {"camera": name[:200]}}
    w, h = int(m.group(1)), int(m.group(2))
    p = popen_read_only(["v4l2-ctl", "-d", dev, fmt_arg, "--stream-mmap", "--stream-count=200", "--stream-to=-"])
    frames, best, buf, size = 0, 0.0, b"", w * h * 2
    chars = " .:-=+*#%@"
    try:
        end = time.monotonic() + 20
        while p and time.monotonic() < end:
            r = select.select([p.stdout], [], [], 0.2)[0]
            if r:
                chunk = os.read(p.stdout.fileno(), 1 << 16)
                if not chunk:
                    break
                buf += chunk
            if len(buf) >= size:
                n = len(buf) // size
                frame, buf = buf[(n - 1) * size:n * size], buf[n * size:]  # newest whole frame; keep the remainder aligned
                frames += 1
                best = max(best, luma_stdev(frame))
                y0 = ui.page("Webcam", [f"Camera: {name}", "Wave your hand in front of the camera. Press Enter when you have seen the preview."])
                rows, cols = max(8, ui.scr.getmaxyx()[0] - y0 - 3), min(100, ui.scr.getmaxyx()[1] - 2)
                for ry in range(rows):
                    line = "".join(chars[frame[2 * ((ry * h // rows) * w + (cx * w // cols))] * len(chars) // 256] for cx in range(cols))
                    ui.put(y0 + ry, 0, line)
                ui.scr.refresh()
            if ui.key(0) in ("\n", "\r", "KEY_ENTER"):
                break
    finally:
        if p:
            p.kill()
            p.wait()
    vals = {"camera": name[:200], "frames": frames, "picture_detail": round(best, 1)}
    if frames == 0:
        return {"outcome": "fail", "note": "Camera found but sent no picture", "values": vals}
    y = ui.page("Webcam", [f"{frames} frames received from {name}."])
    a = ui.ask(y + 1, "Did the preview show what was in front of the camera?", extra="", hint="")
    if a == "n":
        return {"outcome": "fail", "note": "Technician: preview did not show the scene", "values": vals}
    note = None if best >= CAM_MIN_STDEV else "Picture looked almost uniform (lens covered or sensor fault?)"
    return {"outcome": "pass", **({"note": note} if note else {}), "values": vals}


def _unmute(cards, controls, setting) -> None:
    for c in cards:
        for ctl in controls:
            run_read_only(["amixer", "-q", "-c", str(c), "sset", ctl, "80%", setting], timeout=5)


def test_microphone(ui: UI, sysroot: str) -> dict:
    mics = [d for d in sound_devices(sysroot) if d["capture"]]
    if not mics:
        return _not_found(ui, "Microphone", "Does this laptop HAVE a built-in microphone?")
    _unmute({d["card"] for d in mics}, ("Capture", "Mic", "Internal Mic"), "cap")
    while True:
        # Record from every capture device at once; whichever is the built-in mic will hear the sound.
        procs = [(d, popen_read_only(["arecord", "-q", "-D", f"plughw:{d['card']},{d['dev']}", "-f", "S16_LE", "-r", "16000",
                                      "-c", "1", "-t", "raw", "-d", "8"])) for d in mics]
        procs = [(d, p) for d, p in procs if p]
        floor, peak, heard_by, t0, bar = {}, 0.0, None, time.monotonic(), 0
        try:
            while procs and time.monotonic() - t0 < 9:
                for d, p in procs:
                    if select.select([p.stdout], [], [], 0.02)[0]:
                        chunk = os.read(p.stdout.fileno(), 1600)
                        if not chunk:
                            continue
                        lvl = pcm_rms(chunk)
                        k = (d["card"], d["dev"])
                        if time.monotonic() - t0 < 0.6:
                            floor[k] = max(floor.get(k, 0.0), lvl)
                        else:
                            peak = max(peak, lvl)
                            if lvl >= MIC_SOUND_RMS and lvl >= MIC_OVER_FLOOR * max(floor.get(k, 0.0), 50.0) and not heard_by:
                                heard_by = d["name"]
                        bar = int(min(1.0, lvl / (MIC_SOUND_RMS * 3)) * 60)
                y = ui.page("Microphone", ["SPEAK, CLAP or TAP near the laptop. The bar moves with sound.", ""])
                ui.put(y, 0, "[" + "#" * bar + " " * (60 - bar) + "]", curses.color_pair(21) if heard_by else 0)
                ui.put(y + 2, 0, f"Sound heard by: {heard_by}" if heard_by else "Listening...", curses.A_BOLD)
                ui.scr.refresh()
                if heard_by and time.monotonic() - t0 > 3:
                    break
                if ui.key(0) in ("\n", "\r", "KEY_ENTER"):
                    break
        finally:
            for _d, p in procs:
                p.kill()
                p.wait()
        vals = {"microphone": (heard_by or mics[0]["name"])[:200], "peak_level": round(peak)}
        if heard_by:
            return {"outcome": "pass", "values": vals}
        y = ui.page("Microphone", ["No sound was picked up by the microphone."])
        a = ui.ask(y + 1, "Try again?", extra="", hint="")
        if a == "n":
            return {"outcome": "fail", "note": "No sound picked up by the microphone", "values": vals}


def test_speakers(ui: UI, sysroot: str) -> dict:
    outs = [d for d in sound_devices(sysroot) if d["playback"]]
    if not outs:
        return {"outcome": "fail", "note": "Linux found no speaker output"}
    d = outs[0]
    _unmute({d["card"]}, ("Master", "Speaker", "PCM", "Headphone"), "unmute")
    failed = []
    for side, ch in (("LEFT", 1), ("RIGHT", 2)):
        while True:
            y = ui.page("Speakers", [f"Playing a tone on the {side} speaker...", "(Unplug headphones first.)"])
            run_read_only(["speaker-test", "-D", f"plughw:{d['card']},{d['dev']}", "-c", "2", "-t", "sine", "-f", "440", "-s", str(ch)], timeout=15)
            a = ui.ask(y + 1, f"Did you hear the tone from the {side} speaker?", extra="r", hint="R = play again")
            if a != "r":
                break
        if a == "n":
            failed.append(side.lower())
    vals = {"output": d["name"][:200]}
    if failed:
        return {"outcome": "fail", "note": f"No sound from the {' and '.join(failed)} speaker", "values": vals}
    return {"outcome": "pass", "values": vals}


def test_touchpad(ui: UI, sysroot: str) -> dict:
    devs = [d for d in input_devices(sysroot) if d["kind"] in ("touchpad", "mouse")]
    if not devs:
        return _not_found(ui, "Touchpad", "Does this laptop HAVE a touchpad?")
    opened = _open_inputs(devs, grab=False)
    fds = [fd for fd, _d in opened]
    info = {}
    for fd, d in opened:
        rng = []
        for axis in (0, 1):
            try:
                v = struct.unpack("6i", fcntl.ioctl(fd, EVIOCGABS + axis, bytes(24)))
                rng.append((v[1], v[2]))
            except OSError:
                rng.append(None)
        info[fd] = {"dev": d, "rng": rng, "pos": [0.5, 0.5]}
    corners, clicks, last = set(), set(), None
    try:
        while True:
            for fd, typ, code, val in _read_events(fds, 0.05):
                st = info[fd]
                if typ == EV_ABS and code in (0, 1) and st["rng"][code] and st["rng"][code][1] > st["rng"][code][0]:
                    lo, hi = st["rng"][code]
                    st["pos"][code] = (val - lo) / (hi - lo)
                elif typ == EV_REL and code in (0, 1):
                    st["pos"][code] = min(1.0, max(0.0, st["pos"][code] + val / 1000))
                elif typ == EV_KEY and val == 1 and code in (BTN_LEFT, BTN_RIGHT):
                    # Clickpads have no separate buttons: a press on the right half is the right click.
                    right = code == BTN_RIGHT or (st["dev"]["buttonpad"] and st["pos"][0] > 0.5)
                    clicks.add("right" if right else "left")
                else:
                    continue
                x, y = st["pos"]
                last = (x, y)
                if (x < 0.2 or x > 0.8) and (y < 0.2 or y > 0.8):
                    corners.add(("top" if y < 0.5 else "bottom") + "-" + ("left" if x < 0.5 else "right"))
            y0 = ui.page("Touchpad", ["Move your finger to ALL FOUR corners of the touchpad, then LEFT-click and RIGHT-click.",
                                      "F = touchpad faulty    S = no touchpad on this laptop"])
            bw, bh = 40, 10
            for r in range(bh + 2):
                ui.put(y0 + 1 + r, 0, ("+" + "-" * bw + "+") if r in (0, bh + 1) else ("|" + " " * bw + "|"))
            if last:
                ui.put(y0 + 2 + min(bh - 1, int(last[1] * bh)), 1 + min(bw - 1, int(last[0] * bw)), "@", curses.color_pair(21) | curses.A_BOLD)
            ok = lambda b: ("[x] " if b else "[ ] ")  # noqa: E731
            yy = y0 + bh + 4
            for c in ("top-left", "top-right", "bottom-left", "bottom-right"):
                ui.put(yy, 0, ok(c in corners) + c + " corner", curses.color_pair(21) if c in corners else 0); yy += 1
            for c in ("left", "right"):
                ui.put(yy, 0, ok(c in clicks) + c + " click", curses.color_pair(21) if c in clicks else 0); yy += 1
            ui.scr.refresh()
            if len(corners) == 4 and clicks == {"left", "right"}:
                time.sleep(0.6)
                return {"outcome": "pass", "values": {"device": info[fds[0]]["dev"]["name"][:200] if fds else ""}}
            k = (ui.key(0) or "").lower()
            if k == "f":
                missing = [c for c in ("top-left", "top-right", "bottom-left", "bottom-right") if c not in corners] + \
                          [c + " click" for c in ("left", "right") if c not in clicks]
                return {"outcome": "fail", "note": ("Not working: " + ", ".join(missing))[:500] if missing else "Technician reported a touchpad fault"}
            if k == "s":
                return {"outcome": "skipped", "note": "No touchpad fitted"}
    finally:
        _close(fds)


def test_battery(ui: UI, sysroot: str) -> dict:
    v = battery_verdict(battery_info(sysroot))
    b = v.get("values") or {}
    q = lambda k: "?" if b.get(k) is None else b[k]  # noqa: E731
    y = ui.page("Battery", [f"Health: {q('health_pct')}%   Charge: {q('charge_pct')}%   Cycles: {q('cycles')}   {b.get('status') or ''}",
                            f"Result: {v['outcome'].upper()}" + (f" - {v['note']}" if v.get("note") else ""), "", "Press any key to continue."])
    ui.key()
    return {k: x for k, x in v.items() if k != "values"} | ({"values": {k: x for k, x in b.items() if x is not None}} if b else {})


def test_charging(ui: UI, sysroot: str) -> dict:
    on = charger_online(sysroot)
    if on is None:
        y = ui.page("Charging port", ["This laptop does not report its charger to Linux. Check it by eye."])
        a = ui.ask(y + 1, "Plug the charger in: does the charging light come on?", extra="s", hint="S = skip (no charger here)")
        return {"outcome": {"y": "pass", "n": "fail", "s": "skipped"}[a], "note": "Checked by eye (charging light)"}
    for want in ([False, True] if on else [True]):
        end = time.monotonic() + 90
        while charger_online(sysroot) != want:
            ui.page("Charging port", ["UNPLUG the charger now." if not want else "PLUG the charger in now.",
                                      "", "S = skip (no charger here)    F = port does not work"])
            k = (ui.key(500) or "").lower()
            if k == "s":
                return {"outcome": "skipped", "note": "No charger available at the bench"}
            if k == "f" or time.monotonic() > end:
                return {"outcome": "fail", "note": "Charger plug-in was not detected"}
    b = battery_info(sysroot) or {}
    return {"outcome": "pass", "values": {"battery_status": b.get("status") or "unknown"}}


def test_wifi(ui: UI, sysroot: str) -> dict:
    v = wifi_verdict(sysroot)
    vals = v.get("values", {})
    ui.page("Wi-Fi", [f"Adapter: {vals.get('adapter', 'none')}   Connected: {'yes' if vals.get('connected') else 'no'}",
                      f"Result: {v['outcome'].upper()}" + (f" - {v['note']}" if v.get("note") else ""), "", "Press any key to continue."])
    ui.key()
    return v


CHECKLIST = [
    ("ports", "Plug a USB stick or mouse into EACH USB port. Do all ports work?"),
    ("hinges", "Are the hinges firm, and does the lid stay open at any angle?"),
    ("body", "Are the screen and case free of cracks, missing keys and broken parts?"),
]


def test_checklist(ui: UI, sysroot: str) -> dict:
    out = {}
    for key, q in CHECKLIST:
        y = ui.page("Physical checks", [LABELS[key]])
        a = ui.ask(y + 1, q)
        if a == "n":
            out[key] = {"outcome": "fail", "note": ui.text(y + 3, "What is wrong? ")[:500] or f"{LABELS[key]} fault"}
        else:
            out[key] = {"outcome": "pass" if a == "y" else "skipped"}
    return out


# What the start screen lists before anything runs (order = run order).
SUITE = [
    ("Keyboard", "press every key; each lights on the screen", "keyboard"),
    ("Display", "full-screen colours to spot dead pixels and lines", None),
    ("Webcam", "live preview from the camera", "camera"),
    ("Microphone", "listens for your voice or a clap", "microphone"),
    ("Speakers", "plays a tone left, then right", "speakers"),
    ("Touchpad", "four corners, left and right click", "touchpad"),
    ("Battery", "reads health, charge and cycle count", None),
    ("Charging port", "detects the charger being plugged in", None),
    ("Wi-Fi", "checks the wireless adapter", None),
    ("Physical checks", "USB ports, hinges, screen and case (your answers)", None),
]
PERMISSIONS = [
    "Keyboard: captured only by this test while it runs (keys do nothing else; Ctrl+Alt+Del is blocked)",
    "Camera: turned on during the webcam test only; no picture is saved or sent",
    "Microphone: listens during the microphone test only; no sound is saved or sent",
    "Speakers: sound is played (volume set to 80%)",
    "Touchpad: movement and clicks read during the touchpad test",
    "Charger: you will be asked to unplug and plug it back in",
]

STEPS = [("keyboard", test_keyboard), ("display", test_display), ("webcam", test_webcam), ("microphone", test_microphone),
         ("speakers", test_speakers), ("touchpad", test_touchpad), ("battery", test_battery), ("charging", test_charging),
         ("wifi", test_wifi), (None, test_checklist)]


def run(scr, sysroot: str = "/", can_send: bool = True, confirmed: bool = False):
    """Run every test in order on the console; returns the result payload to send, or None (not sent).
    confirmed: the person already said Yes in Windows before the restart, so only a cancel window is shown."""
    ui = UI(scr)
    curses.curs_set(0)
    ui.total = len(STEPS)
    y = ui.page("Start", ["NexWipe wants to run the complete test suite on this laptop.", "", "TESTS THAT WILL RUN:"]
                + [f"  {i:>2}. {name:<15} {what}" for i, (name, what, _perm) in enumerate(SUITE, 1)]
                + ["", "PERMISSIONS REQUIRED:"] + [f"  - {p}" for p in PERMISSIONS]
                + ["", "Nothing is written to the drives. The result is sent to NexWipe only if you confirm at the end."])
    if confirmed:
        for left in range(10, 0, -1):
            ui.put(y + 1, 0, f"You confirmed this test in Windows. Starting in {left:>2} s ... press N to cancel, Enter to start now.", curses.A_BOLD)
            ui.scr.refresh()
            k = (ui.key(1000) or "").lower()
            if k == "n":
                scr.timeout(1000)
                return None
            if k in ("\n", "\r", "key_enter"):
                break
    elif ui.ask(y + 1, "Do you want to initiate the test?", extra="", hint="") != "y":
        scr.timeout(1000)
        return None
    tests = {}
    for i, (key, fn) in enumerate(STEPS, 1):
        ui.step = i
        try:
            res = fn(ui, sysroot)
        except Exception as e:  # one broken test must never take the station console down
            res = {"outcome": "incomplete", "note": f"Test error: {e}"[:500]}
        tests.update(res if key is None else {key: res})
    payload = build_payload(tests)
    ui.step = ui.total
    y = ui.page("Summary", [f"OVERALL: {payload['outcome'].upper()}   ({payload['detail']})", ""])
    for k, t in tests.items():
        attr = {"pass": curses.color_pair(21), "fail": curses.color_pair(22)}.get(t["outcome"], curses.color_pair(23))
        ui.put(y, 0, f"{LABELS.get(k, k):<15} {t['outcome'].upper():<11} {t.get('note', '')}", attr)
        y += 1
    if can_send:
        send = ui.ask(y + 1, "Send this result to NexWipe?", extra="", hint="") == "y"
    else:
        ui.put(y + 1, 0, "This station is not enrolled, so the result is shown here only. Press any key.", curses.A_BOLD)
        ui.key()
        send = False
    scr.timeout(1000)
    scr.erase()
    return payload if send else None
