# Agent API contract transcript

Captured 2026-10-31T06:33:02.353Z against `http://localhost:8080/api/public/agent/v1` by `scripts/agent-contract-check.ts`. Credentials and tokens are redacted. Hardware is fake and labelled CONTRACT-TEST. No erasure was requested.

Result: **23/23 steps returned the expected status.**

## 1. Health (no auth) — as expected (200, expected 200)
```http
GET /health
content-type: application/json
```
```json
{
  "ok": true,
  "api_version": "1",
  "server_time": "2026-10-31T06:32:57.206Z"
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
  "agent_id": "49a4c26d-f026-4fe9-9d6a-cda322bfe58b",
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

## 4. Heartbeat (read-only station, credential expiry reported) — as expected (200, expected 200)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:32:57.576Z
x-nd-nonce: 1654a6550aa947929a66880db49264f8

{
  "state": "idle",
  "agent_version": "contract-check"
}
```
```json
{
  "queued_jobs": 0,
  "server_time": "2026-10-31T06:32:57.994328+00:00",
  "inventory_requested": false,
  "heartbeat_timeout_seconds": 180,
  "mode": "read_only",
  "credential_expires_at": "2027-01-29T06:32:57.375084+00:00",
  "rotate_recommended": false
}
```

## 5. Rotate credential — as expected (200, expected 200)
```http
POST /credentials/rotate
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:32:58.050Z
x-nd-nonce: 5f46a7de348545058e145ce5cedb2214

{}
```
```json
{
  "credential": "ndagt_<redacted>",
  "expires_at": "2027-01-29T06:32:58.292181+00:00",
  "previous_valid_until": "2026-10-31T06:42:58.292181+00:00"
}
```

## 6. New credential works — as expected (200, expected 200)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:32:58.351Z
x-nd-nonce: bdec6b53ae44405388644df931be64e4

{}
```
```json
{
  "queued_jobs": 0,
  "server_time": "2026-10-31T06:32:58.582808+00:00",
  "inventory_requested": false,
  "heartbeat_timeout_seconds": 180,
  "mode": "read_only",
  "credential_expires_at": "2027-01-29T06:32:58.292181+00:00",
  "rotate_recommended": false
}
```

## 7. Old credential still works during 10-minute grace — as expected (200, expected 200)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:32:58.637Z
x-nd-nonce: 4e4c51659cfb4b8e89219fc0bf3cf6cb

{}
```
```json
{
  "queued_jobs": 0,
  "server_time": "2026-10-31T06:32:58.873304+00:00",
  "inventory_requested": false,
  "heartbeat_timeout_seconds": 180,
  "mode": "read_only",
  "credential_expires_at": "2026-10-31T06:42:58.292181+00:00",
  "rotate_recommended": true
}
```

## 8. Old credential cannot rotate again — as expected (409, expected 409)
```http
POST /credentials/rotate
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:32:58.930Z
x-nd-nonce: 8427b24a39564b0cb9d100f95069b888

{}
```
```json
{
  "error": {
    "code": "conflict",
    "message": "This credential was already rotated; use the replacement"
  }
}
```

## 9. Inventory discovery (read-only) — as expected (200, expected 200)
```http
POST /inventory
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:32:59.327Z
x-nd-nonce: 6a376103942d42f285c6bcaeb2049eb0

{
  "review_flags": [
    {
      "code": "drive_model_missing",
      "target": "pci-0000:00:17.0-ata-2"
    }
  ],
  "system": {
    "manufacturer": "Dell Inc.",
    "model": "CONTRACT-TEST Latitude",
    "serial": "CONTRACT-TEST-SYS-MVW0Y8A9",
    "cpu": "Test CPU",
    "ram_bytes": 17179869184,
    "bios_version": "1.0.0",
    "boot_mode": "uefi",
    "secure_boot": true
  },
  "station": {
    "agent_version": "contract-check",
    "boot_medium_serial": "CONTRACT-TEST-USB-MVW0Y8A9",
    "mode": "read_only"
  },
  "drives": [
    {
      "serial": "CONTRACT-TEST-NVME-MVW0Y8A9",
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
      "serial": "CONTRACT-TEST-USB-MVW0Y8A9",
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
      "serial": "CONTRACT-TEST-NVME-MVW0Y8A9",
      "drive_id": null,
      "attached_to_device": false
    },
    {
      "serial": "CONTRACT-TEST-USB-MVW0Y8A9",
      "drive_id": null,
      "attached_to_device": false
    }
  ],
  "asset_tag": null,
  "device_id": null,
  "discovery_id": "b0f2b291-adf6-4715-a36c-da7826c2b669",
  "report_count": 1,
  "review_flags": [
    {
      "code": "drive_model_missing",
      "target": "pci-0000:00:17.0-ata-2"
    }
  ]
}
```

