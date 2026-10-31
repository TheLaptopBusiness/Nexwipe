# NexWipe roadmap

- [x] Architecture + schema (docs/ARCHITECTURE.md)
- [x] Phase 1: auth, org isolation, roles, inventory, clients, projects, navigation, public site
- [x] Phase 2: versioned policies, job state machine, authorizations, Agent API v1 + OpenAPI, labelled simulator, technician screens
- [x] Phase 2b: invitation emails, server-side MFA for owners/admins, isolation/revocation/replay tests, station discovery intake, frozen agent contract, bootable-agent handoff package
- [x] Phase 2c: read-only stations, credential expiry/rotation, review flags, duplicate-free reports, bootable USB build + station program (VM-tested)
- [x] Read-only pilot published (closed sign-up, published checks, recovery test on published build)
- [ ] Agent Milestone 1 (read-only) on real Dell/HP/Lenovo laptops — needs physical hardware (agent-handoff/PHYSICAL_TEST_CHECKLIST.md)
- [x] New-invitee invitation email → set password → accept → password sign-in (preview build; technician role)
- [x] Hardware origin: synthetic test hardware stays synthetic; "verified" labels replaced by "station-reported"; PUBCHECK records corrected; station 0.2.1 declares hardware source
- [ ] Publish the invitee password step and re-test on the published address — needs the owner to publish
- [ ] Existing account Google sign-in on the published address — needs the Google account owner
- [ ] Agent Stage 2 destructive testing on disposable drives — external team, after Milestone 1
- [ ] Phase 3: realtime live jobs, binary evidence storage, demo-watermarked PDF records, QR verification
- [ ] Phase 4: Stripe test billing, credit ledger, onboarding polish, platform admin
- [ ] Signed station requests / mTLS + credential rotation
- [ ] Branded email sender domain (needs a domain from the owner)

## Chromebook track (priority)
- [x] Chromebook inventory fields with value sources (manual / imported / API-reported / physically observed); unknown stays unknown
- [x] Separate management and reset statuses; guided barcode batch workflow; processing record; append-only history (implemented, DB-tested 23/23, technician steps browser-tested; owner authorize/release steps DB-tested only)
- [x] Compatibility research + feasibility matrix (research only; no model claimed)
- [x] Server-side resale-ready gates: unknown management, missing reset authorization/evidence, missing/early online check, required diagnostic failures (DB-tested 18/18)
- [ ] Owner/admin browser tests with two-step code — waiting on the owner (docs/chromebook/OWNER_ADMIN_BROWSER_TESTS.md)
- [ ] Physically identify board/arch/storage on real HP 11 G5, HP 14 G5, Lenovo 300e, ASUS C203 units — needs hardware
- [ ] Google Admin integration (read-only first) — design only; needs a school's consent and a Google Cloud project/OAuth client
- [x] Erasure plan revision 2: Developer Mode = destructive, pre-transition identity/authorization/baseline, ChromeOS vs NexWipe operations separated, SETZER candidate only, storage-specific reviewed procedure, no Purge from command + read-back
- [x] Chromebook discovery build kit (read-only, 0.1.0-cb-discovery): program + 9 synthetic tests, packaging + checker (packaging-tested only)
- [x] G0 discovery image built (sandbox, with deviations) + fail-closed checks + VM boot/read-only test
- [ ] Clean reproduction of the build on a Debian 13 VM (`sudo ./build.sh`) — needs a Debian 13 VM
- [ ] G1–G5 on one authorized lab unit: identify, boot, storage identification, boot-USB exclusion, evidence upload, restore to stock — needs the unit (agent-handoff/chromebook-discovery/LAB_UNIT_CHECKLIST.md)
- [ ] G6–G8 storage procedure review, method review, enable for one board — after G1–G5; erasure stays disabled

## Public signup (2026-10-31)
- [x] Public signup (name/email/password) with email verification; "Start Now" CTAs; "Book a Demo" secondary; remove pilot/early-access wording
- [x] Post-verification onboarding: create organization → first site → first-device setup checklist; invitations keep working
- [x] Signup abuse protection (leaked-password check, rate limits, bot honeypot); no platform-admin grants; no free credits/paid plans until built
- [x] Verify signup → email verification → login → onboarding end-to-end
- [ ] Publish so the live site gets public signup (verification links land on the live address)
