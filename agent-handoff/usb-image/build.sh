#!/usr/bin/env bash
# NextDrive read-only station USB image builder.
#
# Produces build/nextdrive-station-readonly-<version>.img: a GPT disk image with
#   p1  ESP (FAT32)  : signed shim + signed GRUB + Debian kernel/initrd + live/filesystem.squashfs
#   p2  ND-STATE ext4: station credential and metadata (the only writable area)
# Write it to a USB stick with dd/balenaEtcher (see README.md).
#
# Requirements (Debian 13 / Ubuntu 24.04 host, run as root):
#   apt install debootstrap squashfs-tools gdisk dosfstools mtools e2fsprogs xxd
#
# Usage:
#   sudo ./build.sh                       # production image (server address entered on the station)
#   sudo ND_SERVER=https://nextdrive.example.com ./build.sh
#   sudo ND_VARIANT=vm-test ND_SERVER=http://10.0.2.2:8080 ND_ALLOW_HTTP_HOSTS=10.0.2.2 ./build.sh   # QEMU lab only
#   sudo ROOTFS_READY=1 ./build.sh        # reuse build/rootfs (skip debootstrap/apt)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STATION_SRC="$(cd "$HERE/../station" && pwd)"
SNAPSHOT="${SNAPSHOT:-20260913T000000Z}"
SUITE="${SUITE:-trixie}"
MIRROR="https://snapshot.debian.org/archive/debian/${SNAPSHOT}/"
SEC_MIRROR="https://snapshot.debian.org/archive/debian-security/${SNAPSHOT}/"
VERSION="$(python3 -c "import sys; sys.path.insert(0,'$STATION_SRC'); import nd_station; print(nd_station.VERSION)")"
VARIANT="${ND_VARIANT:-production}"
OUT="${ND_OUT:-$HERE/build}"
ROOT="$OUT/rootfs"
IMG="$OUT/nextdrive-station-readonly-${VERSION}-${VARIANT}.img"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(date -d "${SNAPSHOT:0:8}" +%s)}"
ESP_MB=1400
STATE_MB=64

log() { printf '\n==> %s\n' "$*"; }
in_root() { chroot "$ROOT" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive "$@"; }

mkdir -p "$OUT"

if [[ "${ROOTFS_READY:-0}" != "1" ]]; then
  log "Bootstrapping Debian ${SUITE} from snapshot ${SNAPSHOT}"
  rm -rf "$ROOT"
  debootstrap --variant=minbase --include=ca-certificates "$SUITE" "$ROOT" "$MIRROR"
  cat > "$ROOT/etc/apt/sources.list" <<EOF
deb [check-valid-until=no] ${MIRROR} ${SUITE} main non-free-firmware
deb [check-valid-until=no] ${SEC_MIRROR} ${SUITE}-security main non-free-firmware
EOF
  mount -t proc proc "$ROOT/proc" 2>/dev/null || true
  mount -t sysfs sys "$ROOT/sys" 2>/dev/null || true
  trap 'umount "$ROOT/proc" "$ROOT/sys" 2>/dev/null || true' EXIT
  log "Installing pinned packages (packages.txt)"
  in_root apt-get update
  # shellcheck disable=SC2046
  in_root apt-get install -y --no-install-recommends $(grep -vE '^\s*(#|$)' "$HERE/packages.txt" | awk '{print $1"="$2}')
  in_root apt-get clean
fi

log "Recording installed package versions"
in_root dpkg-query -W -f='${Package}\t${Version}\n' | LC_ALL=C sort > "$OUT/installed-packages.txt"

