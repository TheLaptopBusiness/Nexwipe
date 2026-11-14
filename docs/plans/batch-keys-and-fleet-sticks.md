# Batch keys and fleet USB sticks — design notes (not built)

Status: idea captured 2026-11-03, parked for later. Nothing here is implemented.

## Problem

- Today every USB stick needs its own "Prepare USB stick" click: the setup file holds a **single-use**
  enrollment token (`ndenr_…`).
- Copying one prepared stick to many does not work:
  - only the first copy can enroll (token is single-use);
  - after first run the stick saves its sign-in in `state\station.json`; copies of that file share one
    station identity, so Rescan / Reboot cannot tell laptops apart.
- A lost stick is risky: it holds a token and, after first run, a station credential.

## Wanted

- Prepare once, copy the same files to 20 / 100 / 1,000 sticks.
- A key per batch (e.g. "today's batch"); the person creating it chooses the expiry (default: end of today).
- Optionally: the program asks for the key every time it starts, so a lost or copied stick is harmless.

## Proposed design

1. **Batch key** (replaces the single-use token for this flow)
   - Created in Agents & stations, linked to a batch; expiry chosen by the user, optional max number of sticks.
   - Multi-use until expiry; **Revoke** stops it immediately — including every station that enrolled with it.
   - Human-typable format, e.g. `NWK-7F3Q-9XKD-2MPA` (~80 bits); stored only as a hash.
   - Server rate-limits wrong key attempts (no guessing).
   - Laptops reported through a key are tagged with its batch automatically.
2. **Ask for the key at start (recommended default)**
   - `Start NexWipe.cmd` asks "Enter today's NexWipe key"; nothing secret is written to the stick.
   - The station sign-in lives only in memory while the window is open; closing it means re-entering the key.
   - Optional "save key on this stick" for trusted bench sticks (then the key sits in `nexwipe-setup.json` until it expires).
3. **One identity per physical stick**
   - Program keys any saved state by the stick's own USB serial (it already reads it in `Get-StickDisk`),
     so cloned files on different sticks never share an identity.

## Work involved

- Migration (+ rollback, local rehearsal, `tests/db`): multi-use expiring batch keys, attempt limit,
  station credentials that end when their key expires or is revoked, batch link.
- Windows program (`agent-handoff/windows-helper/nexwipe.ps1`): key prompt, no secrets on stick, per-stick-serial state.
- App: key list on Agents & stations (create with expiry, uses, revoke) and "Prepare USB stick" without a per-stick token.

## Scale notes (from reading the code; not load-tested)

- Each running stick checks in every 5 s; each check-in is a few small database calls
  (sign-in, nonce record, heartbeat, job sweep). Old nonces are deleted after 15 minutes.
- 20 laptops ≈ 4 check-ins/s — fine. 100 ≈ 20/s — very likely fine.
- 1,000 ≈ 200/s — depends on the Supabase/Lovable plan; before going that big:
  - slow the idle check-in to 15–30 s (one-line change; Rescan/Reboot react within that time),
  - load-test 1,000 simulated sticks against the local test database,
  - confirm the database plan's connection/request limits.
