# Chromebook discovery build — how "read-only" is enforced and tested

Claim: the discovery software cannot mount internal filesystems read-write, cannot activate internal
swap, and cannot run storage-modifying operations. It is enforced in layers, so one mistake does not
break the claim. Each layer is listed with how it is tested and whether the test ran on real hardware.
**No layer has been exercised on a Chromebook yet.**

| # | Layer | What it does | Tested how / where |
|---|---|---|---|
| 1 | **Program allow-list** (`nd_station/safety.py`, unchanged) + firmware/flag tools added by `nd_chromebook` | Only exact identity-reading command shapes may run; storage, partition, format, trim, firmware and flag tools are refused by name | Unit tests (`tests/test_chromeos.py::test_firmware_tools_refused`, station tests). Sandbox |
| 2 | **Program code** | Reads sysfs/procfs/debugfs files only; never opens a block device, never calls mount/swapon | `verify-image.sh` greps the installed program for mount calls and destructive command strings; build fails if found. Sandbox |
| 3 | **Tools absent from the image** | Storage-destructive tools (station deny-list), `swapon`, firmware/flag tools (`flashrom`, `futility`, `crossystem`, `gsctool`, `mmc`, …) and the udisks automounter are not in the root filesystem | `verify-cb-image.sh --rootfs` (build stage A/C) and `preflight.py rootfs` on the squashfs extracted from the final image. Tests: `tests/test_preflight.py` (swapon, flashrom, dd, mkfs.ext4, udisksd each refused). Sandbox |
| 4 | **No mount or swap configuration** | `/etc/fstab` intentionally empty; kernel command line `nofstab noresume systemd.swap=0 systemd.gpt_auto=0`; live-boot swap is off unless a `swap` parameter is given (none is); initramfs `RESUME=none`; kernel built without hibernation | Checker refuses fstab entries, a missing `RESUME=none`, and command lines containing `swap`, `swap=`, `resume=`, `persistence`, `rw`, `init=`, `toram`, `todisk`. Tests in `test_preflight.py`; command line checked on the real assembled image in this environment |
| 5 | **Live medium search limited to USB** | `live-media=removable-usb`: live-boot only probes removable USB devices for `/live`; it does not fall back to probing (mounting) internal storage — confirmed by reading live-boot 1:20250815~deb13u1 `find_livefs` | Source review only. A USB stick that reports itself non-removable will fail to boot (safe failure) |
| 6 | **Kernel-level read-only flag on internal disks** | (a) In the initramfs, `live-boot.read-only=/dev/mmcblk*,/dev/nvme*` runs `blockdev --setro` before the medium search. (b) After boot, `nd-internal-ro.service` sets every block device except the disk holding the live medium read-only; a udev rule repeats this for late or hot-plugged devices. If the boot disk can't be identified, every disk is set read-only | `tests/test_internal_ro.py` on a synthetic tree (internal disk, partitions and boot partitions set read-only; boot USB left alone; unknown boot disk → everything read-only; script uses only `--setro`). Not run on hardware |
| 7 | **Process confinement** (`nd-console.service.d/chromebook.conf`) | No capabilities (cannot mount, swapon, clear read-only flags, send raw device commands, load modules); disks openable **read-only** only (`DevicePolicy=closed`, `DeviceAllow=block-* r`); mount/swap/raw-I/O/module/reboot syscalls refused; whole OS read-only except the credential directory | Unit settings are checked to exist by the rootfs checker. **Not runtime-tested here** (no systemd in this environment) |
| 8 | **Runtime self-report** (evidence) | Each report carries `chromebook.confinement`: the program's own CapEff, NoNewPrivs, Seccomp mode, active swap and any mount of internal storage; and `kernel_read_only` per internal disk. Flags: `process_confinement_missing`, `swap_active`, `internal_storage_mounted`, `internal_storage_not_read_only` | Unit tests for each flag. On the first lab boot these values are the proof that layers 4–7 applied |
| 9 | **State partition pinned** | The only read-write mount is ND-STATE by the USB image's fixed partition UUID, not by label | Rootfs and image checkers verify the unit and the UUID |

## What is still possible and why it is accepted

- **The initramfs is Debian's**: it contains `dd`, `swapon` and `resume` binaries used by Debian's own
  scripts. They run only with parameters this image does not pass (`swap`, `resume=`), and the
  initramfs is discarded after boot. Kernel-level read-only flags are set before the medium search.
- **Reading the eMMC EXT_CSD** through debugfs makes the kernel send a read (SEND_EXT_CSD) to the
  device. It does not change device state.
- **ChromeOS operations** (Developer Mode entry/exit, Powerwash, recovery) are destructive and are
  performed by ChromeOS when the technician triggers them — outside this software and recorded
  separately.

## How to confirm on the first lab unit (checklist section "Confinement")

On the station screen or in the app's report: `confinement.cap_eff = 0000000000000000`,
`no_new_privs = 1`, `seccomp_mode = 2`, `active_swap = []`, `internal_mounts = []`, every internal
storage entry `kernel_read_only = true`, and none of the four safety flags present.
