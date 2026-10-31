"""Station controller: enrollment, discovery upload, heartbeat, rotation, revocation. No erasure."""
from __future__ import annotations

import datetime as dt
import json
import os
import threading
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

from . import VERSION, state
from .api import Api, ApiError, NetworkError
from .discovery import discover, upload_payload
from .netcheck import NetStatus, check

CONFIG_PATH = os.environ.get("ND_CONFIG", "/etc/nextdrive/station.json")
HEARTBEAT_S = 30


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def load_config() -> dict:
    cfg = {"server": "", "allow_http_hosts": [], "station_name": ""}
    try:
        with open(CONFIG_PATH) as f:
            cfg.update(json.load(f))
    except (OSError, json.JSONDecodeError):
        pass
    meta = state.load_meta()
    if meta.get("server"):
        cfg["server"] = meta["server"]
    return cfg


def validate_server(url: str, allow_http_hosts: list) -> str:
    u = urllib.parse.urlparse(url.strip())
    if u.scheme == "https" and u.hostname:
        return f"https://{u.netloc}"
    if u.scheme == "http" and u.hostname in (allow_http_hosts or []):
        return f"http://{u.netloc}"  # test labs only (e.g. a VM talking to a dev server)
    raise ValueError("Server address must start with https:// (for example https://nexwipe.example.com)")


@dataclass
class View:
    """Everything the screen shows. Copied under the lock for rendering."""

    server: str = ""
    enrolled: bool = False
    station_name: str = ""
    mode: str = "read_only"
    credential_expires_at: Optional[str] = None
    credential_storage: str = ""
    net: Optional[NetStatus] = None
    last_upload_at: Optional[dt.datetime] = None
    last_upload_note: str = ""
    last_heartbeat_at: Optional[dt.datetime] = None
    message: str = ""
    error: str = ""
    revoked: bool = False
    discovery: dict = field(default_factory=dict)
    refused_jobs: int = 0
    log: list = field(default_factory=list)