## 10. Repeat report updates the same record (no duplicate) — as expected (200, expected 200)
```http
POST /inventory
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:32:59.630Z
x-nd-nonce: d263bff72e4847f78b52a5a8770fc979

{
  "review_flags": [
    {
      "code": "drive_model_missing",
      "target": "pci-0000:00:17.0-ata-2"
    }
  ],
  "system": {
    "manufacturer": "Dell Inc.",
    "model": "CONTRACT-TEST Latitude",
    "serial": "CONTRACT-TEST-SYS-MVW0Y8A9",
    "cpu": "Test CPU",
    "ram_bytes": 17179869184,
    "bios_version": "1.0.0",
    "boot_mode": "uefi",
    "secure_boot": true
  },
  "station": {
    "agent_version": "contract-check",
    "boot_medium_serial": "CONTRACT-TEST-USB-MVW0Y8A9",
    "mode": "read_only"
  },
  "drives": [
    {
      "serial": "CONTRACT-TEST-NVME-MVW0Y8A9",
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
      "serial": "CONTRACT-TEST-USB-MVW0Y8A9",
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
      "serial": "CONTRACT-TEST-NVME-MVW0Y8A9",
      "drive_id": null,
      "attached_to_device": false
    },
    {
      "serial": "CONTRACT-TEST-USB-MVW0Y8A9",
      "drive_id": null,
      "attached_to_device": false
    }
  ],
  "asset_tag": null,
  "device_id": null,
  "discovery_id": "b0f2b291-adf6-4715-a36c-da7826c2b669",
  "report_count": 2,
  "review_flags": [
    {
      "code": "drive_model_missing",
      "target": "pci-0000:00:17.0-ata-2"
    }
  ]
}
```

## 11. Authorized jobs (none expected) — as expected (200, expected 200)
```http
GET /jobs
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:32:59.908Z
x-nd-nonce: 080a8c2417c74506b0a1b50eb80379f9
```
```json
{
  "jobs": []
}
```

## 12. Reconcile after restart — as expected (200, expected 200)
```http
POST /reconcile
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:00.168Z
x-nd-nonce: 1f5e80339de744359cfc7ca6864b3c33

{
  "jobs": []
}
```
```json
{
  "jobs": [],
  "server_time": "2026-10-31T06:33:00.385161+00:00"
}
```

## 13. Request with nonce N — as expected (200, expected 200)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:00.436Z
x-nd-nonce: 8145f3b2320b4b5b90b40a8f5ff68a62

{
  "state": "idle"
}
```
```json
{
  "queued_jobs": 0,
  "server_time": "2026-10-31T06:33:00.643683+00:00",
  "inventory_requested": false,
  "heartbeat_timeout_seconds": 180,
  "mode": "read_only",
  "credential_expires_at": "2027-01-29T06:32:58.292181+00:00",
  "rotate_recommended": false
}
```

## 14. Replay of nonce N is rejected — as expected (409, expected 409)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:00.697Z
x-nd-nonce: 8145f3b2320b4b5b90b40a8f5ff68a62

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

## 15. Stale timestamp is rejected — as expected (401, expected 401)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:23:00.835Z
x-nd-nonce: a4df53607960432fb68effcd71344805

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

## 16. Missing nonce is rejected — as expected (401, expected 401)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:00.976Z
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

## 17. Unknown credential is rejected — as expected (401, expected 401)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:00.978Z
x-nd-nonce: 71846a2b05584565866d9c712cbf8d84

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

## 18. Malformed JSON is rejected — as expected (400, expected 400)
```http
POST /inventory
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:01.103Z
x-nd-nonce: 163d366720a1441aae8b3e3b42f48d89

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

## 19. Schema violation is rejected — as expected (422, expected 422)
```http
POST /inventory
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:01.235Z
x-nd-nonce: c71b22c8d79e479cade1cda8c8b9e9b7

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
        "path": "drives",
        "message": "Expected array, received string"
      }
    ]
  }
}
```

## 20. Event for a job not bound to this station — as expected (404, expected 404)
```http
POST /jobs/c56f1c8b-b9f0-4ec4-af05-56ad3a93e387/events
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:01.399Z
x-nd-nonce: 83435ac4d7004d5e95d5a5d380e2f12b

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

## 21. Heartbeat after revocation — as expected (401, expected 401)
```http
POST /heartbeat
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:01.882Z
x-nd-nonce: a1cdfc3049f54227889f5152b33e4dbc

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

## 22. Inventory after revocation — as expected (401, expected 401)
```http
POST /inventory
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:02.057Z
x-nd-nonce: f112fe890e144fde854812368de40e50

{
  "review_flags": [
    {
      "code": "drive_model_missing",
      "target": "pci-0000:00:17.0-ata-2"
    }
  ],
  "system": {
    "manufacturer": "Dell Inc.",
    "model": "CONTRACT-TEST Latitude",
    "serial": "CONTRACT-TEST-SYS-MVW0Y8A9",
    "cpu": "Test CPU",
    "ram_bytes": 17179869184,
    "bios_version": "1.0.0",
    "boot_mode": "uefi",
    "secure_boot": true
  },
  "station": {
    "agent_version": "contract-check",
    "boot_medium_serial": "CONTRACT-TEST-USB-MVW0Y8A9",
    "mode": "read_only"
  },
  "drives": [
    {
      "serial": "CONTRACT-TEST-NVME-MVW0Y8A9",
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
      "serial": "CONTRACT-TEST-USB-MVW0Y8A9",
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

## 23. Jobs after revocation — as expected (401, expected 401)
```http
GET /jobs
content-type: application/json
authorization: Bearer ndagt_<redacted>
x-nd-timestamp: 2026-10-31T06:33:02.189Z
x-nd-nonce: a9ecae5c1b244e44ae3dad60e46ef057
```
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Agent credential is invalid or has been revoked"
  }
}
```
