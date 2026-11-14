"""
nd-station — NexWipe read-only station.

  python3 -m nd_station                 full-screen console (default on the USB image, tty1)
  python3 -m nd_station discover        print the hardware report that would be uploaded
  python3 -m nd_station headless [--once]   no screen; log to stdout (serial console / tests)
  python3 -m nd_station enroll --server URL --token ndenr_... [--name NAME]
  python3 -m nd_station hwtest          full hardware test on this screen; prints the result (nothing sent)
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import VERSION
from .discovery import discover


def main() -> None:
    p = argparse.ArgumentParser(prog="nd-station", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sysroot", default=os.environ.get("ND_SYSROOT", "/"), help=argparse.SUPPRESS)
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("discover")
    hl = sub.add_parser("headless")
    hl.add_argument("--once", action="store_true")
    en = sub.add_parser("enroll")
    en.add_argument("--server", required=True)
    en.add_argument("--token", required=True)
    en.add_argument("--name", default="")
    sub.add_parser("version")
    sub.add_parser("hwtest")
    a = p.parse_args()

    if a.cmd == "version":
        print(VERSION)
        return
    if a.cmd == "hwtest":
        import curses

        from .hwtest import run as hwrun

        print(json.dumps(curses.wrapper(lambda scr: (curses.start_color(), curses.use_default_colors(), hwrun(scr, a.sysroot, can_send=True))[2]), indent=2))
        return
    if a.cmd == "discover":
        print(json.dumps(discover(a.sysroot), indent=2))
        return
    from .station import Station

    st = Station(a.sysroot)
    if a.cmd == "enroll":
        try:
            st.set_server(a.server)
            st.enroll(a.token, a.name)
        except ValueError as e:
            sys.exit(str(e))
        return
    if a.cmd == "headless":
        if a.once:
            st.cycle()
            v = st.snapshot()
            print(json.dumps({"enrolled": v.enrolled, "net": v.net.summary if v.net else None,
                              "last_upload": v.last_upload_note, "error": v.error}, indent=2))
            return
        st.run_forever()
        return
    from .console import run

    run(st)


if __name__ == "__main__":
    main()
