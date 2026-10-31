# First physical read-only station test — instructions and record

**Status of physical compatibility: UNVERIFIED.** It stays unverified until a filled-in copy of this record exists for each laptop.
Real erasure is disabled. This test never erases, formats or changes a laptop's internal drives, and NexWipe issues no wipe certificate for it.

## 0. Before you start — two very different things happen to drives

| What | Effect |
|---|---|
| **Writing the image to the USB stick** (on your own computer) | **Erases the whole USB stick.** Everything on it is overwritten. Use a dedicated, empty stick and double-check you selected the stick, not your computer's own drive. |
| **Booting a laptop from that stick** | **Read-only towards the laptop's internal drives.** The station only reads identity information (model, serial, capacity, firmware). The image contains no erase, format, partition or trim tools, and the station program refuses to run any. It writes only to its own stick (station credential and log, `ND-STATE` partition). |

Use lab-owned laptops only. Leave drives in place as they are; do not use customer drives for this test.

## 1. What you need

- Image: `nexwipe-station-readonly-0.2.1-readonly-production.img.xz` (station program `nd_station 0.2.1-readonly`).
  - SHA-256 of the `.img.xz` download: `8a25e9d0e5205f5cea17bbe1a35b71e7e7eb2ac1f2d3939299e05fd6988ba856`
  - SHA-256 of the unpacked `.img`: `18e98b597f1faf09223b92fd900a2e23068c2f93c33037a10bbc9945aca9f5a4`
- A dedicated USB stick, 4 GB or larger, physically labelled "NexWipe station #…".
- Server address: the **published** NexWipe address, `https://…` (the private preview address does not work for stations; plain `http://` is refused by this image).
- An Ethernet cable on a network with internet access (Wi-Fi is possible with **W**, but test cable first).
- A NexWipe owner or administrator signed in with two-step verification, to create the enrollment token.
- A phone/camera for photos of firmware screens and the station screen.

## 2. Boot with the laptop's existing settings first

**Do not change any firmware (BIOS/UEFI) settings to start with** — not SATA/storage mode, not Secure Boot.

1. Power on and open the firmware setup (Dell F2, HP F10, Lenovo F1 or Enter → F1). **Photograph and record** — without changing anything:
   - BIOS/UEFI version and date
   - Boot mode (UEFI / Legacy-CSM)
   - Secure Boot (on / off)
   - Storage controller mode (e.g. "AHCI", "RAID On", "Intel RST", "Intel VMD" on/off)
   - Any boot-order or USB-boot restriction ("USB boot disabled", supervisor password)
2. Exit **without saving**. Use the one-time boot menu (Dell F12, HP F9, Lenovo F12) and pick the USB stick's UEFI entry.
3. Record what happens: station screen reached (and how long), or the exact error (photo).

## 3. If something fails

| Symptom | Likely cause | What to do |
|---|---|---|
| USB stick not offered in the boot menu | USB boot disabled, or laptop set to Legacy-only | Record. A firmware change is needed — see section 4. |
| "Secure Boot violation" / image refused | Firmware does not trust the Microsoft UEFI CA used by the image's signed boot chain | Record (photo). Do not disable Secure Boot yet; report the model first. Section 4 if you decide to continue. |
| Station screen reached but an internal drive is **missing** | Storage controller in RAID/RST/VMD mode hides the drive from Linux | Record mode and which drive is missing. Only then consider section 4. |
| Drive shown but identity wrong or blank | Controller or firmware reports differently | Record exactly what the screen and the app show versus the label/firmware. |

## 4. Only if a firmware change is necessary

A change is justified only to get past a recorded failure above (boot not possible, or drives invisible). Change **one setting at a time** and record it.

