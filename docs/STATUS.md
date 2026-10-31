# NexWipe — status

_Last updated: invitee first-password + hardware-origin correction (2026-10-31, after the read-only pilot publish; changes below are in the preview and not yet published). Published address: https://pixel-perfect-screenshot-maker-52.lovable.app_

**NexWipe cannot erase a real drive today.** No production agent exists, and no erasure method has been implemented or tested on hardware. Everything below that touches jobs or evidence has only been exercised with the labelled simulator.

## 1. Implemented and tested

| Area | How it was tested |
|---|---|
| Organizations, roles, invitations, team management, sites, clients, projects, batches, inventory, drives, custody, audit (Phase 1) | `tests/db/phase1_acceptance.sql` (14/14 PASS, re-run under the MFA rule), browser flows |
| **Two-step verification required for owners/administrators, enforced in the database** — owner/admin permissions only count in a two-step verified (AAL2) session; a blocking screen asks them to set up or enter a code | `tests/db/phase2b_security.sql` (MFA checks), browser: unverified owner sees the gate, verified owner gets full access |
| **Invitation emails** — sent automatically; new users get an "invited" email, existing users a sign-in link that opens the invitation; link still shown once as a fallback | browser: invitation sent and received in a test mailbox |
| Versioned policies, per-drive job state machine, authorizations, reviewer approval, laptop clearance (Phase 2) | `tests/db/phase2_acceptance.sql` (37/37 PASS under the MFA rule), simulator |
| Tenant isolation across station endpoints, jobs, evidence, discoveries, enrollment tokens and credentials | `tests/db/phase2b_security.sql` (33/33 PASS) |
| Station credential revocation, nonce replay prevention, stale timestamps, duplicate submissions (events + evidence), idempotency-key misuse | `phase2b_security.sql` + `scripts/agent-contract-check.ts` (18/18 HTTP checks; transcript `docs/agent-api/transcript.md`) |
| Read-only discovery intake: station reports → "Hardware reported by stations" → Add to inventory → station re-reports → laptop and drives marked **"Station-reported identity"** (never "verified": station sign-in proves which station sent a report, not that the hardware exists); station boot USB never recorded | `phase2b_security.sql`, browser, and the read-only reference client run against the app with test hardware data |
| Agent simulator (9 scenarios) | browser run, all PASS |
| Unit tests (roles, CSV, jobs, discovery display, recovery rules) | `bunx vitest run` (48 PASS, incl. hardware-origin and first-password rules) |
| Station program refuses destructive commands | `agent-handoff/station/tests` (17 PASS), `verify-image.sh` |
| **Recovery from outdated app code (blank-screen fix)** — in-app and start-up failures. Reloads once per tab per 5 minutes; the guard is stored before reloading so it survives the reload; never auto-reloads with unsaved form input (asks instead); ordinary errors show a fallback with Try again and redacted support details; the framework's own silent reload is switched off so one rule applies | Controlled browser test `tests/browser/stale_code_recovery.py` (dev server, code files blocked or replaced in the browser): reload once → recovers; persistent failure → exactly 1 reload then fallback, manual reload recovers; unsaved form → 0 reloads, warning shown; ordinary error → 0 reloads, fallback, Try again recovers; tokens/emails redacted in shown, stored and app-logged details; start-up failure → 1 reload, or a visible fallback instead of a blank page. `src/lib/app-recovery.test.ts` (10 PASS) |

| **Read-only test stations** — every physical station enrolls read-only: the database refuses to authorize it for jobs or accept job events/evidence from it | `tests/db/phase2c_readonly_stations.sql` (18/18 PASS) |
| Station credential **expiry (90 days) and rotation** with 10-minute grace; revocation kills rotated credentials | `phase2c_readonly_stations.sql`, contract check (23/23 HTTP checks) |
| Duplicate-free station reports (restart/reconnect updates one record) and **review flags** for missing/duplicate identifiers | `phase2c_readonly_stations.sql`, VM checklist step 7 |
| Existing account accepting an invitation by email (sign-in link → pending invitation shown → accept) | browser + real email in a test mailbox |
| Invitations addressed to a signed-in user's confirmed email are shown and can be accepted even without the link | browser (same test) |
| **Bootable USB build** (Debian 13, signed shim/GRUB/kernel, read-only squashfs, encrypted state partition) and **read-only station program** (real sysfs/SMBIOS discovery, boot USB excluded by device ancestry, console, enrollment, network errors) | Image built here; booted in a **virtual machine** (QEMU/OVMF UEFI) and all 8 checklist steps passed there; 14 station unit tests; build-time destructive-tool scan |

