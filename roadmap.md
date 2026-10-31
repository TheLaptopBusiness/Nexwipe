# NextDrive roadmap

- [x] Architecture + schema (docs/ARCHITECTURE.md)
- [x] Phase 1: auth, org isolation, roles, inventory, clients, projects, navigation, public site
- [x] Phase 2: versioned policies, job state machine, authorizations, Agent API v1 + OpenAPI, labelled simulator, technician screens
- [x] Phase 2b: invitation emails, server-side MFA for owners/admins, isolation/revocation/replay tests, station discovery intake, frozen agent contract, bootable-agent handoff package
- [x] Phase 2c: read-only stations, credential expiry/rotation, review flags, duplicate-free reports, bootable USB build + station program (VM-tested)
- [x] Read-only pilot published (closed sign-up, published checks, recovery test on published build)
- [ ] Agent Milestone 1 (read-only) on real Dell/HP/Lenovo laptops — needs physical hardware (agent-handoff/PHYSICAL_TEST_CHECKLIST.md)
- [ ] New-invitee invitation email → first password → MFA test (blocked on email delivery)
- [ ] Agent Stage 2 destructive testing on disposable drives — external team, after Milestone 1
- [ ] Phase 3: realtime live jobs, binary evidence storage, demo-watermarked PDF records, QR verification
- [ ] Phase 4: Stripe test billing, credit ledger, onboarding polish, platform admin
- [ ] Signed station requests / mTLS + credential rotation
- [ ] Branded email sender domain (needs a domain from the owner)
