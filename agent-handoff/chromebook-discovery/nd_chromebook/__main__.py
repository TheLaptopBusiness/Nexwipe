"""
nd-chromebook — NexWipe Chromebook discovery build (read-only).

Runs the unchanged read-only station program (nd_station) and adds a `chromebook` block to
each report: firmware identity, reported board, internal storage identity and reported
capabilities, storage regions and partition labels. Enrollment, heartbeat, credential rotation,
revocation and upload use the station's existing read-only contract.

  python3 -m nd_chromebook              full-screen console
  python3 -m nd_chromebook discover     print the report that would be uploaded
  python3 -m nd_chromebook headless [--once] / enroll ... / version   (as nd_station)
"""
from __future__ import annotations

import os
import sys

import nd_station
from nd_station import __main__ as station_main
from nd_station import discovery, safety
from nd_station import station as station_mod

from . import VERSION
from .chromeos import discover_chromebook

# Firmware/flag tools are never run by this build, in addition to the station's storage deny-list.
FIRMWARE_TOOLS = {"flashrom", "futility", "crossystem", "vpd", "gsctool", "ectool", "cgpt", "mmc",
                  "chromeos-firmwareupdate", "chromeos-setgoodkernel", "chromeos-install", "dump_fmap"}
safety.DESTRUCTIVE_TOOLS |= FIRMWARE_TOOLS

_station_discover = discovery.discover


def discover(root: str = "/", run=safety.run_read_only, station=None) -> dict:
    st = dict(station or {})
    st["profile"] = "chromebook-discovery"
    st["chromebook_build"] = VERSION
    report = _station_discover(root, run, st)
    block, flags = discover_chromebook(discovery.Sys(root, run), report)
    report["chromebook"] = block
    if flags:
        report["review_flags"] = (report.get("review_flags") or []) + flags
        report["review_flags"] = report["review_flags"][:50]
    return report


def install() -> None:
    discovery.discover = discover
    station_mod.discover = discover
    station_main.discover = discover


def main() -> None:
    install()
    if len(sys.argv) > 1 and sys.argv[1] == "version":
        print(f"{VERSION} (station {nd_station.VERSION})")
        return
    os.environ.setdefault("ND_PROFILE", "chromebook-discovery")
    station_main.main()


if __name__ == "__main__":
    main()
