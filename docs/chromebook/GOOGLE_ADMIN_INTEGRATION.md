# Google Admin integration — design only (not built)

Status: **Not connected.** No OAuth client, no tokens, no simulated API results. The app shows "Not connected" everywhere this would appear.

## Purpose
Optional connection that a school or organization authorizes for **its own** Google Workspace, so NexWipe can read Chromebook inventory/status for devices that organization supplied — and later, request supported actions on them. NexWipe never removes another organization's management without that organization's authorization.

## Verify before implementing (do not assume)
The items below are the expected starting points and must be re-checked against current Google documentation before any code is written:
- Admin SDK Directory API, ChromeOS devices resource (list/get) — read-only scope expected to be `admin.directory.device.chromeos.readonly`.
- Device state changes (deprovision/disable) and remote commands (e.g. remote powerwash) — current endpoints, required scopes, admin privileges, licensing (Chrome Education/Enterprise Upgrade), and which device states they support.
- Whether commands complete asynchronously and how completion is reported; behaviour for offline devices.

## Requirements
- Organization-scoped OAuth connection (one per NexWipe organization + supplying client), least-privilege scopes, read-only first.
- Tokens stored server-side only (service-role table, never readable by browser roles); revocable from the app and by the school.
- Explicit device identification (serial + Google device ID) and administrator confirmation before any action.
- Every request and result written to `chromebook_events` as `integration_result` by trusted server code; audit logged.
- Asynchronous command tracking: *accepted* ≠ *completed*. Only a later status read showing the device deprovisioned may set `deprovision_confirmed_integration`.
- Clear offline/error handling; failures never change status.

## Phasing
1. Read-only inventory/status retrieval for eligible devices.
2. Supported actions, only after permissions and API behaviour are validated on a real test tenant.
