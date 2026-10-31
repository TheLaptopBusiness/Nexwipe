# NextDrive read-only station — bootable USB build package

**Status: built and booted in a virtual machine (QEMU/OVMF, UEFI). Not yet booted on a physical laptop.**
Nothing here can erase a drive. The image contains no erasure, trim, format or partitioning tools (enforced by `verify-image.sh`) and the station program runs only an allow-list of identity-reading commands.

## Contents

| File | Purpose |
|---|---|
| `build.sh` | Reproducible build: Debian 13 snapshot → rootfs → squashfs → GPT USB image with signed boot chain |
| `packages.txt` | Top-level packages with exact versions |
| `installed-packages.txt` | Full installed package closure (194 packages) from the actual build |
| `remove-destructive.txt` | Tools deleted from the image |
| `verify-image.sh` | Build-time check: fails if any destructive storage tool or destructive string is present |
| `grub.cfg` | Boot menu (normal + diagnostics with serial console) |
| `rootfs/` | Overlay: console service on tty1, state-partition mount, logind and NetworkManager settings |
| `CHECKSUMS.txt` | SHA-256 of the images and their kernel/initrd/squashfs |
| `vm-test-evidence/` | Screenshots from the virtual-machine checklist run |
| `../station/` | The read-only station program (`nd_station`) and its tests |

## Image layout

```text
GPT  p1 ESP FAT32 "NEXTDRIVE" (1400 MiB)   EFI/BOOT/BOOTX64.EFI  = Debian shim (Microsoft-signed)
                                           EFI/BOOT/grubx64.efi  = Debian signed GRUB
                                           live/vmlinuz, live/initrd.img (Debian signed kernel, live-boot)
                                           live/filesystem.squashfs (read-only root)
     p2 ext4 "ND-STATE" (64 MiB)           /var/lib/nextdrive: encrypted station credential + metadata
```

UEFI only. Secure Boot works with the stock Microsoft UEFI CA (shim → GRUB → kernel are all signed by Debian). Legacy BIOS boot is not supported.

## Pinned versions

Debian 13 "trixie" from `https://snapshot.debian.org/archive/debian/20260913T000000Z/` (+ the matching security snapshot). Key versions:

| Component | Version |
|---|---|
| Linux kernel | 6.12.107-1 (`linux-image-amd64`) |
| live-boot | 1:20250815~deb13u1 |
| systemd | 257.13-1~deb13u1 |
| Python | 3.13.5-1, python3-cryptography 43.0.0-3+deb13u1 |
| dmidecode / smartmontools | 3.6-2 / 7.4-3 |
| NetworkManager | 1.52.1-1 |
| shim-signed / grub-efi-amd64-signed | 1.51~1+deb13u1+16.1-2~deb13u1 / 1+2.12+9+deb13u2 |
| Firmware (iwlwifi, realtek, misc, intel-misc) | 20250410-2 |
| Station program | nd_station 0.2.0-readonly |

## Build (on a Debian 13 or Ubuntu 24.04 x86-64 machine, as root, ~10 minutes)

```bash
sudo apt install debootstrap squashfs-tools gdisk dosfstools mtools e2fsprogs python3
cd agent-handoff/usb-image
sudo ND_SERVER=https://<your-nextdrive-domain> ./build.sh      # or leave ND_SERVER unset and type it on the station
sha256sum -c build/*.img.sha256
```

Output: `build/nextdrive-station-readonly-0.2.0-readonly-production.img` (1.5 GB raw), `.sha256`, `components.sha256`, `installed-packages.txt`.
`SOURCE_DATE_EPOCH` is pinned to the snapshot date; file systems use fixed UUIDs and timestamps. Byte-for-byte reproducibility across hosts has not been verified yet (initramfs generation embeds host-dependent data).

The lab-only VM build used for testing: `ND_VARIANT=vm-test ND_SERVER=http://10.0.2.2:8080 ND_ALLOW_HTTP_HOSTS=10.0.2.2 ./build.sh`. Never use a vm-test image with a production server — it allows plain HTTP to that one address.

## Write the USB stick

Use a **dedicated** 4 GB+ stick; everything on it is overwritten.

- Linux: `lsblk` to find the stick (e.g. `/dev/sdX`), then `sudo dd if=nextdrive-…-production.img of=/dev/sdX bs=4M conv=fsync status=progress`
- Windows/macOS: balenaEtcher or Rufus ("DD image" mode).
- Verify: re-insert the stick, check that it shows a `NEXTDRIVE` partition. Label the stick physically ("NextDrive station #…").

Run the writing step on your own computer, never on a laptop under test.

## Booting a laptop

| Brand | Boot menu key | BIOS settings to check |
|---|---|---|
| Dell Latitude | F12 | UEFI mode; SATA operation **AHCI** (not RAID On); Secure Boot can stay on |
| HP EliteBook / ProBook | F9 | UEFI mode; Secure Boot can stay on |
| Lenovo ThinkPad | F12 (or Enter → F12) | UEFI only; Intel VMD / RAID **off** if present |

The station screen appears on its own (about 30–60 s). It shows the laptop's identity, every drive (internal drives as INTERNAL, the boot stick as EXCLUDED), connection status and the last successful upload. Keys: **E** enroll, **S** server address, **R** re-scan & upload, **W** Wi-Fi, **L** log, **P** power off. There is no login shell.

## What was tested here (and what was not)

Tested in QEMU 10.1 with OVMF (UEFI), emulated Dell SMBIOS, one NVMe drive, one SATA (AHCI) drive and the image attached as a USB stick, network through QEMU user networking to the NextDrive preview server. See `vm-test-evidence/` and `../PHYSICAL_TEST_CHECKLIST.md` (VM column). **Not tested:** any physical laptop, Secure Boot enabled, Wi-Fi, real Dell/HP/Lenovo firmware, real SATA/NVMe drive identity strings, USB boot on real hardware.

Note for reproducing this environment: this build was produced inside a restricted container where `mount` is not permitted, so the bootstrap stage ran with a manual workaround (device nodes created with `mknod`, debootstrap second stage run via `chroot`). `build.sh` itself does the normal thing on a regular Linux host.