class Station:
    def __init__(self, sysroot: str = "/"):
        self.sysroot = sysroot
        self.cfg = load_config()
        self.lock = threading.Lock()
        self.v = View(server=self.cfg.get("server", ""))
        self.api: Optional[Api] = None
        self._want_inventory = True
        self._stop = threading.Event()
        self._binding = ""
        self.rescan()
        self._load()

    # ---------------- helpers
    def note(self, msg: str, error: bool = False) -> None:
        with self.lock:
            stamp = now().strftime("%H:%M:%S")
            self.v.log = (self.v.log + [f"{stamp} {msg}"])[-200:]
            if error:
                self.v.error = msg
            else:
                self.v.message = msg
        if not os.environ.get("ND_CONSOLE"):  # the console shows messages itself; printing would corrupt the screen
            print(f"[nd-station] {msg}", flush=True)

    def snapshot(self) -> View:
        with self.lock:
            return View(**{k: (list(v) if isinstance(v, list) else v) for k, v in self.v.__dict__.items()})

    def _load(self) -> None:
        boot_serial = self.v.discovery.get("station", {}).get("boot_medium_serial")
        self._binding = state.binding_for(boot_serial)
        cred = state.load_credential(self._binding)
        meta = state.load_meta()
        if cred and self.cfg.get("server"):
            self.api = Api(self.cfg["server"], cred, f"nd-station/{VERSION}")
            with self.lock:
                self.v.enrolled, self.v.station_name = True, meta.get("name", "")
        elif state.load_meta().get("name") and not cred:
            self.note("Saved credential could not be opened on this USB stick; re-enroll this station.", error=True)

    # ---------------- actions
    def rescan(self) -> None:
        payload = discover(self.sysroot, station={"agent_version": VERSION, "image_version": os.environ.get("ND_IMAGE_VERSION", "")})
        with self.lock:
            self.v.discovery = payload
        self._want_inventory = True

    def set_server(self, url: str) -> None:
        srv = validate_server(url, self.cfg.get("allow_http_hosts", []))
        self.cfg["server"] = srv
        meta = state.load_meta()
        meta["server"] = srv
        state.save_meta(meta)
        with self.lock:
            self.v.server = srv

    def enroll(self, token: str, name: str) -> None:
        token = token.strip()
        if not token.startswith("ndenr_"):
            raise ValueError("Enrollment tokens start with ndenr_. Create one in Agents & stations → Enrollment token.")
        if not self.cfg.get("server"):
            raise ValueError("Set the server address first.")
        api = Api(self.cfg["server"], None, f"nd-station/{VERSION}")
        sysinfo = self.v.discovery.get("system", {})
        try:
            res = api.enroll(token, name or sysinfo.get("serial", "station"), VERSION, f"x86_64 {os.uname().release}"[:80], os.uname().nodename[:120])
        except ApiError as e:
            raise ValueError(f"Enrollment refused: {e.message}. Tokens are single-use and expire; create a new one if needed.") from None
        except NetworkError as e:
            raise ValueError(f"Could not reach the server: {e}") from None
        how = state.save_credential(res["credential"], self._binding)
        state.save_meta({"server": self.cfg["server"], "name": res.get("name", name), "agent_id": res.get("agent_id")})
        self.api = Api(self.cfg["server"], res["credential"], f"nd-station/{VERSION}")
        with self.lock:
            self.v.enrolled, self.v.station_name, self.v.revoked = True, res.get("name", name), False
            self.v.credential_storage = how
            self.v.error = ""
        self._want_inventory = True
        self.wake()
        self.note(f"Enrolled as '{res.get('name', name)}'. Credential stored {how}.")

    def _revoked(self, e: ApiError) -> None:
        state.forget_credential()
        self.api = None
        with self.lock:
            self.v.enrolled, self.v.revoked = False, True
        self.note(f"Server rejected this station's credential ({e.message}). It was deleted locally. Re-enroll to continue.", error=True)

    def cycle(self) -> None:
        """One unit of work: network check, heartbeat, inventory when needed, job refusal, rotation."""
        srv = self.cfg.get("server", "")
        if not srv:
            with self.lock:
                self.v.net = NetStatus(False, "No server address set. Press S to enter it.")
            return
        net = check(srv)  # network state always comes from the real system
        with self.lock:
            self.v.net = net
        if not net.ok or not self.api:
            return
        try:
            hb = self.api.heartbeat(VERSION)
            with self.lock:
                self.v.last_heartbeat_at = now()
                self.v.mode = hb.get("mode", "read_only")
                self.v.credential_expires_at = hb.get("credential_expires_at")
                self.v.error = ""
            if hb.get("inventory_requested"):
                self.note("Server asked for a fresh hardware report.")
                self._want_inventory = True
            if hb.get("rotate_recommended"):
                rot = self.api.rotate()
                how = state.save_credential(rot["credential"], self._binding)
                self.api.credential = rot["credential"]
                self.note(f"Credential rotated (new one valid until {rot.get('expires_at')}, stored {how}).")
            if self._want_inventory:
                payload = upload_payload(self.snapshot().discovery)
                res = self.api.inventory(payload)
                self._want_inventory = False
                with self.lock:
                    self.v.last_upload_at = now()
                    self.v.last_upload_note = (f"matched {res['asset_tag']}" if res.get("asset_tag") else "awaiting Add to inventory") + (
                        f", report #{res.get('report_count')}" if res.get("report_count") else "")
                self.note(f"Hardware report uploaded ({self.v.last_upload_note}).")
            for j in self.api.jobs():
                with self.lock:
                    self.v.refused_jobs += 1
                self.note(f"Job {j.get('job_number')} received and REFUSED: this is a read-only build with no erasure capability.", error=True)
        except ApiError as e:
            if e.revoked_or_invalid:
                self._revoked(e)
            else:
                self.note(f"Server error: {e.message}", error=True)
        except NetworkError as e:
            self.note(f"Connection lost: {e}. Retrying.", error=True)

    def run_forever(self) -> None:
        if self.api:
            try:
                rec = self.api.reconcile()
                self.note(f"Reconciled with server: {len(rec.get('jobs', []))} job(s) bound to this station.")
            except (ApiError, NetworkError) as e:
                self.note(f"Reconcile deferred: {e}", error=True)
        while True:
            self.cycle()
            ev = self._stop
            ev.wait(HEARTBEAT_S if self.v.net and self.v.net.ok else 10)
            if getattr(self, "_shutdown", False):
                return

    def start(self) -> threading.Thread:
        t = threading.Thread(target=self.run_forever, daemon=True)
        t.start()
        return t

    def stop(self) -> None:
        self._shutdown = True
        self._stop.set()

    def wake(self) -> None:
        """Run the next cycle now instead of waiting for the heartbeat interval."""
        old, self._stop = self._stop, threading.Event()
        old.set()

    def request_inventory(self) -> None:
        self.rescan()
        self.wake()
