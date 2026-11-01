# Plan: finish the laptop drive-capability step, then write a full "How NexWipe works" guide

## Part 1 — Finish the work already in progress (Windows-laptop read-only discovery)

Already done (in preview, not yet published):
- Station program 0.2.3 reads each internal drive's advertised erase features (SATA security/sanitize, NVMe format/sanitize) without running any erase command.
- Fixed a server bug: the station's "physical / virtual / test" declaration was being dropped, so every real laptop report would have been treated as test hardware.
- Station reports screen shows "Drive advertises: …" with a clear "nothing has been run or tested" note.
- New USB image 0.2.3 built; booted in a virtual PC with an NVMe and a SATA drive; enrolled, uploaded, showed up in the app; both virtual drives were byte-identical afterwards.

Remaining steps:
1. Publish the app so the live site keeps the hardware declaration and accepts the capability report.
2. Enroll the running production-image virtual PC against nexwipe.co and confirm the report appears on the live site.
3. Save the 0.2.3 image, checksums and an updated physical-test checklist (with a new "drive capabilities" section) to Files.
4. Update the status notes and roadmap (hardware-tested vs automated-tested kept separate); remove the temporary test company and accounts.

## Part 2 — New document: `docs/HOW_IT_WORKS.md`

A single onboarding guide for new team members, written from the current code, linking to the existing deeper documents instead of duplicating them.

Planned sections:
1. **What NexWipe is today** — product purpose, what's live vs simulated vs planned, hard rules (no real erasure, no payments/credits, no certification claims).
2. **System map** — diagram of the parts: public website, signed-in app, backend database and auth, station connection API, read-only USB station, Chromebook track, simulator.
3. **Tech stack and repo layout** — folders and what lives where (routes, shared helpers, components, server code, migrations, database tests, station program, USB build, Chromebook kit, docs).
4. **Accounts and companies** — public sign-up, email verification, company creation limits, invitations, roles, two-step verification for owners/admins, password reset, first-password rule for invitees.
5. **Data model** — every main table group (companies, members, sites, clients, projects, devices, drives, custody/audit history, policies, jobs, stations, discoveries, Chromebook records), how company isolation works (company id on every row, composite links), append-only history.
6. **Security model** — database rules as the real boundary, server-only functions, untrusted-browser protections, hardware-origin rules (synthetic stays synthetic; "station-reported" is not "verified").
7. **Station lifecycle** — enrollment code → credential → heartbeat → hardware report → "Add to inventory" → re-reports → revocation; read-only enforcement layers; what the USB image contains and how it's built.
8. **Drive discovery and capabilities** — how laptop identity, drives, boot-USB exclusion, review flags and advertised erase features are read.
9. **Jobs, policies and the simulator** — the job state machine, approvals, why the simulator uses the real API path and how simulated data is labeled.
10. **Chromebook track** — separate statuses, resale-ready rule, processing record, discovery kit.
11. **Front-end conventions** — data loading, permissions mirror, error/outdated-code recovery, design tokens.
12. **Testing** — app tests, database acceptance checks, station tests, browser checks, VM tests; how to run each.
13. **Building, publishing, environments** — preview vs live, live domain nexwipe.co, what changes go live when.
14. **Where things stand / how to contribute** — pointers to status notes, roadmap, engineering rules, and a short "before you change X, read Y" list.

Also: add one line to the engineering-rules file pointing new contributors to the guide, and add the doc task to the roadmap.

## Technical details
- Files: `docs/HOW_IT_WORKS.md` (new), `AGENTS.md` (one pointer line), `roadmap.md`, `docs/STATUS.md`, `agent-handoff/PHYSICAL_TEST_CHECKLIST.md`.
- Content is verified against source (routes, `src/lib`, `src/server/agent-api`, migrations, `agent-handoff/station`, `usb-image/build.sh`) as it's written; anything not confirmed is labeled as such.
- No app behavior changes in Part 2.
