#!/usr/bin/env python3
"""Download the placard photos and build the print-ready workbooks.

One command, because the two-step version is one step too many for the
person who just needs the folder:

    python scripts/make_placards.py

It downloads every placard photo named by the cached equipment data, then
rebuilds one workbook per department with those photos embedded. Photos
already downloaded are kept, so an interrupted run costs only what it had
not finished.

    --data DIR        cached equipment.json / steps.json (default placard-data)
    --out-dir DIR     folder to write the workbooks into
    --single FILE     one workbook for the whole site instead of a folder
    --skip-photos     rebuild from whatever photos are already cached

Photo download needs no credentials: placard photos are public storage
objects and their URLs are already in the cached equipment.json. It does
need network access to that storage host — if your network blocks it, the
build still succeeds and every photo slot shows the placard's own
"-- No photo --" placeholder.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from export_placards_xlsx import (  # noqa: E402
    _download_photos,
    build_workbook,
    cmd_build,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default="placard-data")
    parser.add_argument("--out-dir", default="placards-by-department")
    parser.add_argument("--single", default=None,
                        help="write one workbook for the whole site instead")
    parser.add_argument("--skip-photos", action="store_true")
    parser.add_argument("--language", choices=("en", "es", "both"), default="both")
    parser.add_argument("--date", default="")
    args = parser.parse_args()

    if not args.date:
        from datetime import date
        args.date = date.today().isoformat()

    data = Path(args.data)
    equipment_file = data / "equipment.json"
    if not equipment_file.exists():
        sys.exit(f"No cached data at {equipment_file}. Run "
                 f"'export_placards_xlsx.py fetch --out {data}' first.")
    equipment = json.loads(equipment_file.read_text("utf-8"))

    photos = data / "photos"
    photos.mkdir(parents=True, exist_ok=True)
    wanted = sum(1 for row in equipment for kind in ("equip", "iso")
                 if row.get(f"{kind}_photo_url"))

    if args.skip_photos:
        have = len(list(photos.glob("*.jpg")))
        print(f"Skipping download; {have} of {wanted} photos already cached.")
    else:
        print(f"Downloading {wanted} photos into {photos} — this is the slow part.")
        have = _download_photos(equipment, photos)
        print(f"{have} of {wanted} photos cached.")
        if have == 0:
            print("  No photos were downloaded. If your network blocks the storage\n"
                  "  host, the workbooks below will still build, with placeholders.",
                  file=sys.stderr)

    build_args = argparse.Namespace(
        data=str(data), out=args.single or "loto-placards.xlsx",
        by_department=args.single is None, out_dir=args.out_dir,
        language=args.language, date=args.date,
    )
    result = cmd_build(build_args)

    if have < wanted:
        print(f"\n{wanted - have} photo(s) are still missing; those slots keep the "
              f"'-- No photo --' placeholder. Re-run to retry just those.",
              file=sys.stderr)
    else:
        print("\nEvery referenced photo is embedded. The workbooks open on the "
              "Placards sheet — landscape, fit to width, one placard per page.")
    return result


if __name__ == "__main__":
    raise SystemExit(main())