- **Why storage-controller mode matters:** in RAID/RST/VMD mode the internal SATA/NVMe drive can sit behind a controller Linux cannot see through, so the station cannot read its identity.
- **Risk of changing it:** on a laptop with Windows installed, switching storage mode (e.g. RAID On → AHCI) can stop Windows from starting until the setting is put back, and BitLocker may ask for its recovery key. Have the recovery key available, or only do this on a laptop whose installed system does not matter.
- **Secure Boot:** turning it off is a temporary diagnostic step only; record that the image did not boot with it on.

Record for every change: setting name, original value, new value, time. **Restore the original value afterwards**, save, and confirm on the firmware screen (photo) that it matches section 2. Note in the record that it was restored and whether the installed system still starts.

## 5. Station test steps

| # | Step | How | Expected |
|---|---|---|---|
| 1 | Boot | As in section 2 | Station screen within ~60 s; header says READ-ONLY TEST BUILD and the agent version |
| 2 | Connect and enroll | Cable in. App: Agents & stations → Enrollment token (1 h). Station: **S** (published `https://` address), **E**, type token, give a name | Station shows the name and "mode read_only"; app lists the station as "Read-only test station" |
| 3 | Compare identifiers | Station screen + app ("Hardware reported by stations") vs firmware screen, case sticker and drive label | Manufacturer, model, system serial, CPU, RAM match; each drive's model, serial, capacity, firmware match. Any "Needs review" flag explained. Station screen shows "Hardware source: PHYSICAL" (record the exact line) |
| 4 | Boot USB excluded | Count drives on screen vs physically installed | Each internal drive listed as INTERNAL; the stick listed as "EXCLUDED boot USB"; the app never records the stick as a laptop drive |
| 5 | Add to inventory | App: Add to inventory, enter asset tag; wait ≤ 1 min | Station uploads again; row shows the asset tag and "Station-reported identity"; laptop + drives in Inventory marked "Station-reported identity". The station screen must show **Hardware source: PHYSICAL**; if it shows VIRTUAL or SYNTHETIC, or the app shows "Synthetic test hardware", stop and record it |
| 6 | Disconnect / reconnect | Unplug the cable 1 min, plug back | "Network cable not connected", then "Connected"; app's last-seen time updates |
| 7 | Restart, no duplicates | **P** to power off, boot again from the same stick | Still enrolled (no token); app shows the same report "reported N times"; no second inventory record |
| 8 | Revoke | App: Revoke station | Within 30 s the screen shows REVOKED; the credential is deleted from the stick |

A failure in step 3 or 4 (wrong identifier, missing internal drive, boot stick recorded as a laptop drive) blocks any later destructive testing.

## 6. Record (one copy per laptop)

| Field | Value |
|---|---|
| Tester, date, USB stick # | |
| Laptop brand / model / service tag or serial (from sticker) | |
| BIOS/UEFI version and date | |
| Boot settings as found: boot mode, Secure Boot, storage controller mode, USB boot | |
| Firmware changes made (setting, original → new, why), and confirmation each was restored | none / … |
| Image file and SHA-256 checked (yes/no) | |
| Agent version shown on station screen | |
| Boot result (time to station screen, errors) | |
| Discovery failures or "Needs review" flags | |

**Identifiers — actual vs reported**

| Item | Actual (firmware / sticker / drive label) | Station screen | NexWipe app | Match? |
|---|---|---|---|---|
| Manufacturer | | | | |
| Model | | | | |
| System serial | | | | |
| CPU / RAM | | | | |
| Drive 1: model / serial / capacity / firmware | | | | |
| Drive 2 (if any) | | | | |

**Results**

| Check | PASS / FAIL | Notes / photo # |
|---|---|---|
| Boot USB shown as EXCLUDED and not recorded as a laptop drive | | |
| Enrollment (station shown read-only in the app) | | |
| Add to inventory → "Station-reported identity" (not "Synthetic"); station shows Hardware source PHYSICAL | | |
| Disconnect / reconnect | | |
| Restart without duplicate records | | |
| Credential revocation | | |

Attach the photos: firmware screens (as found, and after restoring), station screen after step 5, any error screens.
