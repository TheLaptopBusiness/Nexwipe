# NextDrive — what is implemented, simulated and not built

_Last updated: Phase 2._

## Implemented (Phase 1)

- Public site: home, product (capabilities by real status), workflow, supported hardware, pricing (placeholders), support, pilot request form.
- Email/password sign-up with email verification, Google sign-in, password reset, authenticator-app MFA (enroll, sign-in challenge, remove).
- Organizations, roles enforced in the database, invitations (links are copied, **emails not sent**), team management, last-owner protection.
- Sites, downstream clients, projects, batches, customer-viewer project grants.
- Device inventory with rapid intake, CSV import/export, drives tracked separately with attach/detach history, custody timeline, append-only audit log, dashboard.

## Implemented (Phase 2)

- **Versioned erasure policies**: owners/admins create policies; every change is a new immutable version. Jobs keep the version they were created with. Rules: manufacturers, interfaces, permitted methods (checked against interface), verification method/sample, evidence required, reviewer roles, separate-reviewer requirement, failure handling, authorization lifetime.
- **Jobs, one per drive**, with a database-enforced state machine: draft → awaiting authorization → queued → running → verifying → awaiting validation → approved, plus failed, interrupted, unsupported, quarantined, cancelled (cancel only before execution). Execution outcome, verification outcome and reviewer approval are stored separately. Nothing is approved automatically.
- **Authorizations** bound to org + job + agent + laptop + drive association + policy version; expire; single use; technician must re-enter asset tag and drive serial; station must confirm locally (type last 4 serial characters) and report the drive it actually sees. Mismatch quarantines the job.
- **Laptop clearance**: a laptop can only be marked processed when every attached drive's latest job is approved. A failed/quarantined drive quarantines the laptop.
- **Agent API v1** (`/api/public/agent/v1`): enroll, heartbeat, inventory, jobs, ack, events, evidence (text, ≤256 KB, SHA-256 checked), results, reconcile. Per-agent hashed credentials, revocation, timestamp window, nonce replay protection, monotonic sequence numbers, idempotency keys. Spec: `docs/agent-api/openapi.yaml`; examples: `docs/agent-api/examples.md`.
- **Agents & stations** screen: enrollment tokens (single use, expiring), heartbeat/last seen, revoke.
- **Jobs** screens: queue views (all, active, needs authorization, review, problems), job detail with live status (polling), authorization dialog, reviewer approve/reject, event history, evidence.
- Missing heartbeat (3 min) turns active jobs **Interrupted**, never successful.
- Billing flags on jobs: `billable_unit` is true only for an approved, non-simulated job (no charging yet — Phase 4).

## Simulated (clearly labelled)

- **Agent simulator** (`/app/simulator`): 9 scenarios — success, unsupported drive, execution failure, verification failure, network interruption + reconnection, duplicate/replayed events, revoked credentials, drive identity mismatch, multi-drive mixed results. It calls the real Agent API handler and database rules. Every simulated laptop, drive, agent, job and evidence file is labelled SIMULATED, cannot be billed, cannot produce a record or certificate, and simulated jobs can only run on simulator agents. **No disk is ever touched.**

## Not built yet

- Real bootable agent (separate deliverable; nothing in this app erases a drive).
- Phase 3: realtime push (polling is used now), binary evidence storage, PDF records, QR verification, signing.
- Phase 4: Stripe test billing, credit ledger, platform admin area.
- Phase 5: production agent, hardware qualification, independent assessment, hardening.
- Request signing (HMAC) or mTLS for agents — current protection is bearer credential + timestamp + nonce over HTTPS.
- MFA not yet **required** server-side; invitation/notification emails; logo upload; retention, legal holds, account deletion.

## Automated checks

- `tests/db/phase1_acceptance.sql` — 14 checks. All PASS.
- `tests/db/phase2_acceptance.sql` — 37 checks (policy immutability, state machine, authorization binding/expiry/reuse, local confirmation, identity mismatch, idempotency, sequence gaps, nonce replay, evidence hash, reviewer permissions, multi-drive clearance, lost heartbeat, revocation, simulator isolation, billing flags, append-only events). All PASS.
- `bunx vitest run` — role matrix, CSV rules, job transitions, clearance, method compatibility, API helpers.
- All 9 simulator scenarios pass end-to-end in the preview.

## Production-readiness checklist (remaining work)

- [ ] Phases 3–5 above
- [ ] Agent request signing or mTLS; credential rotation
- [ ] Enforce MFA (AAL2) for owner/admin actions
- [ ] Email sender domain
- [ ] Independent security review and penetration test
- [ ] Backup/restore drill and documented RPO/RTO
- [ ] Production agent built, qualified per model, independently assessed
- [ ] Legal review of all public claims before launch
