# Building the NexWipe Chromebook discovery image (0.1.0-cb-discovery)

Read-only discovery image for one **authorized lab Chromebook** (first candidate HP Chromebook 11 G5 /
SETZER — a candidate only). No erasure commands. Developer Mode preparation on the Chromebook is a
**separate, destructive ChromeOS step** (see `LAB_UNIT_CHECKLIST.md`); building the image does not
touch any Chromebook.

## 1. Source

The kit is in the NexWipe project under `agent-handoff/`. It needs three sibling folders:

```
agent-handoff/chromebook-discovery/   this kit (build.sh, assemble.sh, preflight.py, nd_chromebook/, rootfs/, kernel/, tests/)
agent-handoff/station/                read-only station program (unchanged laptop program, wrapped)
agent-handoff/usb-image/              laptop USB build, reused for stage A (pinned packages, deny-list)
```

The downloadable source package `nexwipe-chromebook-discovery-kit_v2.zip` contains exactly these
folders plus the engineering plan. Unzip it anywhere; keep the folder layout.

## 2. Build host

| Requirement | Value |
|---|---|
| OS | **Debian 13 "trixie"**, architecture **amd64 (x86-64)**. A VM is fine |
| Privileges | **root** (`sudo`). The build runs `debootstrap`, `chroot`, and mounts `proc`/`sysfs` into chroots. It does **not** need loop devices and never touches the host's disks |
| Unprivileged containers | Not supported (mounts fail). `build.sh` stops at stage 0 with a clear message. Use a VM |
| CPU | 4+ cores recommended (`JOBS` defaults to all cores) |
| RAM | **8 GiB minimum** (16 GiB recommended for `JOBS` ≥ 8) |
| Disk | **30 GiB free** in the output directory (rootfs + builder chroot + kernel tree + images) |
| Network | HTTPS to `snapshot.debian.org` (all packages come from the pinned snapshot `20260913T000000Z`) |
| Time | ~30–90 min (kernel compiles twice; pass 2 is short) |

### Host packages (Debian 13 names)

```
sudo apt install debootstrap squashfs-tools gdisk dosfstools mtools e2fsprogs xz-utils \
                 python3 vboot-kernel-utils vboot-utils
```

`vboot-kernel-utils` provides `vbutil_kernel`, `vboot-utils` provides `cgpt` and the public developer
keys in `/usr/share/vboot/devkeys`. The compiler toolchain is **not** needed on the host: the kernel is
built inside a separate Debian 13 builder chroot created by `build.sh`.

Versions used inside the image and builder are pinned by the Debian snapshot and recorded:
`build/base/installed-packages.txt` (image), `build/builder-packages.txt` (builder: gcc, make,
`linux-source-6.12`, …). Host tool versions are printed at the top of the build log.

Kernel: `linux-source-6.12` **6.12.107-1**, which must equal the root filesystem's
`linux-image-6.12.107+deb13-amd64` **6.12.107-1** (checked; the build stops if they differ). Result:
kernel release `6.12.107-nexwipe-cb`.

## 3. Build

```
cd agent-handoff/chromebook-discovery
sudo ./build.sh
```

Options (environment): `ND_OUT=/path` (output dir), `JOBS=8`, `ROOTFS_READY=1` / `BUILDER_READY=1`
(reuse a previous stage A rootfs / builder chroot after a failure), `ND_ALLOW_OTHER_HOST=1`
(non-Debian-13 host; recorded as a deviation in the log).

### Expected output (`build/`)

| File | What |
|---|---|
| `nexwipe-chromebook-discovery-0.1.0-cb-discovery.img` | Raw USB image (write this to a stick) |
| `nexwipe-chromebook-discovery-0.1.0-cb-discovery.img.xz` | Compressed copy for transfer |
| `nexwipe-chromebook-discovery-0.1.0-cb-discovery.img.sha256` | Image checksum |
| `nexwipe-chromebook-discovery-0.1.0-cb-discovery.manifest.json` | Version, kernel release, hashes, command line, preflight result, `"boot_tested": false` |
| `SHA256SUMS` | Image, .xz, manifest, bzImage, squashfs, kernel config |
| `bzImage-6.12.107-nexwipe-cb`, `kernel-config-6.12.107-nexwipe-cb`, `filesystem.squashfs` | Components |
| `logs/build-<UTC>.log` | Full build log (stages, checks, versions, result line) |
| `logs/kernel-pass1-<UTC>.log`, `logs/kernel-pass2-<UTC>.log`, `logs/initramfs-<UTC>.log` | Detailed logs |
| `base/`, `builder/` | Work directories (can be deleted after a successful build) |

The last lines of a successful log are:

```
RESULT: BUILT nexwipe-chromebook-discovery-0.1.0-cb-discovery.img (kernel 6.12.107-nexwipe-cb). Structure, signature and input checks passed.
NOT BOOT-TESTED: no Chromebook has booted this image. ...
```

A failure ends with `RESULT: FAILED in stage <stage> (line N, exit N)`.

### Checksums

