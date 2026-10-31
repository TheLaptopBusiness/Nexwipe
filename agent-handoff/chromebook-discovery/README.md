# NexWipe Chromebook discovery build (read-only) — 0.1.0-cb-discovery

Read-only discovery USB image for one authorized lab Chromebook. No erasure commands, no firmware or
flag tools. **Hardware compatibility unverified: the image has not been booted on any Chromebook.**

- How to build: `BUILD.md` (`sudo ./build.sh` on Debian 13 amd64)
- How read-only is enforced and tested: `SAFETY.md`
- Lab procedure (gates G1–G5): `LAB_UNIT_CHECKLIST.md`
- Plan and gates: `docs/chromebook/ERASURE_ENGINEERING_PLAN.md`

## Three different things — do not confuse them

| | What it does |
|---|---|
| **Writing this image to a USB stick** | **Erases the USB stick.** Pick the right device. |
| **Putting the Chromebook into Developer Mode** (and later leaving it) | **DESTRUCTIVE: ChromeOS wipes the Chromebook's local data.** Done by the technician, only on an authorized lab unit, after identity, authorization and baseline are recorded. NexWipe does not do it; it is recorded as a ChromeOS operation. |
| **Booting this image on the Chromebook** | Read-only toward internal storage (see `SAFETY.md`). Reads identity and registers the kernel exposes. |

## Contents

| Path | Purpose |
|---|---|
| `build.sh` | Full build: host checks, rootfs, kernel (2 passes in a builder chroot), image |
| `assemble.sh` | ChromeOS USB layout + developer-key signing; runs `preflight.py` (or `--packaging-test`, never a release) |
| `preflight.py` | Fail-closed input checks (kernel, initramfs, rootfs) |
| `verify-cb-image.sh` | Image and rootfs checker; re-checks the inputs extracted from the image |
| `nd_chromebook/` | Wrapper around the unchanged station program; adds the `chromebook` report block and self-checks |
| `kernel/nexwipe-cb.config` | Kernel config fragment |
| `rootfs/` | Overlay: confined console service, read-only lock service + udev rule, pinned state mount, initramfs settings |
| `tests/` | `test_chromeos.py`, `test_preflight.py`, `test_internal_ro.py` (synthetic inputs only) |

Run the tests: `python3 tests/test_chromeos.py && python3 tests/test_preflight.py && python3 tests/test_internal_ro.py`
(`test_preflight.py` rootfs cases need `squashfs-tools`).
