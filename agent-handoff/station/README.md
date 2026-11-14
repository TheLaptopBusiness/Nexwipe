# nd_station — NexWipe read-only station (Milestone 1)

Runs on the bootable USB image (`../usb-image/`). Discovers the laptop and its drives, enrolls with a short-lived token, uploads the hardware report, heartbeats, rotates its credential and shows everything on the laptop screen. **It contains no erasure capability.**

| Module | Responsibility |
|---|---|
| `discovery.py` | SMBIOS (sysfs), CPU/RAM, drives from sysfs + udev database (+ `smartctl -i -j` if present); boot medium found by **device ancestry** from the live-medium mount (mountinfo major:minor → sysfs → USB device node); review flags for missing/placeholder/duplicate identifiers, RAID/VMD, unsupported storage |
| `safety.py` | Exact allow-list of commands the station may run; destructive tools always refused |
| `netcheck.py` | Plain-language network errors: no adapter, no cable, DHCP failed, no route, DNS, firewall, TLS/clock, server errors, clock skew |
| `api.py` | Agent API v1 client (fresh nonce + timestamp per request) |
| `state.py` | Credential encrypted on the ND-STATE partition, bound to the boot stick |
| `station.py` / `console.py` | Controller + full-screen curses console |
| `hwtest.py` | Full hardware test (key **T**, or "Run full hardware test" in the app): keyboard via kernel input events (grabbed, so no console input or Ctrl+Alt+Del during the test), display colours, webcam (`v4l2-ctl` to stdout), microphone (`arecord` to stdout), speakers (`speaker-test`), touchpad, battery/charger from sysfs, Wi-Fi, physical checks. Reads hardware only |

It never opens a block device for data, never mounts anything and never reads file contents.

```bash
python3 -m unittest discover -s tests          # tests on a fake sysfs tree (incl. "never opens /dev" and the hardware test)
PYTHONPATH=. python3 -m nd_station discover     # print the report (run as root on a laptop)
PYTHONPATH=. python3 -m nd_station hwtest       # full hardware test on this screen, prints the result (run as root; nothing sent)
```
