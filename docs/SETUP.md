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

## Local checks

- `bunx vitest run`
