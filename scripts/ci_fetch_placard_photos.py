#!/usr/bin/env python3
"""Download and downscale the placard photos, for CI.

The Claude environment that renders the placard workbooks runs behind a
trusted-hosts egress policy that does not include the Supabase storage
host, so it cannot fetch the photos itself. A GitHub Actions runner can.
This script reads scripts/placard-photo-manifest.tsv (equipment_id, kind,
url), downloads each public photo, and downscales it exactly the way
export_placards_xlsx._download_photos does, so the cache it produces drops
straight into `build`.

    python scripts/ci_fetch_placard_photos.py <manifest.tsv> <out_dir>

Only URLs inside the project's public loto-photos bucket are accepted; a
manifest line pointing anywhere else fails the run rather than being
fetched. The exit code is non-zero if any photo could not be fetched, but
the photos that did succeed are kept — the workbook build degrades per
slot, never per run.
"""

import sys
from pathlib import Path
from urllib.request import urlopen

from PIL import Image

ALLOWED_PREFIX = ("https://zwtnpyjifbdytlektxlc.supabase.co"
                  "/storage/v1/object/public/loto-photos/")
PHOTO_MAX_PX = 900


def main() -> int:
    manifest, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    ok = failed = 0
    for line in manifest.read_text("utf-8").splitlines():
        if not line.strip():
            continue
        equipment_id, kind, url = line.split("\t")
        if not url.startswith(ALLOWED_PREFIX):
            print(f"REFUSED (outside the loto-photos bucket): {url}",
                  file=sys.stderr)
            return 2
        target = out_dir / f"{equipment_id.replace('/', '_')}_{kind}.jpg"
        if target.exists():
            ok += 1
            continue
        partial = target.with_suffix(".part")
        try:
            with urlopen(url, timeout=60) as response:
                partial.write_bytes(response.read())
            with Image.open(partial) as image:
                image = image.convert("RGB")
                image.thumbnail((PHOTO_MAX_PX, PHOTO_MAX_PX), Image.LANCZOS)
                image.save(partial, "JPEG", quality=82, optimize=True)
            partial.replace(target)
            ok += 1
        except Exception as error:  # noqa: BLE001 — one bad photo, one lost slot
            print(f"failed {equipment_id} {kind}: {error}", file=sys.stderr)
            partial.unlink(missing_ok=True)
            failed += 1
    print(f"{ok} photos cached, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
