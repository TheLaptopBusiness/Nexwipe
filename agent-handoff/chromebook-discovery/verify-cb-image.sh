#!/usr/bin/env bash
# Structural and safety checks for a NexWipe Chromebook discovery image.
#   verify-cb-image.sh <image.img> <devkeys-dir>      checks the assembled USB image
#   verify-cb-image.sh --rootfs <rootfs-dir>          checks the root filesystem before squashfs
# Fails on: storage-destructive tools (station deny-list), firmware/flag tools, missing Chromebook
# program, kernel not verifiable with the developer keys, wrong partition layout or command line.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FIRMWARE_TOOLS="flashrom futility crossystem vpd gsctool ectool cgpt mmc chromeos-firmwareupdate chromeos-setgoodkernel chromeos-install dump_fmap gbb_utility vbutil_firmware enable_dev_usb_boot tpmc"
fail=0

if [[ "${1:-}" == "--rootfs" ]]; then
  ROOT="${2:?rootfs directory}"
  "$HERE/../usb-image/verify-image.sh" "$ROOT" || fail=1
  for t in $FIRMWARE_TOOLS; do
    for d in usr/bin usr/sbin bin sbin usr/local/bin usr/local/sbin; do
      [[ -e "$ROOT/$d/$t" ]] && { echo "FORBIDDEN firmware/flag tool: /$d/$t"; fail=1; }
    done
  done
  [[ -f "$ROOT/opt/nextdrive/nd_chromebook/__main__.py" ]] || { echo "MISSING: nd_chromebook program"; fail=1; }
  grep -q "nd_chromebook" "$ROOT/etc/systemd/system/nd-console.service.d/chromebook.conf" 2>/dev/null || { echo "MISSING: console service override"; fail=1; }
  [[ $fail -eq 0 ]] && echo "verify-cb-image (rootfs): OK"
  exit $fail
fi

IMG="${1:?image}"; DEVKEYS="${2:?devkeys dir}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

[[ "$(cgpt show -i 2 -l "$IMG")" == "KERN-A" ]] || { echo "FAIL: partition 2 is not KERN-A"; fail=1; }
[[ "$(cgpt show -i 2 -t "$IMG" | tr a-z A-Z)" == "FE3A2A5D-4F32-41A7-B725-ACCC3285A309" ]] || { echo "FAIL: partition 2 is not a ChromeOS kernel partition"; fail=1; }
[[ "$(cgpt show -i 2 -S "$IMG")" == "1" ]] || { echo "FAIL: KERN-A not marked successful"; fail=1; }
[[ "$(cgpt show -i 1 -l "$IMG")" == "NEXTDRIVE" && "$(cgpt show -i 3 -l "$IMG")" == "ND-STATE" ]] || { echo "FAIL: data/state partition labels"; fail=1; }

dd if="$IMG" of="$W/kern.bin" bs=512 skip="$(cgpt show -i 2 -b "$IMG")" count="$(cgpt show -i 2 -s "$IMG")" status=none
if vbutil_kernel --verify "$W/kern.bin" --signpubkey "$DEVKEYS/kernel_subkey.vbpubk" > "$W/kv.txt" 2>&1; then
  echo "kernel: signature verifies against the public developer kernel subkey"
else
  echo "FAIL: kernel does not verify"; cat "$W/kv.txt"; fail=1
fi
cmdline="$(vbutil_kernel --verify "$W/kern.bin" --verbose 2>/dev/null | sed -n '/^Config:/,$p' | tail -n +2 | tr -d '\0' | head -1)"
echo "cmdline: $cmdline"
[[ "$cmdline" == *"nd_profile=chromebook-discovery"* ]] || { echo "FAIL: cmdline missing nd_profile"; fail=1; }
for bad in cros_debug "init=/bin/sh" "rw " "dev_boot"; do
  [[ "$cmdline" == *"$bad"* ]] && { echo "FAIL: cmdline contains $bad"; fail=1; }
done

dd if="$IMG" of="$W/data.fat" bs=512 skip="$(cgpt show -i 1 -b "$IMG")" count="$(cgpt show -i 1 -s "$IMG")" status=none
mdir -i "$W/data.fat" ::/live/filesystem.squashfs >/dev/null 2>&1 || { echo "FAIL: live/filesystem.squashfs missing"; fail=1; }

[[ $fail -eq 0 ]] && echo "verify-cb-image (image): OK"
exit $fail
