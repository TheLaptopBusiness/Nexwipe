#!/usr/bin/env bash
# Stage C of the NexWipe Chromebook discovery build: package a kernel and a live root filesystem
# into a USB image in the ChromeOS removable-media layout, signed with the PUBLIC ChromeOS
# developer keys. Stock Chromebook firmware boots such media only after the technician has put the
# unit into Developer Mode and allowed USB boot. This script writes only to files under $OUT.
#
# Layout (GPT):
#   p1  NEXTDRIVE  FAT32   live/filesystem.squashfs  (live-boot finds it by path)
#   p2  KERN-A     ChromeOS kernel partition (vboot kernel blob: bzImage with built-in initramfs + cmdline)
#   p3  ND-STATE   ext4    station credential and metadata (the only writable area)
#
# Usage:
#   ./assemble.sh --bzimage PATH --squashfs PATH [--version V] [--out DIR] [--devkeys DIR]
# Requires: vbutil_kernel + cgpt (vboot-utils / vboot-kernel-utils), sgdisk, mtools, dosfstools, e2fsprogs.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(python3 -c "import sys; sys.path.insert(0,'$HERE'); import nd_chromebook; print(nd_chromebook.VERSION)")"
OUT="$HERE/build"; BZ=""; SQ=""; DEVKEYS="${DEVKEYS:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bzimage) BZ="$2"; shift 2;;
    --squashfs) SQ="$2"; shift 2;;
    --version) VERSION="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --devkeys) DEVKEYS="$2"; shift 2;;
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

export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1757721600}"
IMG="$OUT/nexwipe-chromebook-discovery-${VERSION}.img"
DATA_MB=$(( $(stat -c %s "$SQ") / 1048576 + 64 )); KERN_MB=32; STATE_MB=64
mkdir -p "$OUT"; W="$OUT/work"; rm -rf "$W"; mkdir -p "$W"

log() { printf '\n==> %s\n' "$*"; }

log "Kernel command line"
# No root=: live-boot (inside the built-in initramfs) mounts live/filesystem.squashfs read-only.
# nd_profile tells the image which program to start. Nothing here enables firmware or storage writes.
echo "boot=live live-media-path=/live components quiet loglevel=3 nopersistence noeject nofstab console=tty1 nd_profile=chromebook-discovery" > "$W/cmdline"
cat "$W/cmdline"

log "Signing kernel with the public developer keys (developer-mode boot only)"
dd if=/dev/zero of="$W/bootloader.bin" bs=512 count=1 status=none
vbutil_kernel --pack "$W/kern.bin" --keyblock "$DEVKEYS/kernel.keyblock" --signprivate "$DEVKEYS/kernel_data_key.vbprivk" \
  --version 1 --vmlinuz "$BZ" --config "$W/cmdline" --bootloader "$W/bootloader.bin" --arch x86 >/dev/null
[[ $(stat -c %s "$W/kern.bin") -lt $((KERN_MB * 1048576)) ]] || { echo "kernel blob larger than KERN-A" >&2; exit 1; }

log "Data partition"
truncate -s "${DATA_MB}M" "$W/data.fat"
mkfs.vfat -F 32 -n NEXTDRIVE -i 4E574342 "$W/data.fat" >/dev/null
mmd -i "$W/data.fat" ::/live ::/.disk
mcopy -i "$W/data.fat" -m "$SQ" ::/live/filesystem.squashfs
echo "NexWipe Chromebook discovery ${VERSION} (read-only)" > "$W/info"; mcopy -i "$W/data.fat" -m "$W/info" ::/.disk/info

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

log "Verifying"
"$HERE/verify-cb-image.sh" "$IMG" "$DEVKEYS"

log "Checksums"
( cd "$OUT" && sha256sum "$(basename "$IMG")" > "$(basename "$IMG").sha256" && cat "$(basename "$IMG").sha256" )
sha256sum "$BZ" "$SQ" "$W/kern.bin" | sed "s#$(dirname "$BZ")/##; s#$(dirname "$SQ")/##; s#$W/##" > "$OUT/components.sha256"
rm -rf "$W"
log "Done: $IMG"
