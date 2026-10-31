#!/usr/bin/env bash
# Fails if the station root filesystem contains storage-destructive tools or the station program
# contains destructive command strings. Usage: verify-image.sh <rootfs-dir>
set -euo pipefail
ROOT="${1:?rootfs directory}"
fail=0
for t in blkdiscard blkzone fstrim wipefs mkfs mkswap fdisk sfdisk cfdisk sgdisk parted mke2fs debugfs resize2fs tune2fs badblocks \
         e2image hdparm sdparm nvme sg_sanitize sg_format sg_raw sg_write_same dd shred cryptsetup; do
  for d in usr/bin usr/sbin bin sbin usr/local/bin usr/local/sbin; do
    if [[ -e "$ROOT/$d/$t" ]]; then echo "FORBIDDEN: /$d/$t"; fail=1; fi
  done
done
if compgen -G "$ROOT/usr/sbin/mkfs.*" >/dev/null || compgen -G "$ROOT/sbin/mkfs.*" >/dev/null; then echo "FORBIDDEN: mkfs.* present"; fail=1; fi
if grep -rEn --include='*.py' '"(sanitize|format|secure-erase|security-erase|write-zeroes|write_same)"|O_DIRECT|blkdiscard|BLKDISCARD|BLKSECDISCARD' "$ROOT/opt/nextdrive" ; then
  echo "FORBIDDEN: destructive strings in station program"; fail=1
fi
# The station must not mount block devices or run a shell for the user.
if grep -rEn --include='*.py' '\b(mount|umount)\b\s*\(' "$ROOT/opt/nextdrive"; then echo "FORBIDDEN: mount calls"; fail=1; fi
[[ $fail -eq 0 ]] && echo "verify-image: OK (no destructive storage tools; station program clean)"
exit $fail
