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
fetched. A photo that fails to download is recorded in MISSING.txt beside
the cache and costs its own slot only: the run still succeeds and
publishes everything that was fetched. The first run proved why this must
not be an exit code — 3 stale database rows pointing at deleted storage
objects failed the job after 993 good photos had already been downloaded,
and the job discarded all of them.
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
    ok = 0
    missing: list[str] = []
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
            missing.append(f"{equipment_id}\t{kind}\t{url}\t{error}")
    if missing:
        (out_dir / "MISSING.txt").write_text(
            "Photos referenced by the database that could not be fetched.\n"
            "These placard slots keep the placeholder; fix the photo in\n"
            "Soteria Field and re-run the workflow.\n\n"
            + "\n".join(missing) + "\n", "utf-8")
    print(f"{ok} photos cached, {len(missing)} missing (see MISSING.txt)"
          if missing else f"{ok} photos cached, none missing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
