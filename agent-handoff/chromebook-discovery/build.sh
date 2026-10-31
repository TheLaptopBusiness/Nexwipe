#!/usr/bin/env bash
# NexWipe Chromebook discovery image — full build (EXTERNAL BUILD HOST; not run in the web project).
#
# Output: build/nexwipe-chromebook-discovery-<version>.img (+ .sha256, components.sha256)
# Target: x86-64 Chromebooks whose stock firmware boots developer-signed USB media in Developer Mode.
#         First candidate: HP Chromebook 11 G5 / SETZER (candidate only until a physical unit confirms it).
# The image is READ-ONLY toward internal storage: no erasure, trim, format, partition or firmware tools.
#
# Stages
#   A  root filesystem    reuse ../usb-image/build.sh (same pinned Debian snapshot, same deny-list)
#   B  kernel             Debian kernel source + kernel/nexwipe-cb.config, built twice:
#                         pass 1 builds modules and an initramfs (live-boot) for this kernel,
#                         pass 2 embeds that initramfs in bzImage (depthcharge loads no separate initrd)
#   C  image              ./assemble.sh — ChromeOS USB layout, signed with the public developer keys
#
# Host requirements (Debian 13, root, ~25 GB free, 1-2 h on 8 cores):
#   apt install debootstrap squashfs-tools gdisk dosfstools mtools e2fsprogs xxd \
#               build-essential bc bison flex libssl-dev libelf-dev dwarves rsync cpio xz-utils \
#               initramfs-tools-core vboot-kernel-utils vboot-utils
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${ND_OUT:-$HERE/build}"
BASE="$OUT/base"; ROOT="$BASE/rootfs"; KB="$OUT/kernel"
VERSION="$(python3 -c "import sys; sys.path.insert(0,'$HERE'); import nd_chromebook; print(nd_chromebook.VERSION)")"
JOBS="${JOBS:-$(nproc)}"
log() { printf '\n==> %s\n' "$*"; }
in_root() { chroot "$ROOT" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive "$@"; }
mkdir -p "$OUT" "$KB"

# ---------------------------------------------------------------- A: root filesystem
if [[ "${ROOTFS_READY:-0}" != "1" ]]; then
  log "Stage A: root filesystem via usb-image/build.sh (its UEFI laptop image is a by-product and is not used)"
  ND_OUT="$BASE" ND_VARIANT=chromebook-discovery "$HERE/../usb-image/build.sh"
fi
log "Installing the Chromebook discovery program ${VERSION}"
rm -rf "$ROOT/opt/nextdrive/nd_chromebook"
cp -r "$HERE/nd_chromebook" "$ROOT/opt/nextdrive/"
find "$ROOT/opt/nextdrive" -name '__pycache__' -prune -exec rm -rf {} +
cp -r "$HERE/rootfs/." "$ROOT/"
echo "NEXTDRIVE_IMAGE=${VERSION} PROFILE=chromebook-discovery" > "$ROOT/etc/nextdrive/image-release"
python3 - "$ROOT/etc/nextdrive/station.json" "$VERSION" <<'PY'
import json, sys
p, v = sys.argv[1], sys.argv[2]
cfg = json.load(open(p)); cfg["variant"] = "chromebook-discovery"; cfg["image_version"] = v
json.dump(cfg, open(p, "w"), indent=2)
PY

# ---------------------------------------------------------------- B: kernel
DEB_KVER="$(ls "$ROOT/boot" | sed -n 's/^config-//p' | sort -V | tail -1)"   # e.g. 6.12.x-amd64
KSERIES="$(echo "$DEB_KVER" | cut -d. -f1-2)"
if [[ ! -d "$KB/src" ]]; then
  log "Stage B: fetching Debian linux-source-${KSERIES} from the same snapshot"
  mount -t proc proc "$ROOT/proc" 2>/dev/null || true
  in_root apt-get update
  in_root sh -c "cd /tmp && apt-get download linux-source-${KSERIES}"
  umount "$ROOT/proc" 2>/dev/null || true
  mkdir -p "$KB/deb"; mv "$ROOT"/tmp/linux-source-*.deb "$KB/deb/"
  dpkg-deb -x "$KB"/deb/linux-source-*.deb "$KB/deb/x"
  mkdir -p "$KB/src"; tar -xaf "$KB"/deb/x/usr/src/linux-source-*.tar.* -C "$KB/src" --strip-components=1
  sha256sum "$KB"/deb/linux-source-*.deb > "$OUT/kernel-source.sha256"
fi
cd "$KB/src"
cp "$ROOT/boot/config-$DEB_KVER" .config
scripts/kconfig/merge_config.sh -m .config "$HERE/kernel/nexwipe-cb.config"
make olddefconfig
KREL="$(make -s kernelrelease)"
log "Pass 1: kernel ${KREL} + modules"
make -j"$JOBS" bzImage modules
rm -rf "$KB/modroot"; make -s INSTALL_MOD_PATH="$KB/modroot" INSTALL_MOD_STRIP=1 modules_install
rm -rf "$ROOT/lib/modules/$KREL"; cp -a "$KB/modroot/lib/modules/$KREL" "$ROOT/lib/modules/"
rm -rf "$ROOT/lib/modules/$DEB_KVER"
log "Initramfs (initramfs-tools + live-boot) for ${KREL}"
cp .config "$ROOT/boot/config-$KREL"
in_root depmod "$KREL"
in_root update-initramfs -c -k "$KREL"
rm -rf "$KB/initramfs"; mkdir -p "$KB/initramfs"
unmkinitramfs "$ROOT/boot/initrd.img-$KREL" "$KB/initramfs"
INITDIR="$KB/initramfs"; [[ -d "$KB/initramfs/main" ]] && INITDIR="$KB/initramfs/main"
log "Pass 2: embed initramfs in bzImage"
scripts/config --set-str INITRAMFS_SOURCE "$INITDIR"
make olddefconfig
make -j"$JOBS" bzImage
cp arch/x86/boot/bzImage "$OUT/bzImage-$KREL"
cd "$HERE"

log "Verifying the Chromebook root filesystem"
rm -f "$ROOT/boot/initrd.img-"* "$ROOT/boot/vmlinuz-"*
"$HERE/verify-cb-image.sh" --rootfs "$ROOT"

log "Building squashfs"
mksquashfs "$ROOT" "$OUT/filesystem.squashfs" -comp xz -noappend -no-progress -wildcards \
  -e 'proc/*' 'sys/*' 'dev/*' 'run/*' 'tmp/*' 'boot/*' 'var/cache/apt/archives/*.deb' >/dev/null

# ---------------------------------------------------------------- C: image
"$HERE/assemble.sh" --bzimage "$OUT/bzImage-$KREL" --squashfs "$OUT/filesystem.squashfs" --version "$VERSION" --out "$OUT"
