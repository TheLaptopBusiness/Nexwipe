# NexWipe architecture

## Boundary

| Component | Responsibility | Status |
|---|---|---|
| **NexWipe Cloud** (this repo) | Accounts, organizations, roles, sites, clients, projects, batches, inventory, custody, audit, jobs, policies, evidence, reports, billing | Phases 1–2 built |
| **NexWipe Agent** (separate repo) | Boots on the laptop; identifies drives; detects capabilities; executes sanitization; collects evidence | Not built. Never simulated as real. |

A browser cannot erase a remote laptop's drive. No dashboard action performs a wipe.

## Stack

- TanStack Start (React 19, TypeScript, Tailwind v4), deployed to an edge worker.
- Lovable Cloud (managed Postgres, auth, storage, realtime).
- Browser reads/writes go straight to the database **under row-level security**. Privileged mutations (org creation, invitations, role changes, member removal) go through `SECURITY DEFINER` RPCs that re-check the caller's role.
- Agent API v1 is one TanStack server route `src/routes/api/public/agent/v1/$.ts` → `src/server/agent-api/handler.server.ts`, which validates input (Zod, `src/lib/agent-api/schemas.ts`) and calls service-role-only `agent_*` SQL functions. Agents hold per-agent hashed credentials, never service keys. Spec: `docs/agent-api/openapi.yaml`.
- The simulator (`src/simulator/*`, `src/lib/simulator.functions.ts`) drives the same handler in-process (no self-fetch) and uses the caller's session for technician steps.

## Tenancy model

- `organizations` = NexWipe customer accounts. `clients` = that customer's downstream clients (schools, companies). They are separate concepts.
- Every tenant table carries `org_id` and a `UNIQUE (org_id, id)` key. Child tables reference parents with **composite FKs `(org_id, parent_id)`**, so a row can never point at another org's data even if `org_id` is forged.
- RLS checks membership through `has_org_role(org, roles[])`, `is_org_staff(org)`, `has_project_grant(project)`. The `org_id` sent by the browser is only a filter.
- **MFA:** `has_org_role` only counts an owner/admin membership when the session JWT has `aal = aal2`. `is_org_member` (used only to read the organization row) does not, so the UI can show the two-step verification gate. Technicians, auditors and viewers are not affected.

## Roles

| Role | Can |
|---|---|
| owner | everything, incl. granting owner |
| admin | team (not owners), sites, clients, projects, settings, operations |
| technician | intake, devices, drives, batches, custody notes |
| auditor | read everything staff can read + audit log; no writes |
| customer_viewer | only projects explicitly granted via `client_access_grants`; no devices |

## Phase 1 schema (built)

`profiles`, `platform_admins`, `organizations`, `memberships`, `invitations` (hashed tokens, 7-day expiry, email-bound), `sites`, `clients`, `projects`, `client_access_grants`, `batches`, `devices`, `drives`, `device_drive_associations` (history kept; one active device per drive), `custody_events` (append-only, written by triggers), `audit_events` (append-only, written by triggers), `pilot_requests`, views `project_device_counts`, `batch_device_counts`.

Integrity rules enforced in the database:
- Browser users can never set `hardware_verified` or `source = agent_reported` (only trusted server code can).
- `hardware_origin` (devices, drives, agent_discoveries): `not_station_reported` | `station_reported` | `synthetic`. Classified server-side in `_classify_hardware` from the station's declared `hardware_source` plus VM/test-data heuristics; undeclared = synthetic. Synthetic is permanent, never verified, and blocks job creation. `station_reported` means an authenticated station reported it — not proof the hardware physically exists.
- Device client must match its project's client; batch must belong to the device's project.
- `is_demo` on devices is copied from the organization, never from input.
- An organization always keeps at least one active owner; nobody can change their own role.
- Audit and custody rows cannot be updated or deleted by app users. This is append-only at the application level, not a tamper-proof ledger.

## Phase 2 schema (built)

