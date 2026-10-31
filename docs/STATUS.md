# NextDrive — status

_Last updated: Phase 2b (preparation for the first real bootable-agent integration)._

**NextDrive cannot erase a real drive today.** No production agent exists, and no erasure method has been implemented or tested on hardware. Everything below that touches jobs or evidence has only been exercised with the labelled simulator.

## 1. Implemented and tested

| Area | How it was tested |
|---|---|
| Organizations, roles, invitations, team management, sites, clients, projects, batches, inventory, drives, custody, audit (Phase 1) | `tests/db/phase1_acceptance.sql` (14/14 PASS, re-run under the MFA rule), browser flows |
| **Two-step verification required for owners/administrators, enforced in the database** — owner/admin permissions only count in a two-step verified (AAL2) session; a blocking screen asks them to set up or enter a code | `tests/db/phase2b_security.sql` (MFA checks), browser: unverified owner sees the gate, verified owner gets full access |
| **Invitation emails** — sent automatically; new users get an "invited" email, existing users a sign-in link that opens the invitation; link still shown once as a fallback | browser: invitation sent and received in a test mailbox |
| Versioned policies, per-drive job state machine, authorizations, reviewer approval, laptop clearance (Phase 2) | `tests/db/phase2_acceptance.sql` (37/37 PASS under the MFA rule), simulator |
| Tenant isolation across station endpoints, jobs, evidence, discoveries, enrollment tokens and credentials | `tests/db/phase2b_security.sql` (33/33 PASS) |
| Station credential revocation, nonce replay prevention, stale timestamps, duplicate submissions (events + evidence), idempotency-key misuse | `phase2b_security.sql` + `scripts/agent-contract-check.ts` (18/18 HTTP checks; transcript `docs/agent-api/transcript.md`) |
| Read-only discovery intake: station reports → "Hardware reported by stations" → Add to inventory → station re-reports → laptop and drives marked station-verified; station boot USB never recorded | `phase2b_security.sql`, browser, and the read-only reference client run against the app with test hardware data |
| Agent simulator (9 scenarios) | browser run, all PASS |
| Unit tests (roles, CSV, jobs, discovery display) | `bunx vitest run` (28 PASS) |
| Reference client refuses destructive commands | `agent-handoff/reference/test_readonly.py` |

## 2. Implemented but unverified

- Invitation email for an **existing** account (sign-in link path): code path present, not exercised.
- Invited new users setting a first password ("I joined from an invitation email" option): not exercised end-to-end; if the sign-in service requires the current password, they must use "Forgot password".
- Invitation links on a **custom domain** require `APP_ALLOWED_ORIGINS` to list it.
- Agent API behaviour on the published site (all HTTP checks ran against the preview server).
- The reference client's hardware discovery on a real laptop (only tested with replayed test hardware data in this environment, which has no laptop hardware).

## 3. Simulated

- Agent simulator jobs, laptops (`SIM-…`), drives, stations and evidence. Always labelled SIMULATED; can never be billable, certificate-eligible, run on a real station, or be added to real inventory.

## 4. Not built

- Phase 3: realtime updates (polling now), binary evidence storage, PDF records, QR verification, signing.
- Phase 4: billing, credit ledger, platform admin.
- Signed station requests / mTLS, credential rotation endpoint, station image attestation (see `docs/agent-api/station-auth.md`).
- Branded invitation emails from your own domain (currently the default sign-in email sender and wording).
- Logo upload, retention enforcement, legal holds, account deletion.

## 5. External development required

- **The NextDrive bootable agent** (image, discovery, capability detection, local confirmation, privileged engine, evidence, credential storage, signed updates, recovery). Handoff: `agent-handoff/`. Milestone 1 is read-only; destructive testing only on designated disposable drives (Stage 2).
- Per-model hardware qualification and method-support evidence (`agent-handoff/MILESTONES.md`).
- Independent third-party assessment of the erasure engine.
- An email sender domain owned by Used Tech Solutions for branded emails.

## 6. Remaining launch blockers

- [ ] Agent Milestone 1 passed on real Dell, HP and Lenovo laptops
- [ ] Stage 2 destructive testing and method qualification evidence per drive/laptop combination
- [ ] Signed station requests or mTLS; credential rotation
- [ ] Phase 3 evidence storage + records; Phase 4 billing
- [ ] Branded email domain
- [ ] Independent security review / penetration test
- [ ] Backup/restore drill, documented RPO/RTO; retention, legal holds, account deletion
- [ ] Independent assessment of the engine; legal review of all public claims
