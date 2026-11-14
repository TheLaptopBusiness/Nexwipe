# How NexWipe works — guide for new team members

Last reviewed against the code: 2026-11-01. This guide explains the whole system in one place and links to the deeper
documents. When it disagrees with the code, the code wins — please fix this file.

Read alongside:
- `AGENTS.md` — the engineering rules. Each one exists for a reason; don't break them without discussion.
- `docs/STATUS.md` — what is built, how it was tested, and what isn't verified.
- `roadmap.md` — open work and what each item is waiting on.
- `docs/ARCHITECTURE.md` — schema reference by phase.

---

## 1. What NexWipe is today

NexWipe (by Used Tech Solutions) is meant to become a commercial system for refurbishers. It will erase laptop drives and keep records you can audit: which device, which drive, who handled it, what was done and what was proven. The tagline is "Wipe. Verify. Renew."

What exists today:

| Area | State |
|---|---|
| Public website, pricing, sign-up, company setup, two-step verification | Live at `https://nexwipe.co` |
| Inventory, custody history, audit log, sites, clients, projects, team roles and invitations | Live |
| Read-only **station** (bootable USB) that reports a laptop's hardware to the app | Built and tested in a virtual machine; **not yet tested on a physical laptop** |
| Erasure policies, job workflow, approvals | Built, but jobs run only in the **simulator** |
| Chromebook processing records (guided manual workflow) | Live; physical Chromebook support unverified |
| Real drive erasure, erasure certificates, payments, wipe credits, Google Admin connection | **Not built / disabled** |

Rules that don't bend (the full list is in `AGENTS.md`):
- Never present simulated or unbuilt features as real. Simulated data is always labelled.
- Never claim certifications (NIST, ADISA, R2), independent validation or production readiness.
- A station signing in only proves *which station* sent a report. It does not prove the hardware exists, so the UI never says "verified hardware".
- Payments and wipe credits stay off until they're actually built.

---

## 2. System map

```text
                        +------------------------------+
  Browser (public) ---> |  Public website (SSR)         |  /, /product, /pricing, /signup, /auth, /demo ...
                        +------------------------------+
  Browser (signed in) ->|  Signed-in app (client-only)  |  /app/*  (dashboard, inventory, jobs, stations ...)
                        +---------------+--------------+
                                        | reads/writes under row-level security
                                        v
                        +------------------------------+
                        |  Lovable Cloud backend        |  Postgres + Auth (+ email)
                        |  - RLS policies               |
                        |  - SECURITY DEFINER RPCs      |
                        |  - triggers (history, rules)  |
                        +---------------+--------------+
                                        ^ service-role RPCs only (agent_*)
                        +---------------+--------------+
                        |  Station API v1 (server route)|  /api/public/agent/v1/*
                        +---------------+--------------+
                           ^                         ^
            HTTPS, per-station credential      in-process call (same handler)
                           |                         |
           +---------------+-----------+    +--------+--------------------+
           | Read-only USB station      |    | Simulator (labelled,        |
           | (agent-handoff/station,    |    | src/simulator, server fn)   |
           |  agent-handoff/usb-image)  |    +-----------------------------+
           +----------------------------+
```

The Chromebook track uses the same app and database, with its own tables and screens. Its discovery USB kit is in
`agent-handoff/chromebook-discovery/`.

---

## 3. Tech stack and repository layout

