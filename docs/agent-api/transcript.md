# Agent API contract transcript

Captured 2026-10-31T05:20:46.477Z against `http://localhost:8080/api/public/agent/v1` by `scripts/agent-contract-check.ts`. Credentials and tokens are redacted. Hardware is fake and labelled CONTRACT-TEST. No erasure was requested.

Result: **18/18 steps returned the expected status.**

## 1. Health (no auth) — as expected (200, expected 200)
```http
GET /health
content-type: application/json
```
```json
{
  "ok": true,
  "api_version": "1",
  "server_time": "2026-10-31T05:20:43.102Z"
}
```

## 2. Enroll with single-use token — as expected (201, expected 201)
```http
POST /enroll
content-type: application/json

{
  "enrollment_token": "<redacted>",
  "name": "CONTRACT-TEST station",
  "agent_version": "contract-check",
  "platform": "x86_64 test",
  "hostname": "contract-test"
}
```
```json
{
  "name": "CONTRACT-TEST station",
  "org_id": "52c0c2c7-fa32-4c0e-a6ab-aed17f445d32",
  "agent_id": "37b24e45-a8b7-45a6-97d5-a11a9d1e50e5",
  "credential": "ndagt_<redacted>",
  "is_simulated": false,
  "api_version": "1",
  "heartbeat_interval_seconds": 30
}
```

## 3. Enrollment token reuse is rejected — as expected (401, expected 401)
```http
POST /enroll
content-type: application/json

{
  "enrollment_token": "<redacted>",
  "name": "again"
}
```
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Enrollment token is invalid, already used, revoked or expired"
  }
}
```

## 4. Heartbeat — as expected (200, expected 200)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:43.476Z
x-nd-nonce: 36355631f1704863837cf56db9cd3933

{
  "state": "idle",
  "agent_version": "contract-check"
}
```
```json
{
  "queued_jobs": 0,
  "server_time": "2026-10-31T05:20:43.696834+00:00",
  "inventory_requested": false,
  "heartbeat_timeout_seconds": 180
}
```

## 5. Inventory discovery (read-only) — as expected (200, expected 200)
```http
POST /inventory
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:43.752Z
x-nd-nonce: c144441c58844440876696d7017f8c56

{
  "system": {
    "manufacturer": "Dell Inc.",
    "model": "CONTRACT-TEST Latitude",
    "serial": "CONTRACT-TEST-SYS-MVVYDC1R",
    "cpu": "Test CPU",
    "ram_bytes": 17179869184,
    "bios_version": "1.0.0",
    "boot_mode": "uefi",
    "secure_boot": true
  },
  "station": {
    "agent_version": "contract-check",
    "boot_medium_serial": "CONTRACT-TEST-USB-MVVYDC1R"
  },
  "drives": [
    {
      "serial": "CONTRACT-TEST-NVME-MVVYDC1R",
      "model": "Test NVMe 512GB",
      "interface": "nvme_ssd",
      "capacity_bytes": 512110190592,
      "firmware": "T1",
      "transport": "nvme",
      "bus_path": "pci-0000:02:00.0-nvme-1",
      "removable": false,
      "is_boot_medium": false
    },
    {
      "serial": "CONTRACT-TEST-USB-MVVYDC1R",
      "model": "Boot USB",
      "interface": "unsupported_other",
      "capacity_bytes": 32010928128,
      "transport": "usb",
      "removable": true,
      "is_boot_medium": true
    }
  ]
}
```
```json
{
  "drives": [
    {
      "serial": "CONTRACT-TEST-NVME-MVVYDC1R",
      "drive_id": null,
      "attached_to_device": false
    },
    {
      "serial": "CONTRACT-TEST-USB-MVVYDC1R",
      "drive_id": null,
      "attached_to_device": false
    }
  ],
  "asset_tag": null,
  "device_id": null,
  "discovery_id": "9c8e6e7a-c21c-40ec-a77c-a9b698b47bf7"
}
```

## 6. Authorized jobs (none expected) — as expected (200, expected 200)
```http
GET /jobs
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:44.051Z
x-nd-nonce: 97bc76ff06c04d3abafc31a93f43de6a
```
```json
{
  "jobs": []
}
```

## 7. Reconcile after restart — as expected (200, expected 200)
```http
POST /reconcile
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:44.346Z
x-nd-nonce: 4fda6c9618a6460fb53e985ddc12a133

{
  "jobs": []
}
```
```json
{
  "jobs": [],
  "server_time": "2026-10-31T05:20:44.594215+00:00"
}
```

## 8. Request with nonce N — as expected (200, expected 200)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:44.643Z
x-nd-nonce: 948c6cef21f74c3db937b346fc7bc2b3

