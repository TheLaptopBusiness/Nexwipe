"""Full-screen local console for the read-only station (curses, works on the Linux text console)."""
from __future__ import annotations

import curses
import datetime as dt
import subprocess
import time

from . import VERSION
from .safety import check as allowed
from .station import Station


def _gb(n) -> str:
    return f"{n / 1e9:.0f} GB" if isinstance(n, (int, float)) and n else "?"


def _ago(t) -> str:
    if not t:
        return "never"
    s = int((dt.datetime.now(dt.timezone.utc) - t).total_seconds())
    local = t.astimezone().strftime("%H:%M:%S")
    return f"{local} ({s}s ago)" if s < 120 else f"{local} ({s // 60} min ago)"


def _prompt(scr, y: int, label: str, secret_tail: bool = False) -> str:
    scr.timeout(-1)  # block while the operator types (the main loop uses a 1 s refresh timeout)
    curses.noecho()
    curses.curs_set(1)
    scr.move(y, 0)
    scr.clrtoeol()
    scr.addstr(y, 0, label, curses.A_BOLD)
    scr.refresh()
    buf = ""
    while True:
        ch = scr.get_wch()
        if ch in ("\n", "\r", curses.KEY_ENTER):
            break
        if ch in ("\x1b",):
            buf = ""
            break
        if ch in (curses.KEY_BACKSPACE, "\x7f", "\b"):
            buf = buf[:-1]
        elif isinstance(ch, str) and ch.isprintable():
            buf += ch
        shown = (("*" * max(0, len(buf) - 4)) + buf[-4:]) if secret_tail else buf
        scr.move(y, len(label))
        scr.clrtoeol()
        scr.addnstr(y, len(label), shown[-(curses.COLS - len(label) - 2):], curses.COLS - len(label) - 1)
        scr.refresh()
    curses.curs_set(0)
    scr.timeout(1000)
    return buf.strip()


def draw(scr, st: Station) -> None:
    v = st.snapshot()
    scr.erase()
    h, w = scr.getmaxyx()
    put = lambda y, x, s, a=0: (scr.addnstr(y, x, s, max(0, w - x - 1), a) if 0 <= y < h - 1 else None)  # noqa: E731
    G, R, Y, B = curses.color_pair(1), curses.color_pair(2), curses.color_pair(3), curses.A_BOLD
    put(0, 0, f" NextDrive station · READ-ONLY TEST BUILD · no erasure capability · v{VERSION} ".ljust(w - 1), curses.A_REVERSE)
    y = 2
    put(y, 0, "Station   ", B); put(y, 10, (v.station_name or "NOT ENROLLED") + (f"   mode {v.mode}" if v.enrolled else ""), G if v.enrolled else Y); y += 1
    put(y, 0, "Server    ", B); put(y, 10, v.server or "not set (press S)"); y += 1
    net = v.net
    put(y, 0, "Network   ", B); put(y, 10, net.summary if net else "checking…", G if net and net.ok else R); y += 1
    put(y, 0, "Uploaded  ", B); put(y, 10, f"{_ago(v.last_upload_at)}  {v.last_upload_note}"); y += 1
    put(y, 0, "Heartbeat ", B); put(y, 10, _ago(v.last_heartbeat_at) + (f"   credential valid until {v.credential_expires_at[:10]}" if v.credential_expires_at else "")); y += 1
    if v.revoked:
        put(y, 0, "REVOKED: this station's credential was rejected and deleted. Press E to re-enroll.", R | B); y += 1
    y += 1
    sysd = v.discovery.get("system", {})
    put(y, 0, "LAPTOP", B); y += 1
    put(y, 2, f"{sysd.get('manufacturer', '?')}  {sysd.get('model', '?')}   S/N {sysd.get('serial', 'MISSING')}"); y += 1
    put(y, 2, f"CPU {sysd.get('cpu', '?')}   RAM {_gb(sysd.get('ram_bytes'))}   {sysd.get('boot_mode', '?').upper()}"
        + (f"  Secure Boot {'on' if sysd.get('secure_boot') else 'off'}" if 'secure_boot' in sysd else "")); y += 2
    put(y, 0, "DRIVES", B); y += 1
    for d in v.discovery.get("drives", []):
        tag = "EXCLUDED boot USB" if d.get("is_boot_medium") else "excluded removable" if d.get("removable") else "INTERNAL"
        attr = Y if d.get("is_boot_medium") or d.get("removable") else 0
        put(y, 2, f"{tag:<19} {d.get('interface', '?'):<17} {(d.get('model') or 'model ?')[:28]:<28} {_gb(d.get('capacity_bytes')):>7}  S/N {d.get('serial', 'MISSING')}  FW {d.get('firmware', '?')}", attr)
        y += 1
    flags = v.discovery.get("review_flags", [])
    if flags:
        y += 1
        put(y, 0, "NEEDS REVIEW", Y | B); y += 1
        for f in flags[:6]:
            put(y, 2, f"! {f['code'].replace('_', ' ')}" + (f": {f.get('target')}" if f.get("target") else "") + (f" ({f.get('detail')})" if f.get("detail") else ""), Y); y += 1
    y += 1
    if v.error:
        put(y, 0, v.error, R); y += 1
    elif v.message:
        put(y, 0, v.message); y += 1
    put(h - 1, 0, " [E] Enroll  [S] Server  [R] Re-scan & upload  [W] Wi-Fi  [L] Log  [P] Power off ".ljust(w - 1), curses.A_REVERSE)
    scr.refresh()


def main(scr, st: Station) -> None:
    curses.curs_set(0)
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(1, curses.COLOR_GREEN, -1)
    curses.init_pair(2, curses.COLOR_RED, -1)
    curses.init_pair(3, curses.COLOR_YELLOW, -1)
    scr.timeout(1000)
    st.start()
    while True:
        draw(scr, st)
        try:
            ch = scr.getkey()
        except curses.error:
            continue
        ch = ch.lower()
        h = scr.getmaxyx()[0]
        try:
            if ch == "s":
                url = _prompt(scr, h - 2, "Server address (https://…): ")
                if url:
                    st.set_server(url)
                    st.note(f"Server set to {st.cfg['server']}")
            elif ch == "e":
                if not st.cfg.get("server"):
                    st.set_server(_prompt(scr, h - 2, "Server address (https://…): "))
                token = _prompt(scr, h - 2, "Enrollment token (from Agents & stations, valid 1 h): ", secret_tail=True)
                if token:
                    name = _prompt(scr, h - 2, "Station name (e.g. Bench 3): ")
                    st.note("Enrolling…")
                    st.enroll(token, name)
            elif ch == "r":
                st.request_inventory()
                st.note("Re-scanned hardware; upload queued.")
            elif ch == "w":
                allowed(["nmtui", "connect"])
                curses.endwin()
                subprocess.run(["nmtui", "connect"], check=False)
                scr.refresh()
            elif ch == "l":
                scr.erase()
                lines = st.snapshot().log[-(h - 2):] or ["No events yet."]
                for i, line in enumerate(lines):
                    scr.addnstr(i, 0, line, scr.getmaxyx()[1] - 1)
                scr.addstr(h - 1, 0, "Press any key to return", curses.A_REVERSE)
                scr.timeout(-1); scr.getkey(); scr.timeout(1000)
            elif ch == "p":
                if _prompt(scr, h - 2, "Type YES to power off: ") == "YES":
                    subprocess.run(["systemctl", "poweroff"], check=False)
        except ValueError as e:
            st.note(str(e), error=True)
        except curses.error:
            pass
        time.sleep(0.05)


def run(st: Station) -> None:
    curses.wrapper(main, st)