`policies`, `policy_versions` (immutable), `agents`, `agent_credentials`, `enrollment_tokens`, `agent_nonces`, `jobs` (one per drive; snapshot of target + policy version; generated `billable_unit`, `certificate_eligible`), `job_authorizations`, `job_events` (monotonic `seq`, unique idempotency key, append-only), `evidence_objects` (text content + sha256). State transitions are enforced in SQL; the browser has read-only table access and changes jobs only through RPCs (`create_job`, `submit_job`, `authorize_job`, `cancel_job`, `review_job`). Simulated rows are flagged `is_simulated` by server code only and isolated from real agents/policies.

## Phase 2b additions

- `agents.inventory_requested_at`; `create_device_from_discovery(discovery, asset_tag)` turns a station report into unverified inventory (skipping boot/removable media) and asks the station to re-report; only the station's re-report (service role) marks it verified.
- Invitation emails: server function `src/lib/invitations.functions.ts` creates the invitation as the caller, then sends an auth invite (new user) or sign-in link (existing user) whose redirect is the one-time invitation URL.
- Agent contract: `docs/agent-api/CONTRACT.md`; bootable agent handoff: `agent-handoff/`.

## Phase 2c additions

- `enrollment_tokens.read_only` / `agents.read_only` (default true for real stations, false for simulator); triggers block authorizations, job events and evidence for read-only stations.
- `agent_credentials.expires_at` (90 days), `replaced_by`; `agent_rotate_credential` with 10-minute grace; `/credentials/rotate` endpoint.
- `agent_discoveries`: one row per station + laptop (`report_count`, `last_reported_at`, `payload_sha256`), `review_flags`, `is_read_only_test`.
- `my_pending_invitations()` / `accept_invitation_by_id()` for email-bound acceptance without the link token.

## Chromebook track

- `devices.device_class` (`laptop` | `chromebook`). Chromebooks never get drive-erasure jobs (trigger on `jobs`), and a device with a Chromebook record stays a Chromebook.
- `chromebook_records` (one per device): board, architecture, storage, ChromeOS version, AUE (date + source + retrieval date), each with its value source; ownership authorization; `management_status` and `reset_status` (independent); online setup result; manual diagnostics; release decision; `is_synthetic` (inherited from the device, permanent, never resale-ready).
- `chromebook_events`: append-only history with `evidence_kind` (technician observation, administrator report, integration result, machine-generated). App users can only produce the first two.
- Changes only via `chromebook_*` RPCs; browser has SELECT only. Reset authorization and release need owner/admin (AAL2). Integration-confirmed deprovisioning and API-reported values are refused for app users.
- Google Admin integration: design only (`docs/chromebook/GOOGLE_ADMIN_INTEGRATION.md`); no tokens stored.

## Planned schema (Phases 3–4)

| Table | Purpose |
|---|---|
| `agent_releases` | Release metadata (platform admin) |
| binary evidence | Private storage objects for evidence beyond text |
| `verification_results`, `validation_decisions` | Separate outcomes from execution |
| `reports`, `report_supersessions`, `verification_tokens` | Issued records, corrections, opaque QR tokens |
| `plans`, `subscriptions`, `credit_ledger`, `credit_reservations`, `stripe_events` | Billing with idempotent, atomic ledger |

Job state machine: `draft → awaiting_authorization → queued → running → verifying → awaiting_validation → approved`, plus `failed`, `interrupted`, `unsupported`, `quarantined`, `cancelled` (only before execution). Missing heartbeat ⇒ `interrupted`/unknown, never success.

## Migrations

Applied migrations live in `drizzle/migrations/` (version-controlled). Database acceptance checks: `tests/db/phase1_acceptance.sql`, `tests/db/phase2_acceptance.sql`, `phase2b_security.sql`, `phase2c_readonly_stations.sql`, `phase2d_hardware_origin.sql`, `phase2e_chromebook.sql`, `phase2h_connected_devices.sql`, `phase2k_diagnostics.sql` (agent-run keyboard diagnostic).
