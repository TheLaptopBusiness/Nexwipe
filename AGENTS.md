<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# NexWipe engineering rules

- Read `docs/ARCHITECTURE.md` and `docs/STATUS.md` before changing schema or features; update STATUS when a feature's status changes.
- Tenant tables carry `org_id` with `UNIQUE (org_id, id)` and child rows use composite FKs `(org_id, parent_id)` — prevents cross-company references even with forged ids.
- Access rules live in RLS + `SECURITY DEFINER` RPCs (`has_org_role`, `is_org_staff`, `has_project_grant`); `src/lib/permissions.ts` only mirrors them for UI and must not be the security boundary.
- Membership/role/invitation changes go only through RPCs (`create_organization`, `create_invitation`, `accept_invitation`, `update_member_role`, `revoke_member`) — no direct table writes for authenticated users.
- Custody and audit history are written by database triggers and are append-only for app users; never add UPDATE/DELETE grants on them.
- Browser-originated writes can never set `hardware_verified`, `source = agent_reported`, `is_demo`, or a non-synthetic `hardware_origin`; triggers enforce this via `is_untrusted_caller()`.
- `hardware_origin = 'synthetic'` is permanent and implies `hardware_verified = false` (CHECK + triggers); station authentication only proves which station reported, so UI never says hardware is "verified" — use `src/lib/hardware-origin.ts` labels.
- Invited accounts must choose a password before using the app: `src/lib/first-password.ts` + the root-level redirect to `/welcome`, because invitation emails can land on any app address.
- Never present simulated or unbuilt functionality as real; unbuilt areas are shown as "Planned" with their phase.
- Database acceptance checks live in `tests/db/*.sql` (self-rolling-back DO blocks); re-run after any RLS/RPC change.
- Signed-in app lives under `src/routes/_authenticated/app.*`; data reads use react-query hooks in `src/lib/queries.ts` keyed by org id.
- Job state changes happen only in SQL (`agent_*` service-role RPCs and technician RPCs); browser roles have read-only access to Phase 2 tables — keeps the state machine un-bypassable.
- Agent API code lives in `src/server/agent-api/` behind `src/routes/api/public/agent/v1/$.ts`; the simulator must call that same handler, never a separate fake path, so simulated runs exercise the real contract.
- Anything simulated carries `is_simulated` set by trusted code only and must be visibly labelled in the UI; simulated jobs can never be billable or certificate-eligible.
- Owner/admin rights require an AAL2 session inside `has_org_role`; never add a privileged path that checks membership without it (e.g. via `is_org_member`), or MFA enforcement is bypassed.
- Invitation tokens are only ever known to `create_invitation`'s caller; send emails from the same server function that created the token, never by re-deriving tokens.
- `agent-handoff/` holds docs, the read-only station program (`station/`) and the USB build (`usb-image/`); never add erasure commands or destructive tools there — `verify-image.sh` and `station/nd_station/safety.py` enforce this.
- Physical stations enroll read-only (`agents.read_only`, enforced by triggers on authorizations/events/evidence); only trusted server code may unlock one, never an app user.
- Outdated-code/stale-chunk recovery has one policy: `src/lib/app-recovery.ts` (in-app) and `src/lib/boot-recovery-script.ts` (before mount, keep in sync); TanStack Router's own silent reload is disabled there — it ignores unsaved form input and has no loop guard window.
- Chromebooks are a separate track (`chromebook_records`/`chromebook_events`, `chromebook_*` RPCs, `src/lib/chromebook.ts`, routes `app.chromebooks.*`): devices with `device_class = 'chromebook'` never get drive-erasure jobs; management and reset statuses stay independent; integration-confirmed deprovisioning and `api_reported` values are trusted-code only — because a Powerwash or setup screen is not proof of deprovisioning or erasure.
