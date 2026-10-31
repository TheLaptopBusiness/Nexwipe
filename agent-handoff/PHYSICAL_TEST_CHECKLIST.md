# Read-only station test checklist — one Dell, one HP, one Lenovo laptop

Record one copy per laptop. Use only lab-owned laptops; the station never writes to them, but treat any customer drive as off-limits anyway.
Server address for step 2: the **published** NextDrive address (`https://…`). The private preview address is not reachable by a station. Plain `http://` is refused by the production image.
Image: `nextdrive-station-readonly-0.2.0-readonly-production.img` (check its SHA-256 against `usb-image/CHECKSUMS.txt` before writing).

| Field | Value |
|---|---|
| Laptop (brand / model / service tag) | |
| BIOS version, Secure Boot on/off, SATA mode | |
| Internal drives (from BIOS or label: model, serial, capacity) | |
| Tester / date / USB stick # | |

| # | Step | How | Expected | Dell | HP | Lenovo | VM (done) |
|---|---|---|---|---|---|---|---|
| 1 | **Boot** | Boot menu key, pick the USB (UEFI) | Station screen within ~60 s; header says READ-ONLY TEST BUILD | | | | PASS (screenshot 01) |
| 2 | **Connect and enroll** | Ethernet cable (or W for Wi-Fi). In the app: Agents & stations → Enrollment token (1 h). On the station: S (server, `https://…`), E, type token, name | Network line green "Connected"; Station shows the name and "mode read_only"; app shows the station with "Read-only test station" | | | | PASS (02) |
| 3 | **Compare identifiers** | Compare screen + app ("Hardware reported by stations") with the BIOS info screen and drive labels | Manufacturer, model, system serial, CPU, RAM match BIOS; each drive's model, serial, capacity, firmware match the label/BIOS. Any "Needs review" item explained | | | | PASS: SMBIOS serial QEMUVM-DELL-0001, drives QEMUNVME0001 / QEMUSATA0001 match VM configuration |
| 4 | **All internal drives, boot USB excluded** | Count drives on screen vs. physically installed | Every internal drive listed as INTERNAL; the stick listed as "EXCLUDED boot USB"; app never records the stick as a laptop drive | | | | PASS (stick NDUSB0000001 excluded by device ancestry; 2 drives recorded) |
| 5 | **Add to inventory loop** | App: Add to inventory, enter asset tag. Wait ≤ 1 min | Station uploads again by itself; the row shows the asset tag and "Station-verified"; laptop + drives in Inventory marked station-verified | | | | PASS (09) |
| 6 | **Disconnect / reconnect** | Unplug the cable for 1 min, plug back | Screen shows "Network cable not connected"; after re-plug "Connected", heartbeat resumes; app shows last seen updating | | | | PASS (03, 04) |
| 7 | **Restart, no duplicates** | Power off (P) and boot again from the same stick | Station is still enrolled (no token needed); app shows the same report with "reported N times"; no second inventory record | | | | PASS (05: report #3, 1 record, 1 laptop) |
| 8 | **Revoke** | App: Revoke station | Within 30 s the screen shows REVOKED; further requests rejected; credential deleted from the stick | | | | PASS (06) |

Also record: photos of the BIOS identity screens, the station screen after step 5, and any "Needs review" flags. A failure in steps 3 or 4 (wrong identifier, missing internal drive, boot stick not excluded) blocks progress to any destructive testing.