```
cd build
sha256sum -c SHA256SUMS
sha256sum nexwipe-chromebook-discovery-0.1.0-cb-discovery.img      # compare with the .sha256 file and the manifest
xz -dc nexwipe-chromebook-discovery-0.1.0-cb-discovery.img.xz | sha256sum   # must equal the .img checksum
./verify-cb-image.sh build/nexwipe-chromebook-discovery-0.1.0-cb-discovery.img /usr/share/vboot/devkeys
```

Record the image SHA-256 in the lab checklist before writing the stick.

## 4. What the build refuses (fail-closed)

`preflight.py` runs inside `assemble.sh` and again in `verify-cb-image.sh` on the kernel and root
filesystem **extracted from the finished image**. The build fails on:

- **Dummy or truncated files**: kernel < 4 MiB, squashfs < 80 MiB, not a squashfs, not a bzImage.
- **Incompatible kernel**: no x86 boot header, not 64-bit, boot protocol < 2.12, payload not xz
  (stock Debian kernels are refused here), no embedded config, any required option not built in
  (Chromebook firmware interfaces, eMMC, USB storage, live filesystems…), no built-in initramfs,
  initramfs modules for a different kernel release, kernel source version ≠ image kernel version.
- **Missing startup components**: initramfs without `/init`, `/dev/console`, live-boot scripts, the
  read-only helper (`blockdev`) or `RESUME=none`; root filesystem without the Chromebook program, the
  station program, the confinement and read-only units, the pinned state mount, Python, systemd, or
  modules for this kernel.
- **Unsafe content**: storage-destructive tools, `swapon`, firmware/flag tools, udisks, `/etc/fstab`
  entries, modules for other kernels, unsafe kernel command-line words.

`assemble.sh --packaging-test` exists only to test layout and signing with arbitrary inputs. Its output
is named `*-PACKAGING-TEST-NOT-BOOTABLE.img`, says so in `.disk/info`, has `"packaging_test": true`
in its manifest, and is never a release. Relabelling such an image still fails `verify-cb-image.sh`
because the extracted kernel is checked.

## 5. Packaging/signature tests vs boot compatibility

| Evidence | What it shows | What it does **not** show |
|---|---|---|
| `preflight.py` pass | Inputs are structurally complete and built from this kit's config | That the kernel runs on the unit's CPU/chipset |
| Developer-key signature verifies | The kernel blob is well formed and signed with the **public** developer keys | That the firmware will load it, or that it boots. Developer keys are public; anyone can produce such a signature |
| `verify-cb-image.sh` OK | Partition layout, KERN-A attributes, command line, extracted inputs | Anything about the hardware |
| **Boot on the physical unit** | Only this establishes boot compatibility — gate G2 in the plan | — |

The manifest always says `"boot_tested": false`. Only the filled lab checklist changes the status.

## 6. Troubleshooting

| Symptom (log line) | Cause / fix |
|---|---|
| `this root cannot mount filesystems` | Unprivileged container or rootless environment. Use a Debian 13 VM with root |
| `host is …; Debian 13 is required` | Use Debian 13, or `ND_ALLOW_OTHER_HOST=1` (recorded as a deviation; results may differ) |
| `need at least … GiB` | Free disk or add RAM; `ND_MIN_DISK_GB` lowers the disk threshold (logged) |
| `missing host tool: X` | Install the host packages in section 2 |
| debootstrap/apt `404` or signature errors | Snapshot unreachable or proxy interference. Retry; the snapshot date is fixed on purpose |
| `incompatible kernel source` | linux-source and linux-image versions differ in the snapshot; do not mix snapshots |
| `required options lost after olddefconfig: X` | A Debian dependency forces the option to `m` or off. Add the dependency to `kernel/nexwipe-cb.config` (example fixed in this kit: `CONFIG_USB=y`, `CONFIG_USB_XHCI_PCI_RENESAS=n`) |
| `kernel pass 1 failed` | See the last 40 lines printed and `logs/kernel-pass1-*.log`; usually disk full or RAM (lower `JOBS`) |
| `mkinitramfs failed` / `work directory not found` | See `logs/initramfs-*.log`; a missing tool in the hardened rootfs is the usual cause |
| `PREFLIGHT FAILED: …` | The message names the missing component; do not bypass — fix the input |
| `kernel blob … larger than KERN-A` / `WARNING … >16 MiB` | Initramfs too large; trim modules. The warning is about older firmware limits and is unverified |
| After a failure | Rerun with `ROOTFS_READY=1 BUILDER_READY=1` to skip the slow bootstrap stages |

## 7. Limitations

- Only x86-64 Chromebooks whose stock firmware boots developer-signed USB media in Developer Mode.
  Whether SETZER does with this image is **unknown**.
- Not reproducible bit-for-bit across hosts yet (kernel build timestamps); hashes identify a specific build.
- No Wi-Fi firmware has been checked for the target unit; wired USB Ethernet is the fallback.
- The confinement settings and the read-only lock have only been tested on synthetic trees; the
  runtime self-report (`chromebook.confinement`) on the first boot is the real test (`SAFETY.md`).
