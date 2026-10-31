# Setup and configuration

## Environment variables

Managed automatically by Lovable Cloud (do not edit `.env` by hand):

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | browser | Backend URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | Public key (safe; RLS protects data) |
| `VITE_SUPABASE_PROJECT_ID` | browser | Project id |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | server only | Server functions; service key never reaches the browser or an agent |

Future (not yet required): Stripe test keys (Phase 4), report-signing key reference (Phase 3).

## Database

- Migrations: `drizzle/migrations/*.sql`, applied in order.
- Acceptance checks: run `tests/db/phase1_acceptance.sql` against the database. It rolls itself back and prints one result line; every item must read `PASS`.

## Auth configuration

- Email/password and Google sign-in are enabled. Email confirmation is required.
- Make a user a NextDrive platform admin: insert their user id into `public.platform_admins` (server-side only).

## Agent API

- Base path `/api/public/agent/v1`; see `docs/agent-api/openapi.yaml` and `docs/agent-api/examples.md`.
- Stations enroll with a single-use token from **Agents & stations**; credentials are shown once.
- Acceptance checks for Phase 2: `tests/db/phase2_acceptance.sql` (same procedure as Phase 1).

## Two-step verification

Owners and administrators must use an authenticator app; the database ignores their permissions in sessions that have not been verified with a code.

## Invitation emails

Sent by the sign-in email service (default sender until a company email domain is configured). Links use the app address the admin is on; custom domains must be listed in the `APP_ALLOWED_ORIGINS` server setting (comma-separated origins).

## Agent contract check

`ND_BASE=… ND_SUPABASE_URL=… ND_SUPABASE_KEY=… ND_USER_TOKEN=<owner/admin two-step session token> ND_ORG_ID=… ND_TRANSCRIPT=docs/agent-api/transcript.md bun scripts/agent-contract-check.ts` — enrolls a temporary CONTRACT-TEST station, runs 18 HTTP checks, revokes it. Phase 2b database checks: `tests/db/phase2b_security.sql`.

## Local checks

- `bunx vitest run`
