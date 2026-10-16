# Photo Walkdown

A small, single-purpose web app (Django + HTMX, installable as a PWA, packaged in Docker) for walking
the Snak King plant and fixing the LOTO placard photos the audit flagged. It is separate from the
Soteria Field platform and writes to the same Supabase project, so a photo taken here appears on the
real placard.

Intended address: `https://photos.soteriafield.app`.

## What it does

For each of the 497 machines with a photo delta:

- shows what the audit found wrong and what to photograph (derived from the machine's energy sources)
- takes a new equipment or isolation photo, or confirms the photo already on the placard
- lets you mark the isolation point with an arrow (several per photo, optional label)
- works with no signal: photos and arrows queue on the phone and upload when signal returns
- produces a progress report for the client, with a link to each updated placard

## What a synced photo changes

Each capture is applied server-side with the service-role key, in this order:

1. Upload a **new** object to `loto-photos/<tenant>/<id>/<id>_<EQUIP|ISO>_<ms>.jpg` (never overwrites).
2. Update `loto_equipment`: the photo URL, `has_*_photo`, `*_photo_provenance='field'`, `photo_status`
   (same rule as `packages/core/src/photoStatus.ts`), the photo's arrows (`annotations` /
   `iso_annotations`, replaced because arrows belong to one specific picture), and for the isolation
   photo `iso_photo_is_placeholder=false` (nothing else clears it, and trigger 217 blocks "complete"
   while it is set).
3. Set `placard_url=null` and `placard_qr_backfilled=false`. The platform's
   `/api/cron/regenerate-loto-placards` (every 5 minutes) then rebuilds the stored placard PDF. The live
   placard and the public `/qr/<token>` page read the database directly and update immediately.
4. Write a `loto_hygiene_log` row (`section='photo_walkdown_2026'`) with who, when, and old/new URL and
   arrows.

Rules enforced on the server as well as on screen:

- A photo the audit found shows **another machine** can only be replaced, never confirmed, and arrows
  cannot be added to it.
- An arrow on an existing photo is rejected if the photo changed since the phone drew it.
- Replacing a photo drops the old photo's arrows.
- Retrying a capture (same `client_capture_id`) never uploads twice.

## Sign-in

Credentials are checked by Supabase Auth, and the user must be an `owner` or `admin` of the Snak King
tenant (or listed in `SUPERADMIN_EMAILS`). Sessions last 30 days so a day without signal does not strand
queued photos. Five failed attempts lock that email and IP out for 15 minutes.

## Run locally

```bash
cp .env.example .env          # fill in the Supabase values; set DJANGO_DEBUG=1 and DJANGO_SSL_REDIRECT=0
docker compose up --build     # http://localhost:8000
```

Without Docker:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export $(grep -v '^#' .env | xargs)
python manage.py migrate && python manage.py load_deltas
python manage.py runserver
```

## Tests

```bash
pytest -q                          # 80+ tests, Supabase mocked with respx
python e2e/run_e2e.py              # real browser: offline download, queued photo + arrow, sync
ruff check .
```

The browser test starts gunicorn (as in the container) and a fake Supabase (`e2e/fake_supabase.py`),
downloads a department, goes offline, takes a photo with an EXIF-rotated image, draws arrows, comes back
online and checks exactly what reached "Supabase". CI (`.github/workflows/photo-walkdown.yml`) runs all
of this plus the Docker build and the container health check.

## Deploy (Railway)

1. New service from this repo, **Root Directory** `services/photo-walkdown` (it builds the Dockerfile).
2. Add a **Volume** mounted at `/data` (SQLite, thumbnail cache). Keep the service at one replica.
3. Set variables (see `.env.example`): `DJANGO_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `WALKDOWN_TENANT_ID`, `ALLOWED_HOSTS=photos.soteriafield.app`,
   `CSRF_TRUSTED_ORIGINS=https://photos.soteriafield.app`, `PLATFORM_URL=https://soteriafield.app`,
   and optionally `SUPERADMIN_EMAILS`. The service-role key is a secret: set it only in Railway.
4. Health check path `/healthz`.
5. Add the custom domain `photos.soteriafield.app` in Railway and create the CNAME record it shows.

The container migrates and reloads the worklist from `seed/snak_king_photo_audit.json` on every start
(safe to repeat; captures are never touched).

## First live test (do this once, with Jamil at one machine)

1. Install the PWA (Add to Home Screen), sign in, open a department, tap **Download for offline**.
2. Take one isolation photo for one machine and mark its arrow.
3. In Supabase confirm: the new object exists, `iso_photo_url`, `iso_annotations`,
   `iso_photo_is_placeholder=false`, `placard_url IS NULL`, `placard_qr_backfilled=false`, and a
   `loto_hygiene_log` row.
4. Within about 5 minutes the placard PDF is rebuilt; check it shows the photo and the arrow.
5. If anything is wrong: `python manage.py revert_capture --list`, then `revert_capture <id>`.

## Client report

`/report/` (signed in) shows what has been done, with a date filter, an HTML download, a CSV, and a
**link for the client**. The link is signed, read-only, needs no login, always shows the latest
progress, expires after 90 days, and lists each updated machine with a link to its placard
(`PLATFORM_URL/qr/<token>`). It contains no staff names or emails. Anyone with the link can open the
placard pages it lists, exactly as with the QR codes posted on the machines.

## Refreshing the Excel master

```bash
# 1. the audit with finished machines marked (also downloadable at /export/photo-audit.json)
docker exec <container> python manage.py export_photo_audit /data/photo_audit_reshot.json

# 2. refresh the cached equipment (new photo URLs and arrows) and rebuild
python scripts/export_placards_xlsx.py fetch --out placard-data       # needs SUPABASE_URL + service key
python scripts/make_placards.py --data placard-data --photo-audit photo_audit_reshot.json \
    --register "LOTO Register.xlsx" --no-app-links
```

Confirmed slots then print clean (no warning band) with their arrows drawn on the photo, and the
register's Photo Audit sheet shows "Re-shot & verified" with the date.

## Limits

- The schema has **one isolation photo per machine**. A machine with several isolation points gets one
  photo, with an arrow for each point (up to 6).
- Offline queueing needs a browser with IndexedDB and service workers (current iOS Safari and Android
  Chrome). The app asks the browser not to evict the queue, but a phone that is wiped loses unsent photos.
- Uploads drain when the app is open; there is no background sync while the app is closed.
- Single container with SQLite on a volume. It is meant for one crew on one job, not as a platform service.
