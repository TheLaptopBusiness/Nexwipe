# Build result — 0.1.0-cb-discovery (2026-10-31)

**Status: image BUILT and structure-checked. Booted only in a QEMU virtual PC (x86-64, kernel loaded
directly). NOT booted on any Chromebook; stock-firmware (depthcharge) loading of the KERN-A partition
is untested. Hardware compatibility unverified.** No erasure capability.

## Output

| File | SHA-256 |
|---|---|
| `nexwipe-chromebook-discovery-0.1.0-cb-discovery.img` (380,633,088 bytes) | `3840df4765b0ec068cfb9ece406159ebf0574c24a0539104077da6b3c741df6f` |
| `nexwipe-chromebook-discovery-0.1.0-cb-discovery.img.xz` (215,964,668 bytes) | `4f0e6f02ade4472396d91ddda45cbac7683d66559cfc232c6df22b7296a36238` (see `SHA256SUMS`) |
| `bzImage-6.12.107-nexwipe-cb` | `917dd7eaf2926cc7490cad07b46b53488648ac8ae7308d783e8f0aeaede88cfc` |
| `filesystem.squashfs` | `e94409c354e98232302a2d2d8c71ac55011bb596a76f41aa65a4ed4a158bc76a` |

Kernel `6.12.107-nexwipe-cb` from Debian `linux-source-6.12 6.12.107-1` (matches the image's
`linux-image-6.12.107+deb13-amd64 6.12.107-1`); Debian snapshot `20260913T000000Z`; station program
0.2.2-readonly (unchanged); Chromebook program 0.1.0-cb-discovery. Kernel blob ~16.7 MB (just under
the 16 MiB warning threshold; whether SETZER firmware accepts this size is unknown).

## Where and how it was built — deviations from BUILD.md

Built in the NexWipe project's sandbox, **not on a Debian 13 VM**:

1. Host was not Debian 13 (`ND_ALLOW_OTHER_HOST=1`, logged as a DEVIATION).
2. The sandbox forbids ordinary mounts. Stage A's `debootstrap` and the package installs were run once
   by hand inside a user namespace with pre-created `/dev` nodes, using the same snapshot, suite and
   package list as `usb-image/build.sh`; `build.sh` then ran with `ROOTFS_READY=1 BUILDER_READY=1`.
3. `KERNEL_TREE_READY=1` was used on the final run: the kernel tree from the first full compile was
   reused and `make` rebuilt only what the corrected config changed.

So the delivered image is real and checked, but **a clean `sudo ./build.sh` on a Debian 13 VM has not
been demonstrated yet**; hashes from such a build will differ (timestamps).

## Defects the build and VM test found (fixed)

| Found by | Defect | Fix |
|---|---|---|
| Build stage B config check | Debian builds USB core as a module, so USB storage could not be built in | `CONFIG_USB=y`, `CONFIG_USB_XHCI_PCI_RENESAS=n` |
| Build stage C | Kernel blob 62 MB (> KERN-A): the kernel's initramfs generator stored 264 busybox hard links as full copies | Hard links → symlinks; firmware, hwdb and loadable modules dropped from the initramfs (boot drivers are built in); 21 MiB uncompressed |
| **VM boot** | Live medium would not mount: `codepage cp437 not found` — the fragment used a wrong option name (`NLS_CP437`) and the checker did not require the real one | `CONFIG_NLS_CODEPAGE_437=y`; preflight now requires it, `VFAT_FS`, `NLS_ASCII`, `SQUASHFS`, `OVERLAY_FS`, `BLK_DEV_LOOP` as built-in. The first build is refused by the new check and was discarded |

The first defect shows why structure checks are not boot evidence: the first build passed every check
and still could not boot.

## VM test (QEMU 10.1, TCG, q35) — what it shows and does not show

Setup: bzImage loaded with `-kernel` and the image's command line plus `console=ttyS0` and a test-only
`systemd.debug_shell` (neither is in the release image); the image attached as a removable USB stick;
two fake "internal" disks (NVMe and SD/MMC), each with an ext4 data partition containing a marker file,
a swap partition and a decoy partition labelled `ND-STATE`. SHA-256 of both fake disks taken before.

| Check | Result |
|---|---|
| Boot: kernel → built-in initramfs → live-boot finds the USB → systemd → `nd-console` running | PASS (in the VM) |
| Kernel read-only flag on every internal device and partition (`nvme0n1*`, `mmcblk0*`) | PASS (`ro=1`); USB `sda*` left writable |
| Active swap | none (swap partition present, not used) |
| Internal filesystems mounted | none |
| Credential mount | `/dev/sda3` (the USB's ND-STATE), not the decoy on the internal disks |
| `nd-console` process | `CapEff=0`, `CapBnd=0`, `NoNewPrivs=1`, `Seccomp=2` |
| Root with full privileges writes 512 bytes to internal disks/partitions | refused (EPERM) — kernel read-only flag |
| Root mounts an internal ext4 partition read-write | kernel forces read-only, skips orphan cleanup |
| Under the console's confinement: open disk for write / `mount()` / `swapon()` | all refused (EPERM); read-only open works |
| `swapon` / `mkswap` binaries | absent |
| Discovery report | `nexwipe_operations: []`, `kernel_read_only: true`, confinement values as above; the test's own read-only mount detected and flagged `internal_storage_mounted` |
| Fake internal disks after shutdown | **byte-identical** (SHA-256 unchanged) |

Not shown by the VM: Chromebook firmware loading the signed KERN-A, Developer Mode USB boot, real eMMC
(QEMU has no eMMC model here; an SD card stood in, so the eMMC EXT_CSD path is untested), Chromebook
firmware interfaces (FWID/HWID/VPD), Wi-Fi, display on Chromebook hardware.
