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

# NextDrive engineering rules

- Read `docs/ARCHITECTURE.md` and `docs/STATUS.md` before changing schema or features; update STATUS when a feature's status changes.
- Tenant tables carry `org_id` with `UNIQUE (org_id, id)` and child rows use composite FKs `(org_id, parent_id)` — prevents cross-company references even with forged ids.
- Access rules live in RLS + `SECURITY DEFINER` RPCs (`has_org_role`, `is_org_staff`, `has_project_grant`); `src/lib/permissions.ts` only mirrors them for UI and must not be the security boundary.
- Membership/role/invitation changes go only through RPCs (`create_organization`, `create_invitation`, `accept_invitation`, `update_member_role`, `revoke_member`) — no direct table writes for authenticated users.
- Custody and audit history are written by database triggers and are append-only for app users; never add UPDATE/DELETE grants on them.
- Browser-originated writes can never set `hardware_verified`, `source = agent_reported`, or `is_demo`; triggers enforce this via `is_untrusted_caller()`.
- Never present simulated or unbuilt functionality as real; unbuilt areas are shown as "Planned" with their phase.
- Database acceptance checks live in `tests/db/*.sql` (self-rolling-back DO blocks); re-run after any RLS/RPC change.
- Signed-in app lives under `src/routes/_authenticated/app.*`; data reads use react-query hooks in `src/lib/queries.ts` keyed by org id.
