# NextDrive architecture

## Boundary

| Component | Responsibility | Status |
|---|---|---|
| **NextDrive Cloud** (this repo) | Accounts, organizations, roles, sites, clients, projects, batches, inventory, custody, audit, jobs, policies, evidence, reports, billing | Phase 1 built |
| **NextDrive Agent** (separate repo) | Boots on the laptop; identifies drives; detects capabilities; executes sanitization; collects evidence | Not built. Never simulated as real. |

A browser cannot erase a remote laptop's drive. No dashboard action performs a wipe.

## Stack

- TanStack Start (React 19, TypeScript, Tailwind v4), deployed to an edge worker.
- Lovable Cloud (managed Postgres, auth, storage, realtime).
- Browser reads/writes go straight to the database **under row-level security**. Privileged mutations (org creation, invitations, role changes, member removal) go through `SECURITY DEFINER` RPCs that re-check the caller's role.
- Agent API (Phase 2) will be TanStack server routes under `/api/public/agent/v1/*` with per-agent credentials; agents never hold service keys.

## Tenancy model

- `organizations` = NextDrive customer accounts. `clients` = that customer's downstream clients (schools, companies). They are separate concepts.
- Every tenant table carries `org_id` and a `UNIQUE (org_id, id)` key. Child tables reference parents with **composite FKs `(org_id, parent_id)`**, so a row can never point at another org's data even if `org_id` is forged.
- RLS checks membership through `has_org_role(org, roles[])`, `is_org_staff(org)`, `has_project_grant(project)`. The `org_id` sent by the browser is only a filter.

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
- Device client must match its project's client; batch must belong to the device's project.
- `is_demo` on devices is copied from the organization, never from input.
- An organization always keeps at least one active owner; nobody can change their own role.
- Audit and custody rows cannot be updated or deleted by app users. This is append-only at the application level, not a tamper-proof ledger.

## Planned schema (Phases 2–4)

| Table | Purpose |
|---|---|
| `agents`, `agent_credentials`, `enrollment_tokens` | Station enrollment, per-agent hashed credentials, revocation |
| `agent_releases` | Release metadata (platform admin) |
| `policies`, `policy_versions` | Immutable versioned processing policies |
| `jobs` | One row per **drive** erasure job; FK to policy_version, device, drive, association snapshot, agent |
| `job_authorizations` | Bound to agent + device + drive + policy version + expiry; single use |
| `job_events` | Monotonic `seq` per job, idempotency key unique, server-validated transitions |
| `evidence_objects` | Private storage object refs + sha256 |
| `verification_results`, `validation_decisions` | Separate outcomes from execution |
| `reports`, `report_supersessions`, `verification_tokens` | Issued records, corrections, opaque QR tokens |
| `plans`, `subscriptions`, `credit_ledger`, `credit_reservations`, `stripe_events` | Billing with idempotent, atomic ledger |

Job state machine: `draft → awaiting_authorization → queued → running → verifying → awaiting_validation → approved`, plus `failed`, `interrupted`, `unsupported`, `quarantined`, `cancelled` (only before execution). Missing heartbeat ⇒ `interrupted`/unknown, never success.

## Migrations

Applied migrations live in `drizzle/migrations/` (version-controlled). Database acceptance checks: `tests/db/phase1_acceptance.sql`.
