#!/usr/bin/env bash
# Stage C of the NexWipe Chromebook discovery build: package a kernel and a live root filesystem into
# a USB image in the ChromeOS removable-media layout, signed with the PUBLIC ChromeOS developer keys.
# Writes only to files under --out.
#
# A valid developer-key signature only means the kernel blob is well formed and signed with the
# public developer keys. It is NOT evidence that the image boots on any Chromebook.
#
# Layout (GPT):
#   p1  NEXTDRIVE  FAT32   live/filesystem.squashfs
#   p2  KERN-A     ChromeOS kernel partition (bzImage with built-in initramfs + command line)
#   p3  ND-STATE   ext4    station credential (the only writable area; fixed partition UUID)
#
# Usage:
#   ./assemble.sh --bzimage PATH --squashfs PATH [--version V] [--out DIR] [--devkeys DIR]
#   ./assemble.sh --packaging-test --bzimage ANY --squashfs ANY ...   layout/signature test ONLY:
#        skips input checks, names the file *-PACKAGING-TEST-NOT-BOOTABLE.img, never a release.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(python3 -c "import sys; sys.path.insert(0,'$HERE'); import nd_chromebook; print(nd_chromebook.VERSION)")"
OUT="$HERE/build"; BZ=""; SQ=""; DEVKEYS="${DEVKEYS:-}"; PTEST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bzimage) BZ="$2"; shift 2;;
    --squashfs) SQ="$2"; shift 2;;
    --version) VERSION="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --devkeys) DEVKEYS="$2"; shift 2;;
    --packaging-test) PTEST=1; shift;;
    *) echo "unknown argument $1" >&2; exit 2;;
  esac
done
[[ -f "$BZ" && -f "$SQ" ]] || { echo "need --bzimage and --squashfs" >&2; exit 2; }
if [[ -z "$DEVKEYS" ]]; then
  for d in /usr/share/vboot/devkeys "$(dirname "$(command -v vbutil_kernel)")/../share/vboot/devkeys"; do
    [[ -f "$d/kernel.keyblock" ]] && DEVKEYS="$d" && break
  done
fi
[[ -f "$DEVKEYS/kernel.keyblock" ]] || { echo "ChromeOS developer keys not found (pass --devkeys)" >&2; exit 2; }

log() { printf '\n==> %s\n' "$*"; }
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1757721600}"
if [[ $PTEST -eq 1 ]]; then
  NAME="nexwipe-chromebook-discovery-${VERSION}-PACKAGING-TEST-NOT-BOOTABLE"
  INFO="PACKAGING TEST ONLY - NOT BOOTABLE - not a NexWipe release (${VERSION})"
  log "PACKAGING TEST: input checks skipped; output is not a bootable image"
  PRE='{"packaging_test": true}'
else
  NAME="nexwipe-chromebook-discovery-${VERSION}"
  INFO="NexWipe Chromebook discovery ${VERSION} (read-only)"
  log "Input checks (preflight.py)"
  PRE="$(python3 "$HERE/preflight.py" all "$BZ" "$SQ")" || { echo "assemble: inputs refused by preflight.py" >&2; exit 1; }
  echo "$PRE"
fi
IMG="$OUT/$NAME.img"
DATA_MB=$(( $(stat -c %s "$SQ") / 1048576 + 64 )); KERN_MB=32; STATE_MB=64
mkdir -p "$OUT"; W="$OUT/work"; rm -rf "$W"; mkdir -p "$W"

log "Kernel command line"
# live-media=removable-usb : live-boot only looks for the live medium on removable USB devices and
#                            never falls back to probing (mounting) internal storage.
# live-boot.read-only=...  : live-boot sets internal eMMC/NVMe read-only (BLKROSET) before searching.
# noresume, systemd.swap=0, systemd.gpt_auto=0 : no hibernation resume, no swap units, no auto-mounts.
cat > "$W/cmdline" <<'EOF'
boot=live live-media=removable-usb live-media-path=/live live-boot.read-only=/dev/mmcblk*,/dev/nvme* components nopersistence noeject nofstab noresume systemd.swap=0 systemd.gpt_auto=0 quiet loglevel=3 console=tty1 nd_profile=chromebook-discovery
EOF
tr -d '\n' < "$W/cmdline" > "$W/cmdline.1" && mv "$W/cmdline.1" "$W/cmdline"; cat "$W/cmdline"; echo

