"""
Station state on the USB's small writable partition (PARTLABEL=ND-STATE, mounted at /var/lib/nextdrive).

The credential file is encrypted with a key derived from the boot medium's own serial and the state
partition's UUID, so a copied state file does not decrypt on a different stick. This is defence in
depth only: whoever holds the original stick holds the credential. See docs/agent-api/station-auth.md.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Optional

STATE_DIR = os.environ.get("ND_STATE_DIR", "/var/lib/nextdrive")


def _paths():
    return os.path.join(STATE_DIR, "credential.enc"), os.path.join(STATE_DIR, "station.json")


def _key(binding: str) -> bytes:
    return base64.urlsafe_b64encode(hashlib.sha256(b"nextdrive-station-credential-v1|" + binding.encode()).digest())


def binding_for(boot_serial: Optional[str]) -> str:
    uuid = ""
    for cand in ("/dev/disk/by-partlabel/ND-STATE",):
        try:
            real = os.path.realpath(cand)
            for n in os.listdir("/dev/disk/by-uuid"):
                if os.path.realpath(os.path.join("/dev/disk/by-uuid", n)) == real:
                    uuid = n
        except OSError:
            pass
    return f"{boot_serial or 'unknown-medium'}|{uuid or 'no-state-uuid'}"


def save_credential(cred: str, binding: str) -> str:
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    path, _ = _paths()
    try:
        from cryptography.fernet import Fernet  # python3-cryptography in the image
        blob, how = b"F1:" + Fernet(_key(binding)).encrypt(cred.encode()), "encrypted"
    except ImportError:
        blob, how = b"P1:" + cred.encode(), "UNENCRYPTED (python3-cryptography missing)"
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(blob)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return how


def load_credential(binding: str) -> Optional[str]:
    path, _ = _paths()
    try:
        with open(path, "rb") as f:
            blob = f.read()
    except FileNotFoundError:
        return None
    if blob.startswith(b"P1:"):
        return blob[3:].decode()
    if blob.startswith(b"F1:"):
        from cryptography.fernet import Fernet, InvalidToken
        try:
            return Fernet(_key(binding)).decrypt(blob[3:]).decode()
        except InvalidToken:
            return None  # state file copied to another stick, or medium changed
    return None


def forget_credential() -> None:
    path, meta = _paths()
    for p in (path, meta):
        try:
            os.remove(p)
        except FileNotFoundError:
            pass


def save_meta(meta: dict) -> None:
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    _, path = _paths()
    with open(path + ".tmp", "w") as f:
        json.dump(meta, f)
    os.replace(path + ".tmp", path)


def load_meta() -> dict:
    _, path = _paths()
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
