# LOTO Supervisor Review Flow — User Acceptance Test

Acceptance checklist for the feature shipped in #116.

## Roles

- **Admin** — a tenant user with `owner` or `admin` role (or
  superadmin with allowlisted email)
- **Supervisor** — anyone the admin shares the public review URL with;
  has no Soteria account

## Setup

1. Sign in as the WLS Demo admin
   (`ddddbce8-c7ab-4855-8bcd-821d080617ee`)
2. Navigate to `/admin/loto/public-review-link`

## A) Public link minting

| # | Step | Expected |
|---|------|----------|
| A1 | Click **Mint public link** | URL renders + `extension_count = 0` + "Expires in ~72h" |
| A2 | Click **Mint** a second time (link still active) | Returns the SAME link (idempotent get-or-create) — no second row in `loto_review_links` |
| A3 | Copy the URL | Clipboard populated; "URL copied" toast |

**DB invariant (verify via SQL):** exactly one
`loto_review_links` row with `is_public = true AND revoked_at IS NULL`
per tenant.

## B) Supervisor: name capture

| # | Step | Expected |
|---|------|----------|
| B1 | Open the public URL in an incognito window (no Soteria cookie) | Page renders; no signoff section |
| B2 | Click any **Mark for review** or **Choose photo** button | Modal appears asking for name |
| B3 | Cancel the modal | Action does not fire; modal closes |
| B4 | Enter a name, submit | Modal closes; action fires; "Signed in as ..." appears in the header |
| B5 | Refresh the page | Name persists (sessionStorage) |
| B6 | Close the browser, reopen the URL | Name is asked for again (sessionStorage cleared on browser close) |
| B7 | Click "change" next to the name in the header | Modal reopens |

## C) Supervisor: photo replacement

| # | Step | Expected |
|---|------|----------|
| C1 | Drag a JPEG onto an EQUIP photo tile | Upload animation; "Photo updated" toast |
| C2 | Within ~2s | The placard thumbnail (where shown) refreshes to the new image |
| C3 | Open the equipment from the admin side | `equip_photo_url` is the new URL; `placard_url` is a fresh PDF with cache-buster (`?v=...`); `signed_placard_url` is `NULL` |
| C4 | In Supabase, inspect `loto_review_photo_replacements` | Newest row has `replaced_by_name = "<supervisor name>"`, IP + UA captured, `slot = "EQUIP"` |
| C5 | Drag a non-image file (e.g. PDF) | Error: "Choose an image file for the replacement photo" |
| C6 | Drag a >2 MB JPEG | Error: "photo must be 2 MB or smaller" |
| C7 | Drag a HEIC photo from an iPhone | Converted to JPEG client-side; uploads successfully |

## D) Supervisor: mark for review

| # | Step | Expected |
|---|------|----------|
| D1 | Click **Mark for review** on an equipment card | Button flips to "⚑ Flagged for review" with the typed name and timestamp on hover |
| D2 | Verify in DB | `loto_equipment.flagged_for_review_at` is `NOT NULL`, `flagged_for_review_by` is the typed name, `flagged_for_review_via = 'public-link'` |
| D3 | Click the flag a second time | Idempotent — timestamp + note overwrite, no duplicate row |

## E) Admin: review queue

| # | Step | Expected |
|---|------|----------|
| E1 | Visit `/admin/loto/review-queue` | Lists flagged equipment, newest first; counter tiles show total / from-public / from-admin breakdown |
| E2 | Each row shows | equipment_id (links to detail), department, "X ago" + absolute time, by name, via badge, optional note |
| E3 | Click **Clear** | Row disappears; `loto_equipment.flagged_for_review_at` is `NULL` |
| E4 | Visit the queue with no flagged rows | Empty state ("No equipment in the queue") |

## F) Admin: extend / revoke

| # | Step | Expected |
|---|------|----------|
| F1 | Click **+24h** | Expiry advances by 24h; "extended 1×" badge appears |
| F2 | Click **+72h** | Expiry advances by 72h from the current expiry; "extended 2×" |
| F3 | Click **+168h** | Expiry advances by 168h; "extended 3×" |
| F4 | After the link expires (or shift the system clock past `expires_at`), click **+24h** | New expiry is `now() + 24h`, not `expires_at + 24h` (avoids extending into the past) |
| F5 | Click **Revoke** | Confirmation dialog; on confirm, link disappears, "Public link revoked" message; the URL the supervisor was using now shows the "Link revoked" screen |
| F6 | Mint a new link | Creates a fresh `loto_review_links` row; `extension_count` resets to 0 |

## G) Security boundaries

| # | Step | Expected |
|---|------|----------|
| G1 | As a non-admin tenant user, attempt to POST `/api/admin/review-links` `{ is_public: true }` | 403 Forbidden |
| G2 | As a non-admin tenant user, attempt to POST `/api/admin/review-links/<id>/extend` | 403 Forbidden |
| G3 | As a non-admin tenant user, attempt to POST `/api/admin/loto/review-queue` `{ action: "clear" }` | 403 Forbidden |
| G4 | Tamper the public review URL to a different token (random hex string) | 404 Not found |
| G5 | After revoke, hit the public URL | "Link revoked" screen |
| G6 | After 72h expiry (no extension), hit the public URL | "Link expired" screen with the expiry date |
| G7 | From the public page, attempt `POST /api/review/<token>` with an equipment_id from a different tenant | 404 "Equipment not found in this tenant" — cross-tenant flagging blocked |

## H) Audit trail

| # | Step | Expected |
|---|------|----------|
| H1 | After a photo replacement | `loto_review_photo_replacements` row carries `old_photo_url`, `new_photo_url`, `slot`, `storage_path`, `replaced_at`, `replaced_ip`, `replaced_user_agent`, `replaced_by_name` |
| H2 | After a mark-for-review | `loto_equipment` row updated; the audit-log trigger (existing) captures the change via `log_audit` |
| H3 | After an extension | `loto_review_links` row has `last_extended_at` (now), `last_extended_by` (admin user id), `extension_count` (++) |

## I) Coexistence with the legacy per-reviewer model

| # | Step | Expected |
|---|------|----------|
| I1 | Visit a department page (e.g. `/departments/Packaging`), use the existing per-reviewer review-link panel to send an email invite | Works unchanged; reviewer receives email; signoff flow intact |
| I2 | The per-reviewer link page still has the comment + status + signoff sections (NOT the public-mode UI) | Confirms the `is_public` flag drives the UI branch correctly |
| I3 | After per-reviewer signoff, the per-reviewer link goes to the read-only thank-you screen | Confirmed |

## Out of scope / non-goals

- Email/SMS notification when a supervisor flags equipment (admin checks the queue manually)
- QR-code printer for the public URL (the URL is the deliverable; QR is a future enhancement)
- Bulk-clear in the review queue (one-at-a-time clear is sufficient for v1)
- Supervisor sign-off — by design the public link has no terminal "submit"
