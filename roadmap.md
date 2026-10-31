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
- [ ] Physically identify board/arch/storage on real HP 11 G5, HP 14 G5, Lenovo 300e, ASUS C203 units — needs hardware
- [ ] Google Admin integration (read-only first) — design only; needs a school's consent and a Google Cloud project/OAuth client
- [ ] Chromebook agent (USB/PXE, ARM build, storage sanitization) — external engineering + physical hardware
