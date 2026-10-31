# NextDrive — what is implemented, simulated and not built

_Last updated: Phase 1._

## Implemented (Phase 1)

- Public site: home, product (capabilities by real status), workflow, supported hardware, pricing (placeholders), support, pilot request form.
- Email/password sign-up with email verification, Google sign-in, password reset, authenticator-app MFA (enroll, sign-in challenge, remove).
- Organizations with owner auto-assignment; multi-org switcher.
- Roles and permissions enforced in the database (RLS + audited RPCs).
- Invitations: hashed single-use tokens, email-bound, 7-day expiry, revocable. **Invitation emails are not sent** — the admin copies the link.
- Team management: change roles, remove members (also revokes project grants); last-owner protection.
- Sites, downstream clients, projects (expected/received/processed/quarantined/released counts), batches.
- Customer viewer access to specific projects.
- Device inventory: search, filters, pagination, barcode-friendly rapid intake, CSV import (validated, always unverified) and CSV export (formula-safe).
- Drives tracked separately from laptops with attach/detach history.
- Device detail tabs: overview, drives, job history, evidence, diagnostics, custody timeline, reports.
- Automatic custody timeline and append-only audit log.
- Dashboard with site/client/project/technician/date filters.
- Optional dark mode.

## Simulated

- Nothing. The agent simulator is planned for Phase 2 and will be clearly labeled.

## Not built yet

- Phase 2: policies, job state machine, authorizations, agent API + OpenAPI spec, agent simulator, demo org.
- Phase 3: live jobs, realtime, evidence storage, review workflow, PDF records, QR verification, signing interface.
- Phase 4: Stripe test billing, credit ledger, platform admin area.
- Phase 5: production agent, hardware qualification, independent assessment, hardening.
- MFA is offered and prompted for owners/admins but not yet **required** server-side (planned: require AAL2 for privileged RPCs).
- Invitation and notification emails (need a verified sender domain).
- Logo upload, retention enforcement, legal holds, account deletion workflow.

## Automated checks

- `tests/db/phase1_acceptance.sql` — 14 database checks (cross-company isolation, no cross-org references, technician cannot escalate, audit/custody append-only, viewer scoping, last owner, browser cannot mark hardware verified). All passed on the current schema.
- `bunx vitest run` — role matrix and CSV import rules.

## Production-readiness checklist (remaining work)

- [ ] Phase 2–4 features above
- [ ] Enforce MFA (AAL2) for owner/admin actions
- [ ] Email sender domain for invitations and auth emails
- [ ] Independent security review and penetration test
- [ ] Backup/restore drill and documented RPO/RTO
- [ ] Retention enforcement + legal hold + account deletion
- [ ] Production agent built, qualified per model, independently assessed
- [ ] Legal review of all public claims before launch