log "Removing tools that can erase, trim, format or partition storage"
while read -r p; do
  [[ -z "$p" || "$p" == \#* ]] && continue
  rm -f "$ROOT$p"
done < "$HERE/remove-destructive.txt"
# Destructive helpers also exist as mkfs.* / mke2fs aliases
find "$ROOT/usr/sbin" "$ROOT/sbin" -maxdepth 1 \( -name 'mkfs*' -o -name 'mke2fs' -o -name 'mkdosfs' \) -exec rm -f {} + 2>/dev/null || true

log "Installing the read-only station program ${VERSION}"
rm -rf "$ROOT/opt/nextdrive"
mkdir -p "$ROOT/opt/nextdrive"
cp -r "$STATION_SRC/nd_station" "$ROOT/opt/nextdrive/"
find "$ROOT/opt/nextdrive" -name '__pycache__' -prune -exec rm -rf {} +
cp -r "$HERE/rootfs/." "$ROOT/"
python3 - "$ROOT/etc/nextdrive/station.json" <<PY
import json, os, sys
cfg = {"server": os.environ.get("ND_SERVER", ""), "allow_http_hosts": [h for h in os.environ.get("ND_ALLOW_HTTP_HOSTS", "").split(",") if h],
       "variant": "${VARIANT}", "image_version": "${VERSION}-${VARIANT}"}
json.dump(cfg, open(sys.argv[1], "w"), indent=2)
PY
echo "nextdrive-station" > "$ROOT/etc/hostname"
echo "NEXTDRIVE_IMAGE=${VERSION}-${VARIANT} SNAPSHOT=${SNAPSHOT}" > "$ROOT/etc/nextdrive/image-release"
in_root systemctl enable nd-console.service NetworkManager.service var-lib-nextdrive.mount >/dev/null
in_root systemctl mask getty@tty1.service serial-getty@ttyS0.service autovt@.service >/dev/null 2>&1 || true
in_root passwd -l root >/dev/null
rm -f "$ROOT/etc/machine-id"; : > "$ROOT/etc/machine-id"
rm -rf "$ROOT/var/lib/apt/lists/"* "$ROOT/var/cache/apt/"*.bin "$ROOT/tmp/"*

log "Verifying the root filesystem contains no destructive storage tools"
"$HERE/verify-image.sh" "$ROOT"

log "Building squashfs"
STAGE="$OUT/esp"
rm -rf "$STAGE"; mkdir -p "$STAGE/live" "$STAGE/EFI/BOOT" "$STAGE/EFI/debian" "$STAGE/boot/grub"
KVER="$(ls "$ROOT/boot" | sed -n 's/^vmlinuz-//p' | sort -V | tail -1)"
cp "$ROOT/boot/vmlinuz-$KVER" "$STAGE/live/vmlinuz"
cp "$ROOT/boot/initrd.img-$KVER" "$STAGE/live/initrd.img"
rm -f "$OUT/filesystem.squashfs"
mksquashfs "$ROOT" "$STAGE/live/filesystem.squashfs" -comp xz -noappend -no-progress \
  -e proc sys dev run tmp boot -mkfs-time "$SOURCE_DATE_EPOCH" -all-time "$SOURCE_DATE_EPOCH" >/dev/null

log "Installing signed boot chain (shim -> GRUB -> kernel)"
cp "$ROOT/usr/lib/shim/shimx64.efi.signed" "$STAGE/EFI/BOOT/BOOTX64.EFI"
cp "$ROOT/usr/lib/shim/mmx64.efi.signed" "$STAGE/EFI/BOOT/mmx64.efi"
cp "$ROOT/usr/lib/grub/x86_64-efi-signed/grubx64.efi.signed" "$STAGE/EFI/BOOT/grubx64.efi"
for d in EFI/BOOT EFI/debian boot/grub; do cp "$HERE/grub.cfg" "$STAGE/$d/grub.cfg"; done
mkdir -p "$STAGE/.disk"; echo "NextDrive read-only station ${VERSION}-${VARIANT}" > "$STAGE/.disk/info"
( cd "$STAGE" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS )

log "Assembling GPT disk image"
rm -f "$IMG" "$OUT/esp.fat" "$OUT/state.ext4"
TOTAL_MB=$((ESP_MB + STATE_MB + 2))
truncate -s "${TOTAL_MB}M" "$IMG"
sgdisk --clear --disk-guid=4E445354-0000-4000-8000-000000000001 \
  -n 1:2048:+${ESP_MB}M -t 1:EF00 -c 1:"NEXTDRIVE" -u 1:4E445354-0000-4000-8000-0000000000E1 \
  -n 2:0:+${STATE_MB}M -t 2:8300 -c 2:"ND-STATE" -u 2:4E445354-0000-4000-8000-0000000000E2 "$IMG" >/dev/null
truncate -s "${ESP_MB}M" "$OUT/esp.fat"
mkfs.vfat -F 32 -n NEXTDRIVE -i 4E445354 "$OUT/esp.fat" >/dev/null
( cd "$STAGE" && mcopy -s -i "$OUT/esp.fat" -m ./* ./.disk ::/ )
truncate -s "${STATE_MB}M" "$OUT/state.ext4"
E2FSPROGS_FAKE_TIME="$SOURCE_DATE_EPOCH" mke2fs -q -t ext4 -L ND-STATE -U 4e445354-0000-4000-8000-0000000057a7 -E root_owner=0:0 "$OUT/state.ext4"
ESP_START=$((2048 * 512)); STATE_START=$(( (2048 + ESP_MB * 2048) * 512 ))
STATE_START=$(sgdisk -i 2 "$IMG" | awk '/First sector/ {print $3 * 512}')
dd if="$OUT/esp.fat" of="$IMG" bs=1M seek=$((ESP_START / 1048576)) conv=notrunc status=none
dd if="$OUT/state.ext4" of="$IMG" bs=512 seek=$((STATE_START / 512)) conv=notrunc status=none
rm -f "$OUT/esp.fat" "$OUT/state.ext4"

log "Checksums"
( cd "$OUT" && sha256sum "$(basename "$IMG")" > "$(basename "$IMG").sha256" && cat "$(basename "$IMG").sha256" )
sha256sum "$STAGE/live/filesystem.squashfs" "$STAGE/live/vmlinuz" "$STAGE/live/initrd.img" | sed "s#$STAGE/##" > "$OUT/components.sha256"
cat "$OUT/components.sha256"
log "Done: $IMG"
