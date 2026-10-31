#!/usr/bin/env bash
# NexWipe Chromebook discovery image — full build. Read BUILD.md first.
#
#   sudo ./build.sh                 (Debian 13 amd64 host or VM, root, network access)
#
# Output (in build/, or $ND_OUT):
#   nexwipe-chromebook-discovery-<version>.img          raw USB image
#   nexwipe-chromebook-discovery-<version>.img.xz       compressed copy
#   nexwipe-chromebook-discovery-<version>.manifest.json  versions, hashes, preflight result, boot_tested=false
#   SHA256SUMS                                           all outputs
#   logs/build-<UTC>.log, logs/kernel-pass1-<UTC>.log, logs/kernel-pass2-<UTC>.log, logs/initramfs-<UTC>.log
#
# The image is READ-ONLY toward internal storage. Passing this build proves structure, signature and
# input completeness ONLY. It does not show that the image boots on any Chromebook.
#
# Stages
#   0  host checks      Debian 13 amd64, root that can mount, RAM, disk, tools; versions logged
#   A  root filesystem  ../usb-image/build.sh (pinned Debian snapshot, storage-tool deny-list), then the
#                       Chromebook overlay (program, confinement, read-only lock, pinned state mount)
#   B  kernel           built in a separate Debian 13 builder chroot from linux-source of the SAME
#                       Debian kernel version as the root filesystem, + kernel/nexwipe-cb.config;
#                       pass 1: modules + initramfs (live-boot); pass 2: initramfs built into bzImage
#   C  image            preflight.py, squashfs, assemble.sh (ChromeOS USB layout, public developer keys)
#
# Environment: ND_OUT, JOBS, SNAPSHOT (Debian snapshot), ROOTFS_READY=1 / BUILDER_READY=1 (reuse a
# previous stage A / builder chroot), ND_ALLOW_OTHER_HOST=1 (non-Debian-13 host; logged as a deviation).
set -Eeuo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${ND_OUT:-$HERE/build}"
BASE="$OUT/base"; ROOT="$BASE/rootfs"; BUILDER="$OUT/builder"
SNAPSHOT="${SNAPSHOT:-20260913T000000Z}"; SUITE=trixie
MIRROR="https://snapshot.debian.org/archive/debian/${SNAPSHOT}/"
SEC_MIRROR="https://snapshot.debian.org/archive/debian-security/${SNAPSHOT}/"
VERSION="$(python3 -c "import sys; sys.path.insert(0,'$HERE'); import nd_chromebook; print(nd_chromebook.VERSION)")"
JOBS="${JOBS:-$(nproc)}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT/logs"
LOG="$OUT/logs/build-$TS.log"
exec > >(tee -a "$LOG") 2>&1
STAGE="0-host"
trap 'rc=$?; echo; echo "RESULT: FAILED in stage $STAGE (line $LINENO, exit $rc). See $LOG and BUILD.md > Troubleshooting."; exit $rc' ERR
BUILDER_PKGS="build-essential bc bison flex libssl-dev libelf-dev cpio xz-utils kmod rsync python3 initramfs-tools-core"

