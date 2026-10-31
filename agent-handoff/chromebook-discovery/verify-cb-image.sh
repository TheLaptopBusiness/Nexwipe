#!/usr/bin/env bash
# Structural and safety checks for a NexWipe Chromebook discovery image.
#   verify-cb-image.sh <image.img> <devkeys-dir>      check an assembled USB image
#   verify-cb-image.sh --rootfs <rootfs-dir>          check the root filesystem before squashfs
# Image mode re-extracts the kernel and root filesystem FROM THE IMAGE and runs preflight.py on them,
# so a dummy or stock kernel / incomplete rootfs fails here even if it was packaged by other means.
# Passing proves structure and signature only — NOT that the image boots on any Chromebook.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FIRMWARE_TOOLS="flashrom futility crossystem vpd gsctool ectool cgpt mmc chromeos-firmwareupdate chromeos-setgoodkernel chromeos-install dump_fmap gbb_utility vbutil_firmware enable_dev_usb_boot tpmc swapon udisksctl"
fail=0

if [[ "${1:-}" == "--rootfs" ]]; then
  ROOT="${2:?rootfs directory}"
  "$HERE/../usb-image/verify-image.sh" "$ROOT" || fail=1
  for t in $FIRMWARE_TOOLS; do
    for d in usr/bin usr/sbin bin sbin usr/local/bin usr/local/sbin; do
      [[ -e "$ROOT/$d/$t" ]] && { echo "FORBIDDEN tool: /$d/$t"; fail=1; }
    done
  done
  [[ -e "$ROOT/usr/libexec/udisks2/udisksd" ]] && { echo "FORBIDDEN: udisks automounter"; fail=1; }
  [[ -f "$ROOT/opt/nextdrive/nd_chromebook/__main__.py" ]] || { echo "MISSING: nd_chromebook program"; fail=1; }
  grep -q "nd_chromebook" "$ROOT/etc/systemd/system/nd-console.service.d/chromebook.conf" 2>/dev/null || { echo "MISSING: console service override"; fail=1; }
  grep -q "^CapabilityBoundingSet=$" "$ROOT/etc/systemd/system/nd-console.service.d/chromebook.conf" 2>/dev/null || { echo "MISSING: capability confinement"; fail=1; }
  [[ -L "$ROOT/etc/systemd/system/sysinit.target.wants/nd-internal-ro.service" ]] || { echo "MISSING: nd-internal-ro.service not enabled"; fail=1; }
  grep -q "by-partuuid/4e574342-0000-4000-8000-0000000000e3" "$ROOT/etc/systemd/system/var-lib-nextdrive.mount.d/chromebook.conf" 2>/dev/null || { echo "MISSING: state mount pinned to the USB partition"; fail=1; }
  if grep -vE '^\s*(#|$)' "$ROOT/etc/fstab" 2>/dev/null | grep -q .; then echo "FORBIDDEN: /etc/fstab entries"; fail=1; fi
  [[ $fail -eq 0 ]] && echo "verify-cb-image (rootfs): OK"
  exit $fail
fi

IMG="${1:?image}"; DEVKEYS="${2:?devkeys dir}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

[[ "$(cgpt show -i 2 -l "$IMG")" == "KERN-A" ]] || { echo "FAIL: partition 2 is not KERN-A"; fail=1; }
[[ "$(cgpt show -i 2 -t "$IMG" | tr a-z A-Z)" == "FE3A2A5D-4F32-41A7-B725-ACCC3285A309" ]] || { echo "FAIL: partition 2 is not a ChromeOS kernel partition"; fail=1; }
[[ "$(cgpt show -i 2 -S "$IMG")" == "1" ]] || { echo "FAIL: KERN-A not marked successful"; fail=1; }
[[ "$(cgpt show -i 1 -l "$IMG")" == "NEXTDRIVE" && "$(cgpt show -i 3 -l "$IMG")" == "ND-STATE" ]] || { echo "FAIL: data/state partition labels"; fail=1; }
[[ "$(cgpt show -i 3 -u "$IMG" | tr A-Z a-z)" == "4e574342-0000-4000-8000-0000000000e3" ]] || { echo "FAIL: ND-STATE partition UUID"; fail=1; }

dd if="$IMG" of="$W/kern.bin" bs=512 skip="$(cgpt show -i 2 -b "$IMG")" count="$(cgpt show -i 2 -s "$IMG")" status=none
if vbutil_kernel --verify "$W/kern.bin" --signpubkey "$DEVKEYS/kernel_subkey.vbpubk" > "$W/kv.txt" 2>&1; then
  echo "kernel: developer-key signature verifies (structure/signature only - not evidence of boot)"
else
  echo "FAIL: kernel does not verify"; cat "$W/kv.txt"; fail=1
fi
cmdline="$(vbutil_kernel --verify "$W/kern.bin" --verbose 2>/dev/null | sed -n '/^Config:/,$p' | tail -n +2 | tr -d '\0' | head -1)"
echo "cmdline: $cmdline"
for need in "boot=live" "live-media=removable-usb" "live-boot.read-only=/dev/mmcblk*,/dev/nvme*" "noresume" "systemd.swap=0" "systemd.gpt_auto=0" "nofstab" "nopersistence" "nd_profile=chromebook-discovery"; do
  [[ " $cmdline " == *" $need "* ]] || { echo "FAIL: cmdline missing '$need'"; fail=1; }
done
for bad in cros_debug "init=" " rw " " swap " "swap=" "resume=" "persistence " "toram" "todisk"; do
  [[ " $cmdline " == *"$bad"* ]] && { echo "FAIL: cmdline contains '$bad'"; fail=1; }
done

dd if="$IMG" of="$W/data.fat" bs=512 skip="$(cgpt show -i 1 -b "$IMG")" count="$(cgpt show -i 1 -s "$IMG")" status=none
mcopy -i "$W/data.fat" ::/.disk/info "$W/info" 2>/dev/null || { echo "FAIL: .disk/info missing"; fail=1; }
if grep -q "PACKAGING TEST" "$W/info" 2>/dev/null; then
  echo "PACKAGING TEST IMAGE: input checks not applicable; this file is NOT bootable and NOT a release."
  [[ $fail -eq 0 ]] && echo "verify-cb-image (image): layout + signature OK (packaging test only)"
  exit $fail
fi
mcopy -i "$W/data.fat" ::/live/filesystem.squashfs "$W/fs.squashfs" 2>/dev/null || { echo "FAIL: live/filesystem.squashfs missing"; fail=1; }
vbutil_kernel --get-vmlinuz "$W/kern.bin" --vmlinuz-out "$W/vmlinuz" >/dev/null 2>&1 || { echo "FAIL: cannot extract kernel"; fail=1; }
if [[ -f "$W/vmlinuz" && -f "$W/fs.squashfs" ]]; then
  python3 "$HERE/preflight.py" all "$W/vmlinuz" "$W/fs.squashfs" > "$W/pre.json" || { echo "FAIL: kernel/rootfs inside the image refused by preflight.py"; fail=1; }
  [[ $fail -eq 0 ]] && echo "preflight (from image): $(python3 -c "import json;d=json.load(open('$W/pre.json'));print(d['kernel_release'], d['initramfs_entries'], 'initramfs entries,', d['rootfs_entries'], 'rootfs entries')")"
fi

[[ $fail -eq 0 ]] && echo "verify-cb-image (image): OK - structure, signature and inputs. Boot compatibility NOT tested."
exit $fail
