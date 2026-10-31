"""Network diagnostics with plain-language errors for the station screen."""
from __future__ import annotations

import datetime as dt
import json
import os
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

from .safety import run_read_only


@dataclass
class NetStatus:
    ok: bool
    summary: str                      # one line for the screen
    detail: list = field(default_factory=list)
    interfaces: list = field(default_factory=list)
    clock_offset_s: Optional[float] = None


def interfaces(sysroot: str = "/") -> list:
    out = []
    base = os.path.join(sysroot, "sys/class/net")
    try:
        names = sorted(os.listdir(base))
    except OSError:
        names = []
    addrs = {}
    try:
        for i in json.loads(run_read_only(["ip", "-j", "addr", "show"]) or "[]"):
            addrs[i.get("ifname")] = [a["local"] for a in i.get("addr_info", []) if a.get("family") == "inet"]
    except (json.JSONDecodeError, KeyError, TypeError):
        pass
    if not names:  # no sysfs net class (containers): fall back to what iproute2 reports
        names = sorted(k for k in addrs if k)
    for n in names:
        if n == "lo":
            continue
        def rd(f: str) -> str:
            try:
                with open(os.path.join(base, n, f)) as fh:
                    return fh.read().strip()
            except OSError:
                return ""
        out.append({
            "name": n,
            "kind": "wifi" if os.path.isdir(os.path.join(base, n, "wireless")) else "ethernet",
            "link": rd("carrier") == "1" or bool(addrs.get(n)),
            "state": rd("operstate"),
            "ipv4": addrs.get(n, []),
        })
    return out


def has_default_route() -> bool:
    try:
        with open("/proc/net/route") as f:
            return any(l.split()[1] == "00000000" for l in f.readlines()[1:] if len(l.split()) > 2)
    except OSError:
        return False


def check(base_url: str, sysroot: str = "/") -> NetStatus:
    ifs = interfaces(sysroot)
    u = urllib.parse.urlparse(base_url)
    host, port = u.hostname or "", u.port or (443 if u.scheme == "https" else 80)
    d = []
    if not ifs:
        return NetStatus(False, "No network adapter found. Connect a USB Ethernet adapter or check that Wi-Fi is enabled in BIOS.", d, ifs)
    if not any(i["ipv4"] for i in ifs):
        wired = [i for i in ifs if i["kind"] == "ethernet"]
        if wired and not any(i["link"] for i in wired) and not any(i["kind"] == "wifi" for i in ifs):
            return NetStatus(False, "Network cable not connected (no link on any Ethernet port).", d, ifs)
        if any(i["link"] for i in ifs):
            return NetStatus(False, "Connected to a network but no IP address was assigned (DHCP failed). Check the network or ask IT.", d, ifs)
        return NetStatus(False, "Not connected. Plug in Ethernet, or press W to join Wi-Fi.", d, ifs)
    if not has_default_route():
        return NetStatus(False, "Got an IP address but no route to the internet (no default gateway).", d, ifs)
    try:
        socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return NetStatus(False, f"Cannot look up {host} (DNS failed). The network may block DNS or need a sign-in page.", d, ifs)
    try:
        with socket.create_connection((host, port), timeout=6):
            pass
    except OSError as e:
        return NetStatus(False, f"Cannot reach {host}:{port} ({e.strerror or e}). A firewall or proxy may be blocking it.", d, ifs)
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(base_url.rstrip("/") + "/api/public/agent/v1/health", headers={"user-agent": "nd-station"})
        with urllib.request.urlopen(req, timeout=10, context=ctx if u.scheme == "https" else None) as r:
            body = json.loads(r.read() or b"{}")
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, ssl.SSLCertVerificationError):
            now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            return NetStatus(False, f"Secure connection check failed for {host}. The laptop clock may be wrong (it says {now}), or the network intercepts HTTPS.", d, ifs)
        if isinstance(e, urllib.error.HTTPError):
            return NetStatus(False, f"NextDrive server answered with an error ({e.code}). Check the server address.", d, ifs)
        return NetStatus(False, f"Could not reach the NextDrive service: {reason}", d, ifs)
    except (ValueError, OSError) as e:
        return NetStatus(False, f"Unexpected reply from the server ({e}). Check the server address.", d, ifs)
    offset = None
    try:
        server = dt.datetime.fromisoformat(str(body.get("server_time")).replace("Z", "+00:00"))
        offset = (dt.datetime.now(dt.timezone.utc) - server).total_seconds()
    except ValueError:
        pass
    if offset is not None and abs(offset) > 240:
        return NetStatus(False, f"Laptop clock is off by {int(offset)} seconds; requests would be rejected. Set the BIOS clock to the correct UTC time.", d, ifs, offset)
    ip = next((f"{i['name']} {i['ipv4'][0]}" for i in ifs if i["ipv4"]), "")
    return NetStatus(True, f"Connected ({ip})", d, ifs, offset)