log() { printf '\n==> [%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { echo "ERROR: $*" >&2; false; }
in_root() { chroot "$ROOT" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive "$@"; }
in_builder() { chroot "$BUILDER" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive "$@"; }
mounted=()
mnt() { mount "$@" && mounted+=("${@: -1}"); }
cleanup() { for ((i=${#mounted[@]}-1; i>=0; i--)); do umount "${mounted[$i]}" 2>/dev/null || true; done; }
trap cleanup EXIT

# ------------------------------------------------------------------ 0: host
log "Stage 0: host checks (NexWipe Chromebook discovery ${VERSION}, snapshot ${SNAPSHOT})"
[[ $(id -u) -eq 0 ]] || die "run as root (sudo): debootstrap, chroot and loop-free mounts of proc/sys need it"
[[ $(uname -m) == x86_64 ]] || die "host must be x86-64 (amd64); found $(uname -m)"
. /etc/os-release 2>/dev/null || true
if [[ "${ID:-}" != debian || "${VERSION_ID:-}" != 13 ]]; then
  [[ "${ND_ALLOW_OTHER_HOST:-0}" == 1 ]] || die "host is ${PRETTY_NAME:-unknown}; Debian 13 is required (ND_ALLOW_OTHER_HOST=1 to override; logged)"
  echo "DEVIATION: building on ${PRETTY_NAME:-unknown host} (ND_ALLOW_OTHER_HOST=1)"
fi
MEM_GB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1048576 ))
DISK_GB=$(df --output=avail -B1G "$OUT" | tail -1 | tr -d ' ')
echo "host: $(uname -srm); cpus=$(nproc) jobs=$JOBS mem=${MEM_GB}GiB free_disk=${DISK_GB}GiB"
[[ $MEM_GB -ge 7 ]] || die "need at least 8 GiB RAM (found ${MEM_GB})"
[[ $DISK_GB -ge ${ND_MIN_DISK_GB:-30} ]] || die "need at least ${ND_MIN_DISK_GB:-30} GiB free in $OUT (found ${DISK_GB})"
for t in debootstrap chroot mksquashfs unsquashfs sgdisk mkfs.vfat mcopy mmd mdir mke2fs vbutil_kernel cgpt python3 xz sha256sum mount; do
  p=$(command -v "$t") || die "missing host tool: $t (see BUILD.md > Host packages)"
  v=$(dpkg-query -W -f='${Package} ${Version}' "$(dpkg-query -S "$(readlink -f "$p")" 2>/dev/null | head -1 | cut -d: -f1)" 2>/dev/null || "$t" --version 2>&1 | head -1 || true)
  echo "tool: $t -> ${v:-unknown version}"
done
probe="$OUT/.mount-probe"; mkdir -p "$probe"
mount -t tmpfs nexwipe-probe "$probe" 2>/dev/null && umount "$probe" || die "this root cannot mount filesystems (unprivileged container?) - use a VM, see BUILD.md"
rmdir "$probe"

# ------------------------------------------------------------------ A: root filesystem
STAGE="A-rootfs"
log "Stage A: root filesystem via ../usb-image/build.sh (ROOTFS_READY=${ROOTFS_READY:-0})"
ROOTFS_READY="${ROOTFS_READY:-0}" ND_OUT="$BASE" ND_VARIANT=chromebook-discovery SNAPSHOT="$SNAPSHOT" "$HERE/../usb-image/build.sh"
rm -f "$BASE"/nexwipe-station-readonly-*.img "$BASE"/nexwipe-station-readonly-*.img.sha256   # laptop by-product, not used
log "Chromebook overlay: program ${VERSION}, confinement, read-only lock, pinned state mount"
rm -rf "$ROOT/opt/nextdrive/nd_chromebook"
cp -r "$HERE/nd_chromebook" "$ROOT/opt/nextdrive/"
find "$ROOT/opt/nextdrive" -name '__pycache__' -prune -exec rm -rf {} +
cp -r "$HERE/rootfs/." "$ROOT/"
chmod 0755 "$ROOT/usr/local/sbin/nd-internal-ro"
rm -f "$ROOT/usr/sbin/swapon" "$ROOT/sbin/swapon"
printf '# NexWipe Chromebook discovery: intentionally empty (no internal filesystems, no swap)\n' > "$ROOT/etc/fstab"
echo "NEXTDRIVE_IMAGE=${VERSION} PROFILE=chromebook-discovery SNAPSHOT=${SNAPSHOT}" > "$ROOT/etc/nextdrive/image-release"
python3 - "$ROOT/etc/nextdrive/station.json" "$VERSION" <<'PY'
import json, sys
p, v = sys.argv[1], sys.argv[2]
cfg = json.load(open(p)); cfg["variant"] = "chromebook-discovery"; cfg["image_version"] = v
json.dump(cfg, open(p, "w"), indent=2)
PY
in_root systemctl enable nd-internal-ro.service >/dev/null
"$HERE/verify-cb-image.sh" --rootfs "$ROOT"

# ------------------------------------------------------------------ B: kernel
STAGE="B-builder"
if [[ "${BUILDER_READY:-0}" != 1 ]]; then
  log "Stage B: builder chroot (Debian ${SUITE}, snapshot ${SNAPSHOT})"
  rm -rf "$BUILDER"
  debootstrap --variant=minbase "$SUITE" "$BUILDER" "$MIRROR"
  printf 'deb [check-valid-until=no] %s %s main\ndeb [check-valid-until=no] %s %s-security main\n' "$MIRROR" "$SUITE" "$SEC_MIRROR" "$SUITE" > "$BUILDER/etc/apt/sources.list"
fi
mnt -t proc proc "$BUILDER/proc"; mnt -t sysfs sys "$BUILDER/sys"
mnt -t proc proc "$ROOT/proc"; mnt -t sysfs sys "$ROOT/sys"
DEB_KVER="$(ls "$ROOT/boot" | sed -n 's/^config-//p' | grep -v nexwipe | sort -V | tail -1)"
[[ -n "$DEB_KVER" ]] || die "no Debian kernel config in the root filesystem (/boot/config-*)"
KSERIES="$(echo "$DEB_KVER" | cut -d. -f1-2)"
IMG_PKG_VER="$(in_root dpkg-query -W -f='${Version}' "linux-image-$DEB_KVER")"
if [[ "${BUILDER_READY:-0}" != 1 ]]; then
  in_builder apt-get update
  # shellcheck disable=SC2086
  in_builder apt-get install -y --no-install-recommends $BUILDER_PKGS "linux-source-${KSERIES}=${IMG_PKG_VER}"
  in_builder apt-get clean
fi
SRC_VER="$(in_builder dpkg-query -W -f='${Version}' "linux-source-${KSERIES}")"
echo "kernel: root filesystem has linux-image-${DEB_KVER} ${IMG_PKG_VER}; builder has linux-source-${KSERIES} ${SRC_VER}"
[[ "$SRC_VER" == "$IMG_PKG_VER" ]] || die "incompatible kernel source: linux-source ${SRC_VER} != linux-image ${IMG_PKG_VER}"
in_builder dpkg-query -W -f='${Package}\t${Version}\n' | LC_ALL=C sort > "$OUT/builder-packages.txt"

STAGE="B-kernel-pass1"
log "Kernel source and config"
rm -rf "$BUILDER/build"; mkdir -p "$BUILDER/build/linux"
tar -xaf "$BUILDER"/usr/src/linux-source-"${KSERIES}".tar.* -C "$BUILDER/build/linux" --strip-components=1
cp "$ROOT/boot/config-$DEB_KVER" "$BUILDER/build/linux/.config"
cp "$HERE/kernel/nexwipe-cb.config" "$BUILDER/build/nexwipe-cb.config"
in_builder sh -c 'cd /build/linux && scripts/kconfig/merge_config.sh -m .config /build/nexwipe-cb.config >/dev/null && make olddefconfig >/dev/null'
python3 - "$BUILDER/build/linux/.config" "$HERE/preflight.py" <<'PY'
import re, sys, importlib.util
cfg = dict(re.findall(r"^(CONFIG_\w+)=(.*)$", open(sys.argv[1]).read(), re.M))
spec = importlib.util.spec_from_file_location("preflight", sys.argv[2]); pf = importlib.util.module_from_spec(spec); spec.loader.exec_module(pf)
bad = [f"{k}={cfg.get(k, 'unset')}" for k, want in pf.REQUIRED_KCONFIG.items() if (cfg.get(k) not in ("y", "m") if want is None else cfg.get(k) != want)]
if bad:
    sys.exit("kernel config: required options lost after olddefconfig: " + ", ".join(bad))
print("kernel config: all required options present")
PY
KREL="$(in_builder sh -c 'cd /build/linux && make -s kernelrelease')"
log "Pass 1: kernel ${KREL} + modules (log: logs/kernel-pass1-$TS.log)"
in_builder sh -c "cd /build/linux && make -j$JOBS bzImage modules" > "$OUT/logs/kernel-pass1-$TS.log" 2>&1 \
  || { tail -40 "$OUT/logs/kernel-pass1-$TS.log"; die "kernel pass 1 failed"; }
in_builder sh -c "cd /build/linux && rm -rf /build/modroot && make -s INSTALL_MOD_PATH=/build/modroot INSTALL_MOD_STRIP=1 modules_install" >> "$OUT/logs/kernel-pass1-$TS.log" 2>&1

STAGE="B-initramfs"
log "Installing modules for ${KREL}; removing the Debian kernel ${DEB_KVER} from the root filesystem"
MODSRC="$BUILDER/build/modroot/lib/modules/$KREL"; [[ -d "$MODSRC" ]] || MODSRC="$BUILDER/build/modroot/usr/lib/modules/$KREL"
rm -rf "$ROOT/usr/lib/modules/"*
cp -a "$MODSRC" "$ROOT/usr/lib/modules/$KREL"
rm -f "$ROOT/boot/"*
cp "$BUILDER/build/linux/.config" "$ROOT/boot/config-$KREL"
in_root depmod "$KREL"
log "Initramfs (initramfs-tools + live-boot) for ${KREL} (log: logs/initramfs-$TS.log)"
in_root mkinitramfs -k -o /tmp/nexwipe-initrd.img "$KREL" > "$OUT/logs/initramfs-$TS.log" 2>&1 || { cat "$OUT/logs/initramfs-$TS.log"; die "mkinitramfs failed"; }
WORK="$(grep -o '/var/tmp/mkinitramfs_[A-Za-z0-9]*' "$OUT/logs/initramfs-$TS.log" | head -1)"
[[ -n "$WORK" && -f "$ROOT$WORK/init" ]] || { cat "$OUT/logs/initramfs-$TS.log"; die "mkinitramfs work directory not found"; }
rm -rf "$BUILDER/build/initramfs"; cp -a "$ROOT$WORK" "$BUILDER/build/initramfs"
rm -rf "$ROOT$WORK" "$ROOT"/var/tmp/mkinitramfs* "$ROOT/tmp/nexwipe-initrd.img" "$ROOT/boot/"*
printf 'dir /dev 0755 0 0\nnod /dev/console 0600 0 0 c 5 1\n' > "$BUILDER/build/initramfs-extra.list"

STAGE="B-kernel-pass2"
log "Pass 2: built-in initramfs (log: logs/kernel-pass2-$TS.log)"
in_builder sh -c "cd /build/linux && scripts/config --set-str INITRAMFS_SOURCE '/build/initramfs /build/initramfs-extra.list' && make olddefconfig >/dev/null && make -j$JOBS bzImage" \
  > "$OUT/logs/kernel-pass2-$TS.log" 2>&1 || { tail -40 "$OUT/logs/kernel-pass2-$TS.log"; die "kernel pass 2 failed"; }
cp "$BUILDER/build/linux/arch/x86/boot/bzImage" "$OUT/bzImage-$KREL"
cp "$BUILDER/build/linux/.config" "$OUT/kernel-config-$KREL"
for m in "${mounted[@]}"; do :; done
cleanup; mounted=()

# ------------------------------------------------------------------ C: image
STAGE="C-image"
log "Verifying the Chromebook root filesystem"
"$HERE/verify-cb-image.sh" --rootfs "$ROOT"
log "Building squashfs"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(date -d "${SNAPSHOT:0:8}" +%s)}"
rm -f "$OUT/filesystem.squashfs"
mksquashfs "$ROOT" "$OUT/filesystem.squashfs" -comp xz -noappend -no-progress -wildcards \
  -e 'proc/*' 'sys/*' 'dev/*' 'run/*' 'tmp/*' 'boot/*' 'var/cache/apt/archives/*.deb' \
  -mkfs-time "$SOURCE_DATE_EPOCH" -all-time "$SOURCE_DATE_EPOCH" >/dev/null
"$HERE/assemble.sh" --bzimage "$OUT/bzImage-$KREL" --squashfs "$OUT/filesystem.squashfs" --version "$VERSION" --out "$OUT"
IMG="nexwipe-chromebook-discovery-${VERSION}.img"
log "Compressing"
xz -T0 -9 -k -f "$OUT/$IMG"
( cd "$OUT" && sha256sum "$IMG" "$IMG.xz" "nexwipe-chromebook-discovery-${VERSION}.manifest.json" "bzImage-$KREL" filesystem.squashfs "kernel-config-$KREL" > SHA256SUMS && cat SHA256SUMS )
STAGE="done"
echo
echo "RESULT: BUILT ${IMG} (kernel ${KREL}). Structure, signature and input checks passed."
echo "NOT BOOT-TESTED: no Chromebook has booted this image. Compatibility stays unverified until the lab checklist is done."