- **Frontend/server framework:** TanStack Start v1 (React 19, TypeScript, Vite 7), deployed to an edge worker (Cloudflare Workers runtime, not Node).
- **Styling:** Tailwind CSS v4 configured in `src/styles.css` (design tokens; no hard-coded colours in components). Fonts: IBM Plex Sans/Mono and Space Grotesk. Look: dark navy, white, restrained green.
- **Backend:** Lovable Cloud (managed Postgres, Auth, email). The browser client is `@/integrations/supabase/client` (generated — don't edit anything in `src/integrations/supabase/`).
- **Data fetching:** TanStack Query hooks in `src/lib/queries.ts`, keyed by organization id.
- **Validation:** Zod (station API schemas in `src/lib/agent-api/schemas.ts`).
- **Station program:** Python 3 (stdlib + `cryptography`), in a Debian 13 live USB image.

```text
src/
  routes/                     file-based routes (TanStack Router)
    __root.tsx                html shell, head, auth listener, error/recovery boot script
    index.tsx, product.tsx, workflow.tsx, hardware.tsx, pricing.tsx, support.tsx, demo.tsx
    signup.tsx, auth.tsx, auth_.callback.tsx, reset-password.tsx, welcome.tsx, invite.$token.tsx
    pilot.tsx                 legacy redirect to /demo
    _authenticated/           everything behind sign-in (client-only, ssr:false)
      route.tsx               the sign-in gate (redirects to /auth)
      onboarding.tsx          create your company
      app.tsx                 app shell: sidebar, org switcher, two-step gate (MfaGate)
      app.index.tsx           dashboard (+ "What you can use today" panel)
      app.setup.tsx           Get started checklist
      app.inventory.*, app.projects.*, app.clients.tsx, app.sites.tsx, app.team.tsx,
      app.audit.tsx, app.settings.tsx, app.account.tsx, app.hardware.tsx
      app.policies.*, app.jobs.*, app.agents.tsx, app.simulator.tsx
      app.chromebooks.*       Chromebook track
    api/public/agent/v1/$.ts  station API entry (delegates to src/server/agent-api)
  server/agent-api/handler.server.ts   station API implementation (server-only)
  simulator/                  simulated station client + scenarios
  lib/                        shared logic (permissions, jobs, discovery display, hardware-origin labels,
                              invitations server fn, simulator server fn, recovery, setup checklist, csv ...)
  components/nd/              NexWipe UI pieces (page layout, MFA gate, station reports, badges ...)
  components/ui/              shadcn/ui primitives
  start.ts                    request/function middleware (error page, CSRF, bearer token attach)
drizzle/migrations/           every database change, in order (0000 ... 0017)
tests/db/                     database acceptance checks (self-rolling-back SQL)
tests/browser/                Playwright scripts used for published-site checks
scripts/agent-contract-check.ts   HTTP contract checks for the station API
docs/                         architecture, status, setup, station API contract, Chromebook docs
agent-handoff/                station program, USB image build, Chromebook discovery kit, test checklists
```

---

## 4. Accounts, companies and roles

### Sign-up and sign-in
- **Start Now** goes to `/signup` (name, email, password). Passwords need at least 10 characters and must include a letter and a number. Leaked passwords are refused by the auth service. The form also has a hidden honeypot field and a minimum fill time, but those are browser-side hints only; the real protections are on the server.
- **Email verification is required.** The link returns to `/auth/callback`. If an email client opens it on the site root instead, `src/lib/landing-hash.ts` catches the link and carries on with setup.
- After verification: `/onboarding` → create a company (`create_organization` RPC). That RPC enforces: verified email, name 2–120 characters, URL slug rules, at most 3 companies per hour and 5 active owned companies. The creator becomes **owner**.
- Owners and admins must set up an authenticator app (`MfaGate` in `app.tsx`). After that, `/app/setup` (Get started) walks through adding a first site and connecting a first device.
- Sign-in: `/auth`, with email + password, then a 6-digit code if the account has two-step verification. Google sign-in goes through the Lovable OAuth broker.
- Password reset: `/auth` → Forgot password → email → `/reset-password`. Accounts with two-step verification must enter their code there before the password can change.

### Invitations
- An owner or admin invites someone from **Team**. The server function `src/lib/invitations.functions.ts`:
  1. calls `create_invitation`, which checks the caller's role and two-step session and stores only a hash of the token;
  2. emails a link to `/invite/<token>`, either as a new-account invite or as a sign-in link for an existing account.
  The link's address must be one allowed in `src/lib/app-origins.ts` (nexwipe.co, www.nexwipe.co, nexwipe.lovable.app, Lovable preview hosts), because the request's Origin header can be forged.
- Invited people must choose a password before using the app (`src/lib/first-password.ts`, redirect to `/welcome`).
- An invitation only works for the email address it was sent to. Public sign-ups can't join an existing company without one.

### Roles (enforced in the database; `src/lib/permissions.ts` only mirrors them for the UI)
| Role | Summary |
|---|---|
| owner | everything, including granting owner |
| admin | team (not owners), sites, clients, projects, settings, operations |
| technician | intake, devices, drives, batches, custody notes, technician job steps |
| auditor | read everything staff can read + audit log; no writes |
| customer_viewer | only projects explicitly shared with them |

**Owner/admin rights only count in a session that passed two-step verification (AAL2).** This is checked inside the
database function `has_org_role`, so skipping the UI gate doesn't help. Platform administrators are a separate,
server-managed table (`platform_admins`); no public path grants it.

---

## 5. Data model

All tables live in the `public` schema. Migrations are in `drizzle/migrations/`; the full column-level reference is in `docs/ARCHITECTURE.md`.

| Group | Tables | Notes |
|---|---|---|
| Accounts | `profiles`, `platform_admins`, `organizations`, `memberships`, `invitations` | Membership changes only through RPCs |
| Operations | `sites`, `clients`, `projects`, `batches`, `client_access_grants` | `clients` are the customer's own clients (schools, companies), not NexWipe customers |
| Inventory | `devices`, `drives`, `device_drive_associations` | A drive has at most one active device; history is kept |
| History | `custody_events`, `audit_events` | Written by triggers, append-only for app users |
| Erasure workflow | `policies`, `policy_versions` (immutable), `jobs` (one per drive), `job_authorizations`, `job_events` (monotonic `seq`, idempotency key), `evidence_objects` | State changes only via SQL |
| Stations | `agents`, `agent_credentials` (hashed, 90-day expiry), `enrollment_tokens` (hashed, single use), `agent_nonces`, `agent_discoveries` (one row per station + laptop; full report payload as JSON) | |
| Chromebooks | `chromebook_records`, `chromebook_events` | Separate track, see section 10 |
| Website | `pilot_requests` | Book a Demo form submissions (table name kept from earlier) |

**How company data stays isolated:**
- Every company-owned table has an `org_id` column and a `UNIQUE (org_id, id)` key. Child rows point to parents with **composite foreign keys `(org_id, parent_id)`**, so a row can't reference another company's data even if someone forges an id.
- Row-level security checks membership with `has_org_role`, `is_org_staff` and `has_project_grant`. The `org_id` the browser sends is only used as a filter.

**Integrity flags only trusted code may set:** `hardware_verified`, `source = agent_reported`, `is_demo`, `is_simulated`, and any `hardware_origin` other than synthetic. Triggers use `is_untrusted_caller()` to refuse these from the browser.

**Hardware origin** (`devices`, `drives`, `agent_discoveries`): `not_station_reported` | `station_reported` | `synthetic`.
- It's classified on the server by `_classify_hardware`, using the station's declared `hardware_source` plus virtual-machine and test-data checks. If the station doesn't declare a source, it counts as synthetic.
- Synthetic is permanent, is never treated as verified, and blocks job creation.
- `src/lib/hardware-origin.ts` provides the only labels the UI uses.

---

## 6. Security model in one page

1. **The database is the security boundary.** Every rule that matters is in RLS policies, `SECURITY DEFINER` RPCs or triggers. Hiding a button in the UI is never protection on its own.
2. **Browser writes** go directly to tables under RLS for simple cases (sites, clients, inventory). Anything privileged goes through an RPC that re-checks the caller: memberships, invitations, roles, companies, job state, Chromebook steps.
3. **Server functions** (`createServerFn`) protected with `requireSupabaseAuth` run as the signed-in user. `src/start.ts` attaches the bearer token and adds CSRF protection. The admin (service-role) client is loaded only inside handlers, and only after the caller has been authorized.
4. **The station API** is a public route (`/api/public/...`), so the handler authenticates every request itself:
   - `Authorization: Bearer ndagt_…` — the server stores only a hash of the credential;
   - `X-ND-Timestamp` must be within ±300 s;
   - `X-ND-Nonce` must be unused for that station;
   - every job write needs a `seq` and an idempotency key.
   Details: `docs/agent-api/station-auth.md`.
5. **Read-only stations:** every physical station enrolls read-only. Triggers refuse job authorizations, job events and evidence from such stations. Only trusted server code can unlock one — never an app user.
6. **History is append-only:** there are no UPDATE/DELETE grants on custody, audit, job-event or Chromebook-event tables.
7. **Secrets:** browser code uses only the publishable key. The service-role key exists only on the server. Stations never receive backend keys.

---

## 7. Station lifecycle (Windows-laptop track)

The station is a bootable USB stick. A technician boots a laptop from it; it reads the hardware and reports to NexWipe. **It never erases anything.**

```text
Owner/admin (2-step session)               Station (USB)                         Server
---------------------------                -------------                         ------
Agents & stations -> Enrollment token  ->  [E] type token, name     -> POST /enroll         -> agents + credential (hashed)
                                           heartbeat every cycle    -> POST /heartbeat      -> last seen, rotate hint
                                           discover hardware        -> POST /inventory      -> agent_report_inventory
"Hardware reported by stations" list   <-                                                    -> agent_discoveries (+ review flags)
Add to inventory (asset tag)           ->  create_device_from_discovery ------------------>  device + drives (not yet station-reported)
                                           re-report (requested)    -> POST /inventory      -> marks device/drives station_reported
                                                                                                (or synthetic, permanently)
Revoke                                 ->  next request gets 401 -> station deletes its credential
```

- API endpoints (`src/server/agent-api/handler.server.ts`): `GET /health`, `POST /enroll`, `POST /heartbeat`, `POST /credentials/rotate`, `POST /inventory`, `GET /jobs`, `POST /reconcile`, `POST /jobs/{id}/ack`, `POST /jobs/{id}/events`, `POST /actions/result`, `POST /diagnostics/result`, plus the evidence endpoint. The full contract is in `docs/agent-api/openapi.yaml` and `CONTRACT.md`.
- **Agent-run diagnostics (complete test suite).** The technician clicks "Run complete test suite" on the connected-laptop page. The request is delivered exactly once by the heartbeat (`diagnostic_requested` + `diagnostic_test = full`), like Reboot into NexWipe. **Windows laptop:** the helper lists the tests and permissions and asks Y/N; on Y it serves `agent-handoff/windows-helper/nexwipe-test.html` on `127.0.0.1:<random port>` (one-time token, Host checked) and opens it in an Edge/Chrome app window (separate profile; camera/microphone allowed for that window only, because the technician already confirmed). The page uses browser features only (keyboard events, getUserMedia, Web Audio, pointer events); battery/charger/Wi-Fi come from the helper's `/info` (WMI). The page posts the result to the helper, which sends it to `/diagnostics/result` (`agent_report_diagnostic`, service-role only; the helper may report only a suite it was handed). Closing the window early or declining is reported as incomplete. **Boot-stick station:** `nd_station/hwtest.py` runs the same suite on the text console (key T, or the cloud request), and may report without a request. A diagnostic never writes to a disk; results are append-only in `diagnostic_results`, shown on the connected-device and inventory Diagnostics tabs, and do **not** change a grade. Migrations 0024 (keyboard test, retired), 0025, 0026; checks in `tests/db/phase2k_diagnostics.sql`, `src/lib/windows-test-page.test.ts`, `agent-handoff/station/tests/test_hwtest.py`.
- The handler validates every body with Zod, then calls service-role-only SQL functions (`agent_*`). Unknown fields are dropped. Because of that, any new field a station sends **must be added to `schemas.ts`**, or it silently disappears. That's exactly what happened with `hardware_source` until 2026-11-01.
- Credentials expire after 90 days. The station rotates automatically once fewer than 14 days remain.
- On the stick, the credential is encrypted and bound to that stick's serial and state partition. The only writable area is the `ND-STATE` partition.

### The USB image (`agent-handoff/usb-image/`)
- `build.sh` builds the image: Debian 13 "trixie" from a pinned `snapshot.debian.org` date → root filesystem → disk-erasing tools removed (`remove-destructive.txt`) → station program copied to `/opt/nextdrive` → `verify-image.sh` fails the build if any destructive tool or string is present → squashfs → GPT image (FAT32 ESP with the signed shim → GRUB → kernel chain, plus a 64 MiB ext4 `ND-STATE` partition).
- UEFI only. Secure Boot works with the Microsoft UEFI CA through Debian's signed shim.
- Variants:
  - `production`: the server address is entered on the station, and `https://` is required;
  - `vm-test`: plain HTTP to `10.0.2.2` is allowed, for QEMU lab tests only.
- `ROOTFS_READY=1 ./build.sh` reuses an existing root filesystem. 0.2.3 was built this way from the 0.2.2 root filesystem; see `usb-image/CHECKSUMS.txt`.
- **Writing the image erases the USB stick.** Booting a laptop from it only reads that laptop's drives.
- The physical test procedure is in `agent-handoff/PHYSICAL_TEST_CHECKLIST.md`. Physical compatibility stays unverified until a filled-in record exists.

### Read-only enforcement layers
1. The image doesn't contain erase, format, partition or trim tools (`verify-image.sh`).
2. The station program runs only the command shapes allowed in `nd_station/safety.py`. It refuses anything on the deny-list.
3. Discovery reads sysfs and the udev database. The only device node it opens is an NVMe controller (`/dev/nvmeN`, read-only), to send one Identify Controller command.
4. The server enrolls physical stations read-only, and database triggers refuse job activity from them.

---

## 8. Hardware discovery and drive capabilities

Code: `agent-handoff/station/nd_station/discovery.py` and `capabilities.py`.

- **Laptop identity:** from SMBIOS (`/sys/class/dmi/id`): manufacturer, model (Lenovo's marketing name comes from `product_version`), serial, SKU, BIOS version, plus CPU, RAM, boot mode and Secure Boot. Placeholder values such as "To be filled by O.E.M." are treated as missing and flagged.
- **Drives:** read from `/sys/block`, the udev database, VPD page 0x80 and `smartctl -i -j` (identity only).
  - The **boot USB** is found from the live-medium mount and its USB ancestor. It's marked `is_boot_medium` and never becomes a laptop drive.
  - Removable devices are excluded.
  - RAID, Intel VMD, eMMC, virtio and Thunderbolt storage are flagged as unsupported.
- **Hardware source:** the station declares `physical`, `virtual` or `synthetic`. The server makes the final classification (section 5).
- **Erase capabilities (station 0.2.3+)** — these are *advertised* by the drive; nothing is run:
  - SATA: from the IDENTIFY DEVICE words the kernel already reads, exposed in sysfs. Reported: security feature set (supported, enabled, locked, **frozen**, enhanced erase, time estimates), sanitize (crypto scramble, block erase, overwrite), TRIM.
  - NVMe: from one Identify Controller command. Reported: Format NVM (supported, crypto erase, all-namespace attributes), sanitize capabilities, maximum namespaces.
  - If something can't be read, it stays `source: "unavailable"` with a reason and is flagged `drive_capabilities_unknown`.
- **Review flags** (station-side and server-side) explain anything a person must check, for example a missing serial, duplicate drive serial, frozen or locked security, or synthetic hardware. Display labels are in `src/lib/discovery.ts`.
- Tests: `agent-handoff/station/tests/` (fake sysfs trees; `python3 -m unittest discover -s tests`).

---

## 9. Policies, jobs and the simulator

- **Policies** are versioned; jobs snapshot the policy version they use. The methods allowed per drive interface are in `src/lib/jobs.ts`.
- **Jobs:** one per drive. The state machine is enforced in SQL:
  `draft → awaiting_authorization → queued → running → verifying → awaiting_validation → approved`,
  plus `failed`, `interrupted`, `unsupported`, `quarantined` and `cancelled` (cancel is only possible before execution). A missing heartbeat means interrupted/unknown, never success.
  - A technician must confirm the target drive.
  - A reviewer must approve. Nothing approves automatically.
  - The browser can only read job tables; it changes jobs through RPCs (`create_job`, `submit_job`, `authorize_job`, `cancel_job`, `review_job`).
- **Simulator** (`/app/simulator`, `src/simulator/`, `src/lib/simulator.functions.ts`): it calls the **same station API handler** in-process, so simulated runs test the real contract. Everything it creates has `is_simulated` set by trusted code, is visibly labelled, and can never be billable or eligible for a certificate.
- **Real erasure doesn't exist.** The plan and safety requirements are in `agent-handoff/MILESTONES.md` and `SAFETY_EXECUTION_EVIDENCE.md`.

---

## 10. Chromebook track

- Chromebooks are devices with `device_class = 'chromebook'` and one `chromebook_records` row each. They **never get drive-erasure jobs**; a trigger on `jobs` enforces this.
- Management status and reset status are **independent**. A Powerwash, a recovery or the setup screen never proves deprovisioning or erasure.
- Every value records where it came from: manual, imported, API-reported or physically observed. API-reported and integration-confirmed values can only be set by trusted code.
- **Resale-ready** is decided by one SQL rule (`_cb_resale_blockers`), used by `chromebook_review` and a trigger. It blocks:
  - unknown or managed devices;
  - missing reset authorization or evidence;
  - a missing or too-early online setup check;
  - failed required diagnostics;
  - synthetic records.
  The UI only displays the result (`chromebook_resale_check`).
- Changes go only through `chromebook_*` RPCs. History in `chromebook_events` is append-only.
- Google Admin integration is a design only (`docs/chromebook/GOOGLE_ADMIN_INTEGRATION.md`); the app shows "Not connected".
- The discovery USB kit (`agent-handoff/chromebook-discovery/`) is read-only and wraps the unchanged laptop station. Entering or leaving Developer Mode is a destructive ChromeOS step, recorded separately. See `BUILD.md`, `SAFETY.md`, `LAB_UNIT_CHECKLIST.md` and `docs/chromebook/ERASURE_ENGINEERING_PLAN.md`.

---

## 11. Frontend conventions

- Public pages render on the server and each has its own `head()` metadata. Signed-in pages live under `_authenticated/` and render client-only.
- Data: React Query hooks in `src/lib/queries.ts`. Mutations call RPCs or RLS-guarded tables, then invalidate the matching query keys.
- Permissions in the UI: `can(role, capability)` from `src/lib/permissions.ts`. It only mirrors the database rules.
- `MfaGate` blocks owner/admin pages until the session is AAL2.
- Labels: always use `hardware-origin.ts` and `discovery.ts` helpers; never write "verified" for hardware.
- Outdated-code recovery has one policy: `src/lib/app-recovery.ts` (in-app) and `src/lib/boot-recovery-script.ts` (before mount), and the two must stay in sync. Rules:
  - reload at most once per 5 minutes per tab;
  - never reload automatically while a form has unsaved input;
  - ordinary errors show a fallback screen with a retry button and safe diagnostics.
- Toasts use `sonner`. UI primitives are in `src/components/ui`; NexWipe pieces are in `src/components/nd`.
- The dashboard's **What you can use today** panel (`availability-panel.tsx`) must match `docs/STATUS.md`.

---

## 12. Testing

| Kind | Where | How to run |
|---|---|---|
| App unit tests (rules: permissions, jobs, discovery display, station API schema, setup checklist, sign-up rules, recovery, CSV, Chromebook) | `src/lib/*.test.ts` | `bunx vitest run` |
| Type check | — | `bunx tsgo --noEmit -p .` |
| Database acceptance checks | `tests/db/*.sql` | Run each file against the database. They are self-rolling-back DO blocks that report PASS/FAIL. Re-run after any RLS/RPC change |
| Station API HTTP contract | `scripts/agent-contract-check.ts` | Against a running app |
| Station program | `agent-handoff/station/tests/` | `cd agent-handoff/station && python3 -m unittest discover -s tests` |
| Image safety | `agent-handoff/usb-image/verify-image.sh <rootfs>` | Part of `build.sh` |
| Browser checks | `tests/browser/*.py` (Playwright) | Used for published-site checks |
| VM boot test | QEMU + OVMF, USB stick + emulated NVMe/SATA disks | Procedure and evidence in `usb-image/README.md` and `vm-test-evidence/` |

Keep "tested on hardware" separate from "tested automatically" in `docs/STATUS.md`. A VM is not hardware.

---

## 13. Environments, building and publishing

- **Preview:** the editor preview runs the current code. Server functions and the station API run there too, against the same backend.
- **Live:** `https://nexwipe.co` (primary; `www.nexwipe.co` and `nexwipe.lovable.app` redirect or serve the same app). App code goes live only when someone **publishes**. Database migrations apply to the backend immediately.
- Stations must use the live `https://` address. The preview address needs a Lovable login and doesn't work for stations.
- Auth settings: email confirmation on, leaked-password check on, public sign-up on, anonymous users off. The auth "Site URL" fallback should be `https://nexwipe.co` (it's set in Auth settings → Advanced).
- Environment variables are managed by Lovable Cloud; see `docs/SETUP.md`. Never put the service-role key in browser code.

---

## 14. Before you change something

| If you change… | First read / also update |
|---|---|
| Any table, RLS policy or RPC | `docs/ARCHITECTURE.md`, `AGENTS.md`; add a migration; re-run `tests/db/*.sql`; update `docs/STATUS.md` |
| Station report fields | `src/lib/agent-api/schemas.ts` **and** `docs/agent-api/openapi.yaml` + `CONTRACT.md`; station tests |
| Anything on the station or USB image | `agent-handoff/station/nd_station/safety.py`, `usb-image/verify-image.sh`; never add erase commands; bump `nd_station.VERSION`; rebuild and record checksums |
| Hardware labels | `src/lib/hardware-origin.ts` (never "verified") |
| Simulator | It must keep calling the real handler; keep `is_simulated` labels |
| Chromebook rules | `_cb_resale_blockers`, `docs/chromebook/*`; `tests/db/phase2e_*`, `phase2f_*` |
| Sign-up, sign-in, invitations | `src/lib/first-password.ts`, `landing-hash.ts`, `app-origins.ts`; `tests/db/phase2g_public_signup.sql` |
| Prices, plans, product claims | Project memory (billing). No certification or readiness claims. Payments and credits stay off |
| What customers can use | `availability-panel.tsx` and `docs/STATUS.md` together |
