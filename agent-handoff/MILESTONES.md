# Integration milestones

## Milestone 1 — read-only station (first real integration)

**Goal:** a physical laptop boots the NexWipe image, enrolls, reports its real hardware, heartbeats, and appears in the dashboard. **No erasure command exists in this build.** The image must not contain `nvme sanitize`, `nvme format`, `hdparm --security-erase*`, `hdparm --sanitize-*`, `sg_sanitize`, `blkdiscard`, or any write path to block devices; CI greps the image for these binaries/flags and fails the build if found (remove `hdparm`'s erase use by shipping only read helpers, or build with read-only wrappers).

| # | Step | Acceptance evidence |
|---|---|---|
| 1 | Boot one Dell, one HP, one Lenovo business laptop from USB (UEFI, Secure Boot state recorded) | photo of console + `boot_mode`/`secure_boot` in the report |
| 2 | Enroll with a token created in **Agents & stations** | station appears with name, version, "last seen" |
| 3 | Discover laptop + internal drives; flag boot USB | report shows correct service tag/serial, drive serial/model/capacity; boot USB marked "Station boot medium · not recorded" |
| 4 | Upload inventory (`POST /inventory`) | entry under **Hardware reported by stations** |
| 5 | Heartbeats every 30 s | "last seen" stays under 1 min; unplugging network shows the station stale/offline |
| 6 | Display the real device: technician clicks **Add to inventory**, station re-reports on `inventory_requested` | laptop + drives in Inventory marked "Station-reported identity" (VMs and test data: "Synthetic test hardware") |
| 7 | `GET /jobs` returns `[]`; `POST /reconcile` returns `[]` | logged |
| 8 | Revoke the station in the app | next request returns 401; console shows revoked |

Implementation: `station/` + `usb-image/`. Step-by-step test sheet: `PHYSICAL_TEST_CHECKLIST.md` (all 8 steps passed in a VM; physical laptops pending).

Exit criteria: all 8 steps on 3 laptop families, 2 of each interface where available (SATA SSD, NVMe; SATA HDD if any in stock), results recorded in a test report.

## Stage 2 — controlled destructive testing (only after Milestone 1 exit)

Preconditions:
- A separate organization named e.g. "UTS Engine Test Lab". Real customer organizations never receive test images.
- **Designated disposable test drives only**: physically labelled `ND-TEST-xxx`, registered in a test-drive register (serial, model, firmware, source, date), containing no customer data, purchased or released for destruction. The engine build for Stage 2 refuses any drive whose serial is not in an allow-list compiled into that build.
- Laptops used as hosts are lab-owned.
- A policy in the lab org listing only the method under test.
- Two-person rule: one technician authorizes in the app, a second confirms at the station.

Per run: pre-fill the drive with a known pattern + random markers, record hashes of sampled sectors, run the method, verify, then independently image or read the drive on a separate lab machine to confirm.

## Evidence required before a method is "supported" for a drive model

For each (drive model, firmware, interface, laptop model) combination:

1. ≥ 3 successful runs on ≥ 2 physical units of that drive model.
2. Independent read-back on a separate machine (not the NexWipe engine) shows no recoverable pre-fill markers across 100% of user-addressable LBAs (or, for crypto erase, sampled sectors differ from pre-hashes and no marker is found in a full read).
3. Host-protected area (HPA) / DCO checked and documented; over-provisioned/remapped areas handled per the method's specification.
4. Behaviour documented for: power loss mid-operation (≥ 1 run), frozen-state handling, timeout, failure reporting (one deliberately failed run, e.g. pulled drive).
5. Server records match reality: job states, evidence hashes, reviewer approval, and no report/certificate for simulated or test-only jobs.
6. Results reviewed and signed off by a second engineer; stored with the image version and tool versions.
7. Only then may the method be marked supported for that combination in the hardware scope. Independent third-party assessment is a separate later step; until it happens, no certification or standard-compliance claim is made.
