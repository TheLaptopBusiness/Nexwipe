# Chromebook owner/administrator browser tests — PENDING

**Status: PENDING.** These steps need a person signed in as an owner or administrator with two-step
verification. They stay pending until the results table at the end is filled in. The same rules are
already enforced and tested in the database (`tests/db/phase2e_chromebook.sql` 23/23,
`tests/db/phase2f_chromebook_resale_gates.sql` 18/18); this test confirms the screens.

Nothing here resets, erases or deprovisions a Chromebook. Every button records what a person did or saw.

## Where to run it

- Use the **preview** until the Chromebook screens are published (the live site does not have them yet).
- Run it in a **separate test company**, not your real one, so test devices never appear in real inventory:
  side menu → your company name → **Create another organization** → name it `NexWipe browser test` → switch to it.
- You need two accounts: you (owner, with two-step verification) and a technician. Invite the technician from
  Team → Invite (role Technician), or do the technician steps yourself (owners can do them too) and only skip step 4.

## Steps

Use the test serials exactly as written so the results are easy to find.

| # | Who | Do | Expect |
|---|---|---|---|
| 1 | Owner | Sign in with password and two-step code. Open **Chromebook processing**. In "Scan serial number or asset tag" type `OWNTEST001`, Enter. In **Receive Chromebook**: asset tag `OWN-T1`, manufacturer `HP`, model `Chromebook 11 G5` → **Save and open** | Record opens. Management "Unknown", reset "Not started", next step "Record ownership / processing authorization." |
| 2 | Owner | Step 2: Authorized by `Test only`, reference `BROWSER-TEST` → **Record authorization** | "Authorization recorded" |
| 3 | Owner | Leave management **Unknown**. Step 4: type `OWNTEST001` → **Authorize reset** | Reset "Authorized" (a reset may be authorized with unknown management; release may not) |
| 4 | Technician | Sign in, open record `OWN-T1`. Step 4 should **not** show "Authorize reset" on a new record (check on a second record if needed) | Text "An owner or administrator must authorize the reset." |
| 5 | Owner or technician | Step 4: method Powerwash → **Start reset** → **Technician: reset completed** | Reset "Technician-reported completed" |
| 6 | Owner or technician | Step 5: connected **Yes**, enrollment screen **No** → **Record setup check** | **Refused** with "Management status is unknown … A missing enrollment screen alone does not prove the device is unmanaged." Management stays Unknown |
| 7 | Owner | Step 7 (Review) | "Resale-ready approval is blocked (checked by the server)" lists at least: management unknown, reset completion evidence missing, online setup check required, diagnostics incomplete. **Approve resale-ready** is disabled |
| 8 | Owner or technician | Step 3: note `Owner states never enrolled — test` → **Owner reports never managed**. Step 5 again: Yes / No → **Record setup check** | Accepted. Management "Post-reset online setup checked"; Processing record tab shows Management basis "Owner-reported never managed" |
| 9 | Owner or technician | Step 6: set every check to Pass except Touchscreen = Not fitted, **Display = Fail**, notes `dead pixels` → **Save diagnostics** | Review lists "Required check not passed: display (fail)" and "Reset completion evidence is missing" |
| 10 | Owner | Type a review note and try **Approve resale-ready** if it is enabled | It stays disabled; the note does not override a required failure |
| 11 | Owner or technician | Step 4: evidence `photo of welcome screen` → **Record evidence**. Step 6: Display = Pass, Camera = Fail → **Save diagnostics** | Review now lists only "Explain the optional diagnostic exceptions in the review notes" |
| 12 | Owner | Type review note `camera faulty, B-grade (browser test)` → **Approve resale-ready** | "Released as resale-ready"; badge Resale-ready with your name and time |
| 13 | Owner or technician | Step 3: try **Management observed** on the released record | Refused: "already released: an owner or administrator must quarantine it before management changes" |
| 14 | Owner | Receive a second device `OWNTEST002` / `OWN-T2`, record authorization, step 7: note `browser test cleanup` → **Quarantine** | "Quarantined" |
| 15 | Owner | Open **History** on both records | Every step above appears once, in order, with your name or the technician's; refused attempts do not appear |
| 16 | Owner | Sign out, sign back in with password only and cancel at the two-step prompt | Owner-only actions are not available until the two-step code is entered |

When finished, quarantine `OWN-T1` with note `browser test only` so it can never be mistaken for stock.

## Results (fill in)

| Step | PASS / FAIL | Notes |
|---|---|---|
| 1–3 | | |
| 4 | | |
| 5–6 | | |
| 7 | | |
| 8 | | |
| 9–10 | | |
| 11–12 | | |
| 13 | | |
| 14–15 | | |
| 16 | | |

Tester, date, browser:
