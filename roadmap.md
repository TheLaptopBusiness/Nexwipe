# NextDrive roadmap

- [x] Architecture + schema (docs/ARCHITECTURE.md)
- [x] Phase 1: auth, org isolation, roles, inventory, clients, projects, navigation, public site
- [ ] Phase 2 (in progress)
  - [ ] Versioned erasure policies
  - [ ] Job state machine (server-enforced) with separate execution / verification / reviewer outcomes
  - [ ] Authorizations bound to org + agent + laptop + drive + policy version, expiring, single-use
  - [ ] Agent API v1 (enroll, heartbeat, inventory, jobs, ack, progress, evidence, results, reconcile) + OpenAPI + examples
  - [ ] Labeled agent simulator (9 scenarios) that uses the real API handler
  - [ ] Technician screens: policies, agents, jobs list, job detail, authorization, review
  - [ ] Database acceptance checks + unit tests
  - [ ] Docs + STATUS update
- [ ] Phase 3: realtime live jobs, binary evidence storage, demo-watermarked PDF records, QR verification
- [ ] Phase 4: Stripe test billing, credit ledger, onboarding polish, platform admin
- [ ] Phase 5: production agent, hardware qualification, independent assessment (outside this app)
- [ ] Email sender domain for invitation emails (needs a domain from the owner)