{
  "state": "idle"
}
```
```json
{
  "queued_jobs": 0,
  "server_time": "2026-10-31T05:20:44.883827+00:00",
  "inventory_requested": false,
  "heartbeat_timeout_seconds": 180
}
```

## 9. Replay of nonce N is rejected — as expected (409, expected 409)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:44.935Z
x-nd-nonce: 948c6cef21f74c3db937b346fc7bc2b3

{
  "state": "idle"
}
```
```json
{
  "error": {
    "code": "replayed_request",
    "message": "Replayed request: this nonce was already used"
  }
}
```

## 10. Stale timestamp is rejected — as expected (401, expected 401)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:10:45.065Z
x-nd-nonce: 7b9b78af8efc4ec69cbf0d1de84ada43

{}
```
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Request timestamp is outside the allowed 5-minute window"
  }
}
```

## 11. Missing nonce is rejected — as expected (401, expected 401)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:45.221Z
x-nd-nonce: 

{}
```
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Missing X-ND-Nonce header"
  }
}
```

## 12. Unknown credential is rejected — as expected (401, expected 401)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:45.226Z
x-nd-nonce: ba8d216acfcf4e9f80794421d9ee0ca6

{}
```
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Agent credential is invalid or has been revoked"
  }
}
```

## 13. Malformed JSON is rejected — as expected (400, expected 400)
```http
POST /inventory
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:45.357Z
x-nd-nonce: cc20091cddad4122a39558b3172ca372

"<malformed>"
```
```json
{
  "error": {
    "code": "invalid_json",
    "message": "Body must be valid JSON"
  }
}
```

## 14. Schema violation is rejected — as expected (422, expected 422)
```http
POST /inventory
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:45.489Z
x-nd-nonce: f4d5f051f6964a47af908a91f4ea6102

{
  "system": {},
  "drives": "x"
}
```
```json
{
  "error": {
    "code": "validation_failed",
    "message": "Request body failed validation",
    "issues": [
      {
        "path": "system.serial",
        "message": "Required"
      },
      {
        "path": "drives",
        "message": "Expected array, received string"
      }
    ]
  }
}
```

## 15. Event for a job not bound to this station — as expected (404, expected 404)
```http
POST /jobs/f0c0558e-71bb-45b2-b1f9-a77a3584cd14/events
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:45.627Z
x-nd-nonce: 8a4b9aa9f8964139b7b13949a527e562

{
  "seq": 1,
  "idempotency_key": "evt-00000001",
  "type": "log",
  "message": "x"
}
```
```json
{
  "error": {
    "code": "not_found",
    "message": "Job not found for this agent"
  }
}
```

## 16. Heartbeat after revocation — as expected (401, expected 401)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:46.054Z
x-nd-nonce: b28fdd841ce349b584318a70e2640b92

{}
```
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Agent credential is invalid or has been revoked"
  }
}
```

## 17. Inventory after revocation — as expected (401, expected 401)
```http
POST /inventory
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:46.186Z
x-nd-nonce: 5dfeda9b68f64a0e8545c1a4d438c2e7

{
  "system": {
    "manufacturer": "Dell Inc.",
    "model": "CONTRACT-TEST Latitude",
    "serial": "CONTRACT-TEST-SYS-MVVYDC1R",
    "cpu": "Test CPU",
    "ram_bytes": 17179869184,
    "bios_version": "1.0.0",
    "boot_mode": "uefi",
    "secure_boot": true
  },
  "station": {
    "agent_version": "contract-check",
    "boot_medium_serial": "CONTRACT-TEST-USB-MVVYDC1R"
  },
  "drives": [
    {
      "serial": "CONTRACT-TEST-NVME-MVVYDC1R",
      "model": "Test NVMe 512GB",
      "interface": "nvme_ssd",
      "capacity_bytes": 512110190592,
      "firmware": "T1",
      "transport": "nvme",
      "bus_path": "pci-0000:02:00.0-nvme-1",
      "removable": false,
      "is_boot_medium": false
    },
    {
      "serial": "CONTRACT-TEST-USB-MVVYDC1R",
      "model": "Boot USB",
      "interface": "unsupported_other",
      "capacity_bytes": 32010928128,
      "transport": "usb",
      "removable": true,
      "is_boot_medium": true
    }
  ]
}
```
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Agent credential is invalid or has been revoked"
  }
}
```

## 18. Jobs after revocation — as expected (401, expected 401)
```http
GET /jobs
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T05:20:46.345Z
x-nd-nonce: 63b29bba6dde4b7b91b5617ff19b5874
```
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Agent credential is invalid or has been revoked"
  }
}
```
