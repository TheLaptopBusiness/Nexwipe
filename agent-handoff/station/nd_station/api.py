"""NexWipe Agent API v1 client (read-only subset). Contract: docs/agent-api/CONTRACT.md."""
from __future__ import annotations

import datetime as dt
import json
import secrets
import urllib.error
import urllib.request
from typing import Optional

API = "/api/public/agent/v1"


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message

    @property
    def revoked_or_invalid(self) -> bool:
        return self.status == 401 and "nonce" not in self.message.lower() and "timestamp" not in self.message.lower()


class NetworkError(Exception):
    pass


class Api:
    def __init__(self, base: str, credential: Optional[str] = None, user_agent: str = "nd-station"):
        self.base = base.rstrip("/") + API
        self.credential = credential
        self.user_agent = user_agent

    def _call(self, method: str, path: str, body: Optional[dict] = None, auth: bool = True) -> dict:
        headers = {"content-type": "application/json", "user-agent": self.user_agent}
        if auth:
            if not self.credential:
                raise ApiError(401, "unauthorized", "Station is not enrolled")
            headers["authorization"] = f"Bearer {self.credential}"
            headers["x-nd-timestamp"] = dt.datetime.now(dt.timezone.utc).isoformat()
            headers["x-nd-nonce"] = secrets.token_hex(16)  # fresh for every attempt
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read() or b"{}").get("error", {})
            except json.JSONDecodeError:
                err = {}
            raise ApiError(e.code, err.get("code", "http_error"), err.get("message", f"HTTP {e.code}")) from None
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            raise NetworkError(str(getattr(e, "reason", e))) from None

    def health(self) -> dict:
        return self._call("GET", "/health", auth=False)

    def enroll(self, token: str, name: str, version: str, platform: str, hostname: str) -> dict:
        return self._call("POST", "/enroll", {"enrollment_token": token, "name": name, "agent_version": version,
                                              "platform": platform, "hostname": hostname}, auth=False)

    def heartbeat(self, version: str) -> dict:
        return self._call("POST", "/heartbeat", {"state": "idle", "agent_version": version})

    def inventory(self, payload: dict) -> dict:
        return self._call("POST", "/inventory", payload)

    def jobs(self) -> list:
        return self._call("GET", "/jobs").get("jobs", [])

    def reconcile(self) -> dict:
        return self._call("POST", "/reconcile", {"jobs": []})

    def rotate(self) -> dict:
        return self._call("POST", "/credentials/rotate", {})