log "Signing kernel with the public developer keys (developer-mode boot only; not proof of boot)"
dd if=/dev/zero of="$W/bootloader.bin" bs=512 count=1 status=none
vbutil_kernel --pack "$W/kern.bin" --keyblock "$DEVKEYS/kernel.keyblock" --signprivate "$DEVKEYS/kernel_data_key.vbprivk" \
  --version 1 --vmlinuz "$BZ" --config "$W/cmdline" --bootloader "$W/bootloader.bin" --arch x86 >/dev/null 2>"$W/pack.err" \
  || { cat "$W/pack.err" >&2; exit 1; }
KSIZE=$(stat -c %s "$W/kern.bin")
[[ $KSIZE -lt $((KERN_MB * 1048576)) ]] || { echo "kernel blob ($KSIZE bytes) larger than KERN-A" >&2; exit 1; }
if [[ $KSIZE -gt $((16 * 1048576)) ]]; then
  echo "WARNING: kernel blob is $KSIZE bytes (>16 MiB). Older Chromebook firmware may not load kernels this large - unverified until booted."
fi

log "Data partition"
truncate -s "${DATA_MB}M" "$W/data.fat"
mkfs.vfat -F 32 -n NEXTDRIVE -i 4E574342 "$W/data.fat" >/dev/null
mmd -i "$W/data.fat" ::/live ::/.disk
mcopy -i "$W/data.fat" -m "$SQ" ::/live/filesystem.squashfs
echo "$INFO" > "$W/info"; mcopy -i "$W/data.fat" -m "$W/info" ::/.disk/info

log "State partition"
truncate -s "${STATE_MB}M" "$W/state.ext4"
E2FSPROGS_FAKE_TIME="$SOURCE_DATE_EPOCH" mke2fs -q -t ext4 -L ND-STATE -U 4e574342-0000-4000-8000-0000000057a7 -E root_owner=0:0 "$W/state.ext4"

log "GPT image"
rm -f "$IMG"
truncate -s $(( (DATA_MB + KERN_MB + STATE_MB + 2) * 1048576 )) "$IMG"
sgdisk --clear --disk-guid=4E574342-0000-4000-8000-000000000001 \
  -n 1:2048:+${DATA_MB}M -t 1:0700 -c 1:NEXTDRIVE -u 1:4E574342-0000-4000-8000-0000000000D1 \
  -n 2:0:+${KERN_MB}M -t 2:FE3A2A5D-4F32-41A7-B725-ACCC3285A309 -c 2:KERN-A -u 2:4E574342-0000-4000-8000-0000000000C2 \
  -n 3:0:+${STATE_MB}M -t 3:8300 -c 3:ND-STATE -u 3:4E574342-0000-4000-8000-0000000000E3 "$IMG" >/dev/null
cgpt add -i 2 -P 15 -T 15 -S 1 "$IMG"
start() { cgpt show -i "$1" -b "$IMG"; }
dd if="$W/data.fat" of="$IMG" bs=512 seek="$(start 1)" conv=notrunc status=none
dd if="$W/kern.bin" of="$IMG" bs=512 seek="$(start 2)" conv=notrunc status=none
dd if="$W/state.ext4" of="$IMG" bs=512 seek="$(start 3)" conv=notrunc status=none

log "Verifying the assembled image"
"$HERE/verify-cb-image.sh" "$IMG" "$DEVKEYS"

log "Checksums and manifest"
( cd "$OUT" && sha256sum "$(basename "$IMG")" > "$(basename "$IMG").sha256" && cat "$(basename "$IMG").sha256" )
python3 - "$OUT/$NAME.manifest.json" "$VERSION" "$PTEST" "$PRE" "$IMG" "$BZ" "$SQ" "$W/kern.bin" "$W/cmdline" <<'PY'
import hashlib, json, sys
out, version, ptest, pre, img, bz, sq, kern, cmdline = sys.argv[1:]
h = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
json.dump({
    "image": img.rsplit("/", 1)[-1], "version": version, "packaging_test": ptest == "1",
    "sha256": {"image": h(img), "bzImage": h(bz), "filesystem.squashfs": h(sq), "kern.bin": h(kern)},
    "cmdline": open(cmdline).read().strip(), "preflight": json.loads(pre),
    "signed_with": "public ChromeOS developer keys (developer mode only)",
    "boot_tested": False,
    "boot_note": "Structure and signature checks only. Booting on any Chromebook has not been tested.",
}, open(out, "w"), indent=2)
PY
rm -rf "$W"
log "Done: $IMG"
[[ $PTEST -eq 1 ]] && echo "PACKAGING TEST ONLY - this file is not bootable and is not a NexWipe release."
echo "NOT BOOT-TESTED: boot compatibility is unknown until the image is booted on a physical unit."
