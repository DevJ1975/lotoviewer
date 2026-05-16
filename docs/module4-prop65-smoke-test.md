# Module 4 — Prop 65 Smoke Test

Goal: verify the California Prop 65 / Cal/OSHA Title 8 §5194 surface
end-to-end on a real browser before relying on it. Run as a tenant
admin on a non-prod tenant.

## A — OEHHA list + chemical linking

1. Open `/admin/prop65`. Dashboard loads. Empty state surfaces if no
   California sites are declared yet.
2. Open `/admin/prop65/chemicals`. The page walks your tenant's
   `chemicals_inventory` and proposes Prop 65 links by CAS number.
3. Confirm a link (e.g. for Lead). The row's confidence flips from
   `auto` to `confirmed`. The `Prop65InventoryBadge` on the chemical
   detail page now shows "Linked to OEHHA: Lead (cancer + reproductive)".
4. Clear a link → the badge disappears.
5. **Superadmin only:** open `/admin/prop65/import`. Upload a fresh
   OEHHA CSV. The chemicals table grows; existing entries are upserted
   on CAS match.

## B — California sites + slug routing

1. Open `/admin/prop65/sites`. Click "Add site", fill in name + city.
   The `public_slug` is auto-generated via the BEFORE-INSERT trigger.
2. Open `/admin/prop65/sites/[id]`. Three tabs render: assessments,
   warnings, notifications.
3. Open `/prop65/<slug>` in an **incognito browser**. Page renders
   the site name + city + "No warnings are currently posted at this
   location." No login required.

## C — Exposure assessments

1. From the site detail page, click "New assessment" → `/admin/prop65/assessments/new`.
2. Pick a linked chemical (e.g. Lead with cancer endpoint).
3. Enter `estimated_daily_intake_mg = 0.014`. Live preview:
   "**Below safe harbor**" (0.014 < 0.015 NSRL).
4. Change to `0.015` exactly. Preview flips to "Requires warning"
   (strict-less-than at the boundary, per the §25249.6 affirmative-
   defense interpretation).
5. Change to `0.025`. Still requires warning.
6. Sign and save. The row freezes — `signed_at`, `signed_name` populate.
7. Try to re-sign with the same signature: the unique constraint on
   (tenant, site, chemical, assessed_at) makes it a no-op edit.

## D — Posted warnings

1. From the site detail page, click "Record posted warning" →
   `/admin/prop65/warnings/new`.
2. Pick chemicals (the list is filtered to confirmed-linked chemicals).
3. Pick `warning_type = long_form`. The right-side preview shows the
   exact §25603-compliant text:

   ```
   ⚠ WARNING:

   This area can expose you to chemicals including Lead, which is
   known to the State of California to cause cancer and birth
   defects or other reproductive harm.

   For more information go to www.P65Warnings.ca.gov.
   ```

4. Switch language to `es`. Preview re-renders in Spanish.
5. Upload a photo of the actual posted sign (mobile camera works).
   The path is `loto-photos/<tenant_uuid>/prop65/warning_photos/<site>/<ts>.jpg`.
6. Save. The warning row lands; the **public `/prop65/<slug>` page**
   now renders the warning text + photo.
7. Mark the warning removed. The public page drops the warning;
   the row stays in the admin list with `removed_at` populated.

## E — Auto-notification trigger (§5194(h))

1. Open `/admin/training-records`. Create a training record where
   `metadata = { "prop65_topic": true }` (the field is exposed via
   the form).
2. Sign the training record.
3. Open `/admin/prop65/sites/[id]/notifications` for the first
   declared CA site. A row should appear:
   - `notification_method = training`
   - `training_record_id` linking back
   - `notified_at` = the training's `completed_at`
4. **Critical:** the trigger picks the tenant's FIRST CA site by
   `created_at`. Multi-site tenants need to re-home the row.

## F — Annual review

1. Open `/admin/prop65/annual-review`. Form for the current year.
2. Fill in reviewer name, deviations, corrective actions. Sign.
3. The `annual_review_due_at` on the compliance status view
   re-anchors to `signed_at + 365 days`.
4. Try to create a second review for the same year → unique
   constraint blocks it.

## G — Cross-cutting (critical security checks)

### Public route data leak verification — DO THIS

The `/devjr` audit caught a column-grant gap on the anon-read RLS
policies and the fix landed as migration 178. Verify in production
that the fix is effective:

1. From any browser (no login), open the network inspector and run:
   ```js
   await fetch(
     'https://<your-app>/rest/v1/prop65_sites?select=tenant_id',
     { headers: { apikey: '<NEXT_PUBLIC_SUPABASE_ANON_KEY>',
                  authorization: 'Bearer <same>' }}
   ).then(r => r.text())
   ```
   Expected: `401` or PostgREST permission-denied. If you get rows
   back with `tenant_id` populated, the column grants didn't apply —
   escalate.
2. Same probe on `prop65_warnings?select=tenant_id,posted_by_user_id`.
   Expected: `401`.
3. Sanity-check the SAFE columns still work:
   ```js
   await fetch('.../rest/v1/prop65_sites?select=public_slug,name,city')
   ```
   Expected: 200 with the limited columns.

### Tenant isolation
- Log in as a user in tenant A. Open `/admin/prop65/sites`. Should
  show only tenant A's sites.
- Switch to tenant B in the tenant switcher. List refreshes.

### Audit log
- Open `/admin/audit` and filter by:
  - `prop65_chemical_links`
  - `prop65_sites`
  - `prop65_exposure_assessments`
  - `prop65_warnings`
  - `prop65_notifications`
  - `prop65_annual_reviews`
  Each table should have rows recording your test actions with the
  correct actor.

---

## What's NOT covered by tests and needs manual verification

- **PDF rendering of warning signs:** the long-form text builder is
  unit-tested, but the actual printed/posted sign with the ⚠
  symbol + font sizing per §25602(c) needs a real print.
- **OEHHA CSV import:** the parser is unit-tested with the seed
  shape, but the real OEHHA download has subtle column-order
  variations across publication years. Verify on the live CSV before
  trusting the import.
- **Incident → Prop 65 banner:** the `Prop65IncidentBanner` only
  fires when the involved chemical's CAS is in the OEHHA list.
  Create an incident with Lead exposure and verify the amber CTA
  surfaces.
- **Compliance bundle PDF:** the agent's report flagged that the
  bundle PDF generator was NOT extended in this module. Track
  separately — for now the dashboard surfaces the same data.
- **Public route SEO/access:** `/prop65/[slug]` should be
  indexable by Google so workers walking past a sign can find it.
  Verify the page doesn't have `noindex` headers.
