#!/usr/bin/env python3
"""
NextDrive reference station client — Milestone 1 (READ-ONLY).

Enrolls a station, discovers the laptop and its internal drives, uploads inventory,
sends heartbeats, reconciles, and polls for jobs. It NEVER executes, acknowledges or
reports erasure. Every external command it runs is on a fixed allow-list of read-only
invocations (see READ_ONLY_COMMANDS).

Requires: Python 3.9+, run as root on the booted laptop (dmidecode/nvme/smartctl need it).
Tools used if present: dmidecode, lsblk, udevadm, nvme (nvme-cli), smartctl (smartmontools), findmnt.

Usage:
  sudo ./nd_agent_readonly.py --base https://<app-domain> enroll --token ndenr_... --name "Bench 3"
  sudo ./nd_agent_readonly.py --base https://<app-domain> run
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "/api/public/agent/v1"
STATE_DIR = os.environ.get("ND_STATE_DIR", "/var/lib/nextdrive")
CRED_FILE = os.path.join(STATE_DIR, "credential")
AGENT_VERSION = "0.1.0-readonly-reference"
HEARTBEAT_S = 30

# The ONLY external commands this program may run: exact (tool, first argument) pairs, all read-only.
READ_ONLY_COMMANDS = {
    ("dmidecode", "-s"),
    ("lsblk", "-J"),
    ("udevadm", "info"),
    ("nvme", "id-ctrl"),
    ("nvme", "id-ns"),
    ("smartctl", "-i"),
    ("findmnt", "-n"),
}


def run_ro(argv: list[str]) -> str:
    """Run an allow-listed, read-only command and return stdout ('' if the tool is unavailable)."""
    if len(argv) < 2 or (argv[0], argv[1]) not in READ_ONLY_COMMANDS:
        raise RuntimeError(f"refusing command that is not on the read-only allow-list: {argv[:2]}")
    if shutil.which(argv[0]) is None:
        return ""
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=30, check=False).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


# ---------------- discovery ----------------
PLACEHOLDER_SERIALS = {"", "to be filled by o.e.m.", "default string", "system serial number", "0", "none", "not specified"}


def smbios(key: str) -> str | None:
    v = run_ro(["dmidecode", "-s", key]).strip()
    return None if v.lower() in PLACEHOLDER_SERIALS or set(v) <= {"0"} else v[:120]


def boot_medium_name() -> str | None:
    for target in ("/run/live/medium", "/run/initramfs/live", "/"):
        src = run_ro(["findmnt", "-n", "-o", "SOURCE", target]).strip()
        if src.startswith("/dev/"):
            base = os.path.basename(src)
            # partition -> parent disk (sdb1 -> sdb, nvme0n1p1 -> nvme0n1)
            for disk in os.listdir("/sys/block"):
                if base.startswith(disk):
                    return disk
    return None


def interface_for(dev: dict) -> str:
    tran = (dev.get("tran") or "").lower()
    if tran == "nvme":
        return "nvme_ssd"
    if tran == "sata":
        return "sata_hdd" if str(dev.get("rota")) in ("1", "True", "true") else "sata_ssd"
    return "unsupported_other"


def nvme_details(name: str) -> dict:
    out = run_ro(["nvme", "id-ctrl", f"/dev/{name}", "-o", "json"])
    try:
        c = json.loads(out) if out else {}
    except json.JSONDecodeError:
        c = {}
    caps = {}
    if c:
        caps = {"sanicap": c.get("sanicap"), "fna": c.get("fna"), "oacs": c.get("oacs"), "nn": c.get("nn")}
    return {
        "serial": (c.get("sn") or "").strip() or None,
        "model": (c.get("mn") or "").strip() or None,
        "firmware": (c.get("fr") or "").strip() or None,
        "capabilities": {k: v for k, v in caps.items() if v is not None},
    }


def sata_details(name: str) -> dict:
    out = run_ro(["smartctl", "-i", "-j", f"/dev/{name}"])
    try:
        s = json.loads(out) if out else {}
    except json.JSONDecodeError:
        s = {}
    wwn = s.get("wwn") or {}
    return {
        "serial": s.get("serial_number"),
        "model": s.get("model_name"),
        "firmware": s.get("firmware_version"),
        "wwn": f"{wwn.get('naa', '')}{wwn.get('oui', '')}{wwn.get('id', '')}" or None if wwn else None,
        "capabilities": {"ata_security": s.get("ata_security"), "rotation_rate": s.get("rotation_rate")},
    }


def discover() -> dict:
    boot = boot_medium_name()
    raw = run_ro(["lsblk", "-J", "-b", "-d", "-o", "NAME,TRAN,ROTA,RM,SIZE,MODEL,SERIAL,TYPE"])
    devices = (json.loads(raw).get("blockdevices") if raw else []) or []
    drives = []
    for d in devices:
        if d.get("type") != "disk" or d["name"].startswith(("loop", "ram", "zram", "dm-", "md", "sr")):
            continue
        iface = interface_for(d)
        info = nvme_details(d["name"]) if iface == "nvme_ssd" else sata_details(d["name"]) if iface.startswith("sata") else {}
        props = run_ro(["udevadm", "info", "--query=property", f"--name=/dev/{d['name']}"])
        by_path = next((l.split("=", 1)[1].split()[0] for l in props.splitlines() if l.startswith("ID_PATH=")), None)
        serial = (info.get("serial") or d.get("serial") or "").strip()
        if not serial:
            continue
        entry = {
            "serial": serial[:120],
            "model": (info.get("model") or d.get("model") or "").strip()[:120] or None,
            "interface": iface,
            "capacity_bytes": int(d.get("size") or 0) or None,
            "firmware": info.get("firmware"),
            "transport": d.get("tran"),
            "bus_path": by_path,
            "removable": str(d.get("rm")) in ("1", "True", "true"),
            "is_boot_medium": d["name"] == boot,
            "wwn": info.get("wwn"),
            "capabilities": info.get("capabilities") or {},
        }
        drives.append({k: v for k, v in entry.items() if v is not None})
    mem_kb = 0
    try:
        with open("/proc/meminfo") as f:
            mem_kb = int(next(l for l in f if l.startswith("MemTotal")).split()[1])
    except (OSError, StopIteration, ValueError):
        pass
    cpu = None
    try:
        with open("/proc/cpuinfo") as f:
            cpu = next((l.split(":", 1)[1].strip() for l in f if l.startswith("model name")), None)
    except OSError:
        pass
    system = {
        "manufacturer": smbios("system-manufacturer"),
        "model": smbios("system-product-name"),
        "serial": smbios("system-serial-number"),
        "sku": smbios("system-sku-number"),
        "bios_version": smbios("bios-version"),
        "cpu": cpu[:120] if cpu else None,
        "ram_bytes": mem_kb * 1024 or None,
        "boot_mode": "uefi" if os.path.isdir("/sys/firmware/efi") else "legacy",
    }
    boot_serial = next((d["serial"] for d in drives if d.get("is_boot_medium")), None)
    return {
        "system": {k: v for k, v in system.items() if v is not None},
        "station": {k: v for k, v in {"agent_version": AGENT_VERSION, "boot_medium_serial": boot_serial, "kernel": os.uname().release}.items() if v},
        "drives": drives[:16],
    }


# ---------------- API client ----------------
class Api:
    def __init__(self, base: str, cred: str | None = None):
        self.base = base.rstrip("/") + API
        self.cred = cred

    def call(self, method: str, path: str, body: dict | None = None, auth: bool = True) -> tuple[int, dict]:
        headers = {"content-type": "application/json", "user-agent": f"nd-agent/{AGENT_VERSION}"}
        if auth:
            headers["authorization"] = f"Bearer {self.cred}"
            headers["x-nd-timestamp"] = dt.datetime.now(dt.timezone.utc).isoformat()
            headers["x-nd-nonce"] = secrets.token_hex(16)  # new nonce for every attempt
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            except json.JSONDecodeError:
                return e.code, {}

    def with_retry(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        delay = 1
        while True:
            try:
                status, res = self.call(method, path, body)
            except (urllib.error.URLError, OSError) as e:
                log(f"network error on {path}: {e}; retrying in {delay}s")
                time.sleep(delay + secrets.randbelow(1000) / 1000)
                delay = min(delay * 2, 60)
                continue
            if status == 401:
                revoked()
            if status >= 500:
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            return status, res


def log(msg: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def revoked() -> None:
    log("Station credential rejected (revoked or invalid). Deleting local credential. Re-enroll to continue.")
    try:
        os.remove(CRED_FILE)
    except FileNotFoundError:
        pass
    sys.exit(3)


def save_credential(cred: str) -> None:
    # PRODUCTION: encrypt with a key bound to the boot medium (see CREDENTIALS_UPDATES_RECOVERY.md).
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    fd = os.open(CRED_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(cred)


def cmd_enroll(a: argparse.Namespace) -> None:
    api = Api(a.base)
    token = a.token or input("Enrollment token: ").strip()
    status, res = api.call("POST", "/enroll", {"enrollment_token": token, "name": a.name, "agent_version": AGENT_VERSION,
                                               "platform": f"x86_64 {os.uname().release}", "hostname": os.uname().nodename[:120]}, auth=False)
    if status != 201:
        sys.exit(f"Enrollment failed ({status}): {res.get('error', {}).get('message')}")
    save_credential(res["credential"])
    log(f"Enrolled as '{res.get('name')}' (credential {res['credential'][:14]}…). Run with 'run' next.")


def cmd_discover(_: argparse.Namespace) -> None:
    print(json.dumps(discover(), indent=2))


def cmd_run(a: argparse.Namespace) -> None:
    try:
        with open(CRED_FILE) as f:
            api = Api(a.base, f.read().strip())
    except FileNotFoundError:
        sys.exit("Not enrolled. Run 'enroll' first.")
    status, health = api.call("GET", "/health", auth=False)
    log(f"Server reachable ({status}), server time {health.get('server_time')}")
    status, rec = api.with_retry("POST", "/reconcile", {"jobs": []})
    log(f"Reconcile: {len(rec.get('jobs', []))} job(s) bound to this station")

    def send_inventory() -> None:
        inv = discover()
        if not inv["system"].get("serial"):
            log("No valid system serial from SMBIOS; inventory not sent. Refer laptop for manual assessment.")
            return
        st, res = api.with_retry("POST", "/inventory", inv)
        log(f"Inventory sent ({st}): laptop {inv['system'].get('serial')} with {len(inv['drives'])} drive(s); "
            f"matched device {res.get('asset_tag') or 'none (shown under Hardware reported by stations)'}")

    send_inventory()
    while True:
        st, hb = api.with_retry("POST", "/heartbeat", {"state": "idle", "agent_version": AGENT_VERSION})
        if hb.get("inventory_requested"):
            log("Server requested a fresh inventory report")
            send_inventory()
        st, jobs = api.with_retry("GET", "/jobs")
        for j in jobs.get("jobs", []):
            # Milestone 1: this build has NO erasure capability. Never ack.
            log(f"Job {j.get('job_number')} for drive {j.get('target', {}).get('drive_serial')} received — "
                "REFUSED: this is a read-only build. The job remains queued until it expires or is cancelled.")
        if a.once:
            return
        time.sleep(HEARTBEAT_S)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", required=False, default=os.environ.get("ND_BASE", ""), help="https://<app-domain>")
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("enroll")
    e.add_argument("--token")
    e.add_argument("--name", default=os.uname().nodename)
    sub.add_parser("discover", help="print the inventory payload without sending it")
    r = sub.add_parser("run")
    r.add_argument("--once", action="store_true", help="one heartbeat/jobs cycle, then exit (for testing)")
    a = p.parse_args()
    if a.cmd != "discover" and not a.base.startswith(("https://", "http://localhost")):
        sys.exit("--base must be an https:// URL")
    {"enroll": cmd_enroll, "discover": cmd_discover, "run": cmd_run}[a.cmd](a)


if __name__ == "__main__":
    main()