| **Closed pilot sign-up** — public sign-up is switched off in the auth service (sign-up requests are refused with "signups not allowed"); the sign-in and invitation pages no longer offer "Create account" | API probe after the change; published sign-in page checked |
| **Published read-only pilot** (2026-10-31) — on the published address: password sign-in, required two-step code (wrong code rejected), inventory, enrollment token created in the app, the real station program enrolled with clearly labelled test hardware (`PUBLISHED-CHECK`), report → Add to inventory → re-report → laptop and drives recorded (that run labelled them "agent-verified"; **corrected 2026-10-31: `PUBLISHED-CHECK` / `PUBCHECK-36612` are synthetic test data and are now marked "Synthetic test hardware"**), boot stick not recorded, re-reports counted without duplicates, revocation deletes the station credential; 23/23 HTTP contract checks; outdated-code recovery test (all cases) against the published build | `tests/browser/published_station_check.py`, `tests/browser/stale_code_recovery_published.py`, `scripts/agent-contract-check.ts` with `ND_BASE` = published address |
| Signed-out access: credentials, enrollment tokens, evidence, customers, devices, drives, jobs, audit, invitations all refused to signed-out visitors; station credentials and request nonces unreadable even for signed-in owners | REST probe of 21 tables (signed-out and signed-in), plus the tenant-isolation suites above |

| **Hardware origin: synthetic stays synthetic** — every station report is classified: the station declares `hardware_source` (synthetic test tree / virtual machine / physical, station 0.2.1+; 0.2.2 shows the NexWipe name); undeclared (older stations), VM-looking identities and sandbox kernels count as synthetic. Synthetic laptops and drives are labelled "Synthetic test hardware", are never marked station-reported, can never become station-reported later, and can never get an erasure job. App users cannot set or clear the origin. All earlier station-reported records (VM-0001, PUBCHECK-36612, REF-0001, CT-424073 and their drives) were re-marked synthetic | `tests/db/phase2d_hardware_origin.sql` (13/13 PASS), `phase2b_security.sql` re-run (33/33 PASS), station unit tests (17 PASS), browser: PUBCHECK-36612 and its drives show "Synthetic test hardware" in inventory, drive list and station reports |
| **Brand-new invitee with public sign-up switched off** (2026-10-31, preview build): owner invited a never-seen address → real email arrived in the test mailbox → link signed the new user in → "Set your password" page → pending invitation shown → accepted as technician → signed out → signed in again with email + the new password → app opened. Sign-up API still refuses new accounts ("Signups not allowed") | browser + real email; caveat: the email link always lands on the published main address, so this run replayed that same sign-in onto the preview build, because the published build does not have the password step yet |
| Google sign-in hand-off on the published sign-in page reaches Google's account chooser with the managed sign-in service | browser (stops at Google's page; no Google password available here) |

| **Chromebook processing track** (2026-10-31, preview) — Chromebook inventory fields with value sources; separate management and reset statuses; guided batch workflow (scan → receive → ownership → management → deprovisioning request/administrator report → serial-confirmed reset authorization → method/outcome → online setup check → manual diagnostics → resale-ready or quarantine); Chromebook Processing Record; append-only history | `tests/db/phase2e_chromebook.sql` (23/23 PASS: reset ≠ deprovisioning, unknown never becomes unmanaged, offline setup refused, managed/unresolved/enrollment-prompt devices cannot be resale-ready, synthetic never resale-ready and its history stays synthetic, app users cannot claim integration confirmation or API values, interrupted resets keep history, append-only events, no erasure jobs on Chromebooks, tenant isolation); `src/lib/chromebook.test.ts` (9 PASS); browser: temporary technician received a Chromebook by scan, recorded board, ownership, management observed → deprovisioning requested → administrator-reported, viewed record and history (test account and company deleted afterwards) |

## 2. Implemented but unverified

- **Chromebook owner/administrator steps in the browser** (authorize reset, approve resale-ready, quarantine): tested in the database only — no two-step-verified session was available for a browser run.
- **Chromebook model research** (boards for HP 11 G5 = SETZER, 11 G5 EE = RELM, 14 G5 = SNAPPY, Lenovo 300e Gen 2/3 = PHASER360/TREEYA360/VILBOZ360) comes from a third-party community list; Lenovo 300e 1st gen and ASUS C203XA boards are unconfirmed. No Chromebook has been handled by NexWipe; storage type and AUE dates are not filled in.

