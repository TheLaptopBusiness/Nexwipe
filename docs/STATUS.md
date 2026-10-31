# NextDrive — status

_Last updated: read-only pilot publish (2026-10-31). Published address: https://pixel-perfect-screenshot-maker-52.lovable.app_

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
| Unit tests (roles, CSV, jobs, discovery display, recovery rules) | `bunx vitest run` (40 PASS) |
| Station program refuses destructive commands | `agent-handoff/station/tests` (14 PASS), `verify-image.sh` |
| **Recovery from outdated app code (blank-screen fix)** — in-app and start-up failures. Reloads once per tab per 5 minutes; the guard is stored before reloading so it survives the reload; never auto-reloads with unsaved form input (asks instead); ordinary errors show a fallback with Try again and redacted support details; the framework's own silent reload is switched off so one rule applies | Controlled browser test `tests/browser/stale_code_recovery.py` (dev server, code files blocked or replaced in the browser): reload once → recovers; persistent failure → exactly 1 reload then fallback, manual reload recovers; unsaved form → 0 reloads, warning shown; ordinary error → 0 reloads, fallback, Try again recovers; tokens/emails redacted in shown, stored and app-logged details; start-up failure → 1 reload, or a visible fallback instead of a blank page. `src/lib/app-recovery.test.ts` (10 PASS) |

| **Read-only test stations** — every physical station enrolls read-only: the database refuses to authorize it for jobs or accept job events/evidence from it | `tests/db/phase2c_readonly_stations.sql` (18/18 PASS) |
| Station credential **expiry (90 days) and rotation** with 10-minute grace; revocation kills rotated credentials | `phase2c_readonly_stations.sql`, contract check (23/23 HTTP checks) |
| Duplicate-free station reports (restart/reconnect updates one record) and **review flags** for missing/duplicate identifiers | `phase2c_readonly_stations.sql`, VM checklist step 7 |
| Existing account accepting an invitation by email (sign-in link → pending invitation shown → accept) | browser + real email in a test mailbox |
| Invitations addressed to a signed-in user's confirmed email are shown and can be accepted even without the link | browser (same test) |
| **Bootable USB build** (Debian 13, signed shim/GRUB/kernel, read-only squashfs, encrypted state partition) and **read-only station program** (real sysfs/SMBIOS discovery, boot USB excluded by device ancestry, console, enrollment, network errors) | Image built here; booted in a **virtual machine** (QEMU/OVMF UEFI) and all 8 checklist steps passed there; 14 station unit tests; build-time destructive-tool scan |

| **Closed pilot sign-up** — public sign-up is switched off in the auth service (sign-up requests are refused with "signups not allowed"); the sign-in and invitation pages no longer offer "Create account" | API probe after the change; published sign-in page checked |
| **Published read-only pilot** (2026-10-31) — on the published address: password sign-in, required two-step code (wrong code rejected), inventory, enrollment token created in the app, the real station program enrolled with clearly labelled test hardware (`PUBLISHED-CHECK`), report → Add to inventory → re-report → laptop and drives agent-verified, boot stick not recorded, re-reports counted without duplicates, revocation deletes the station credential; 23/23 HTTP contract checks; outdated-code recovery test (all cases) against the published build | `tests/browser/published_station_check.py`, `tests/browser/stale_code_recovery_published.py`, `scripts/agent-contract-check.ts` with `ND_BASE` = published address |
| Signed-out access: credentials, enrollment tokens, evidence, customers, devices, drives, jobs, audit, invitations all refused to signed-out visitors; station credentials and request nonces unreadable even for signed-in owners | REST probe of 21 tables (signed-out and signed-in), plus the tenant-isolation suites above |

## 2. Implemented but unverified

- **New invitee completing first password + required MFA**: blocked in testing — the sign-in service accepted two invitation emails (06:40, 06:52 UTC) but neither reached the test mailbox within ~25 minutes, most likely the default sender's hourly email limit. The steps after the email (accept, set first password, set up authenticator) are not verified.
- **Physical laptop compatibility: UNVERIFIED.** The USB image has not been booted on any physical laptop. Secure Boot on real firmware, storage-controller modes (AHCI / RAID / RST / VMD), Wi-Fi, real drive identity strings and USB boot on real firmware are untested. Stays unverified until a filled-in record from `agent-handoff/PHYSICAL_TEST_CHECKLIST.md` exists per laptop.
- **Invitations for brand-new users with public sign-up switched off**: invitations are sent by the trusted invitation function (administrator invite), which is expected to keep working, but no new-invitee email has been received since the change.
- New Google sign-ins: with sign-up closed, a Google account that has no NextDrive account yet cannot sign in; existing accounts are unaffected (not re-tested).
- Email links redirect to the app's main address, not to the invitation page (the sign-in service only allows registered addresses); the in-app pending-invitation banner covers this.
- Invitation links on a **custom domain** require `APP_ALLOWED_ORIGINS` to list it.
- Agent API behaviour on the published site (all HTTP checks ran against the preview server).
- **Outdated-code recovery after a real update**: tested on the development server and on the published build by blocking/replacing code files in a test browser; not yet observed during an actual new deploy with a tab left open. Not tested in Safari or Firefox (their error wording is covered only by unit tests). The browser's own error log on the user's computer can still show the raw error message (development and published); NextDrive's stored, shown and reported details are redacted.
- The reference client's hardware discovery on a real laptop (only tested with replayed test hardware data in this environment, which has no laptop hardware).

## 3. Simulated

- Agent simulator jobs, laptops (`SIM-…`), drives, stations and evidence. Always labelled SIMULATED; can never be billable, certificate-eligible, run on a real station, or be added to real inventory.

## 4. Not built

- Phase 3: realtime updates (polling now), binary evidence storage, PDF records, QR verification, signing.
- Phase 4: billing, credit ledger, platform admin.
- Signed station requests / mTLS, station image attestation (see `docs/agent-api/station-auth.md`).
- Branded invitation emails from your own domain (currently the default sign-in email sender and wording).
- Logo upload, retention enforcement, legal holds, account deletion.

## 5. External development required

- **Boot the USB image on one Dell, one HP and one Lenovo laptop** and fill in `agent-handoff/PHYSICAL_TEST_CHECKLIST.md`.

- **The NextDrive bootable agent** (image, discovery, capability detection, local confirmation, privileged engine, evidence, credential storage, signed updates, recovery). Handoff: `agent-handoff/`. Milestone 1 is read-only; destructive testing only on designated disposable drives (Stage 2).
- Per-model hardware qualification and method-support evidence (`agent-handoff/MILESTONES.md`).
- Independent third-party assessment of the erasure engine.
- An email sender domain owned by Used Tech Solutions for branded emails.

## 6. Remaining launch blockers

- [ ] Agent Milestone 1 passed on real Dell, HP and Lenovo laptops (VM pass only so far)
- [ ] New-invitee email + first password + MFA verified (needs reliable email delivery / own email domain)
- [ ] Hardware-backed station keys or request signing (see `docs/agent-api/station-auth.md`)
- [ ] Stage 2 destructive testing and method qualification evidence per drive/laptop combination
- [ ] Signed station requests or mTLS; credential rotation
- [ ] Phase 3 evidence storage + records; Phase 4 billing
- [ ] Branded email domain
- [ ] Independent security review / penetration test
- [ ] Backup/restore drill, documented RPO/RTO; retention, legal holds, account deletion
- [ ] Independent assessment of the engine; legal review of all public claims