- **Invitee first-password step on the published address**: works in the preview build; not yet published, so a new invitee on the published site today would be signed in without being asked for a password. Publish before inviting pilot customers, then repeat the invitee test there.
- **New invitee as owner/administrator setting up two-step verification**: the tested invitee was a technician (no two-step requirement). The owner/admin two-step gate itself is tested separately.
- **Existing account signing in with Google** (with sign-up closed): not completed — needs a person with the Google account. The hand-off to Google works; one existing Google-linked account last signed in 05:48 UTC, before sign-up was closed.
- Invitation emails come from the default sender and show the project's internal name ("Pixel Perfect Screenshot Maker") as the sender name.
- **Physical laptop compatibility: UNVERIFIED.** The USB image has not been booted on any physical laptop. Secure Boot on real firmware, storage-controller modes (AHCI / RAID / RST / VMD), Wi-Fi, real drive identity strings and USB boot on real firmware are untested. Stays unverified until a filled-in record from `agent-handoff/PHYSICAL_TEST_CHECKLIST.md` exists per laptop.
- New Google sign-ins: with sign-up closed, a Google account that has no NexWipe account yet cannot sign in.
- "Station-reported identity" for a **physical** laptop: classification tested in the database only; no physical laptop has reported yet.
- Email links redirect to the app's main address, not to the invitation page (the sign-in service only allows registered addresses); the in-app pending-invitation banner covers this.
- Invitation links on a **custom domain** require `APP_ALLOWED_ORIGINS` to list it.
- Agent API behaviour on the published site (all HTTP checks ran against the preview server).
- **Outdated-code recovery after a real update**: tested on the development server and on the published build by blocking/replacing code files in a test browser; not yet observed during an actual new deploy with a tab left open. Not tested in Safari or Firefox (their error wording is covered only by unit tests). The browser's own error log on the user's computer can still show the raw error message (development and published); NexWipe's stored, shown and reported details are redacted.
- The reference client's hardware discovery on a real laptop (only tested with replayed test hardware data in this environment, which has no laptop hardware).

## 3. Simulated

- Nothing Chromebook-related is simulated. Google Admin shows “Not connected”.


- Agent simulator jobs, laptops (`SIM-…`), drives, stations and evidence. Always labelled SIMULATED; can never be billable, certificate-eligible, run on a real station, or be added to real inventory.

## 4. Not built

- Phase 3: realtime updates (polling now), binary evidence storage, PDF records, QR verification, signing.
- Phase 4: billing, credit ledger, platform admin.
- Signed station requests / mTLS, station image attestation (see `docs/agent-api/station-auth.md`).
- Branded invitation emails from your own domain (currently the default sign-in email sender and wording).
- Logo upload, retention enforcement, legal holds, account deletion.

## 5. External development required

- **Chromebook agent research** (feasibility matrix in the app): external USB/PXE boot, ARM builds, eMMC/SATA/NVMe sanitization and restoring stock ChromeOS all need separate agent engineering and physical Chromebooks. Developer Mode and firmware flashing are not enabled.
- **Google Admin integration**: needs a Google Cloud project, OAuth client, a school willing to authorize, and validation of current Admin SDK scopes/licensing (`docs/chromebook/GOOGLE_ADMIN_INTEGRATION.md`).

- **Boot the USB image on one Dell, one HP and one Lenovo laptop** and fill in `agent-handoff/PHYSICAL_TEST_CHECKLIST.md`.

- **The NexWipe bootable agent** (image, discovery, capability detection, local confirmation, privileged engine, evidence, credential storage, signed updates, recovery). Handoff: `agent-handoff/`. Milestone 1 is read-only; destructive testing only on designated disposable drives (Stage 2).
- Per-model hardware qualification and method-support evidence (`agent-handoff/MILESTONES.md`).
- Independent third-party assessment of the erasure engine.
- An email sender domain owned by Used Tech Solutions for branded emails.

## 6. Remaining launch blockers

- [ ] Agent Milestone 1 passed on real Dell, HP and Lenovo laptops (VM pass only so far)
- [ ] Publish the invitee password step, then repeat the new-invitee test on the published address (preview: PASS)
- [ ] Existing account signs in with Google on the published address (needs the account owner)
- [ ] Hardware-backed station keys or request signing (see `docs/agent-api/station-auth.md`)
- [ ] Stage 2 destructive testing and method qualification evidence per drive/laptop combination
- [ ] Signed station requests or mTLS; credential rotation
- [ ] Phase 3 evidence storage + records; Phase 4 billing
- [ ] Branded email domain
- [ ] Independent security review / penetration test
- [ ] Backup/restore drill, documented RPO/RTO; retention, legal holds, account deletion
- [ ] Independent assessment of the engine; legal review of all public claims
