# Smoke checklist — devjr audit (post-session)

Manual verification for the features shipped in this session: AI
audit Phases 0-5, support archive + metrics, LOTO worker enrollment
+ training gate, shop-floor workers, /admin/workers CRUD, mobile
LOTO Devices, confined-spaces auto-cancel, training-expiry reminder
cron, plus the post-audit migrations 054 (profiles RLS) and the
inventory bug fix in /admin/workers.

Drive these against your live deployment after applying every
migration and confirming Vercel deployed the latest commit (push
the user that triggered this audit pass — the devjr commit).

## Pre-flight

- [ ] All migrations 047 → 054 applied in Supabase. Verify:
  ```sql
  select count(*) from public.ai_invocations;                                   -- 047
  select column_name from information_schema.columns
    where table_name = 'support_tickets' and column_name = 'archived_at';       -- 048
  select proname from pg_proc where proname = 'current_user_admin_tenant_ids';  -- 049
  select pg_typeof(role) from public.loto_training_records limit 1;             -- 050 (text + check)
  select count(*) from public.loto_workers;                                     -- 051
  select column_default from information_schema.columns
    where table_name = 'loto_devices' and column_name = 'tenant_id';            -- 052 (active_tenant_id())
  select tgname from pg_trigger where tgname = 'trg_cs_atmospheric_auto_cancel';-- 053
  select proname from pg_proc where proname = 'current_user_visible_profile_ids'; -- 054
  ```
  Each query should return a row.
- [ ] Vercel: latest commit deployed Ready.
- [ ] Hard-refresh the browser to drop cached bundles.

## 1. Profiles RLS — close the cross-tenant leak (migration 054)

Goal: confirm a tenant admin can no longer see profiles from
other tenants.

You need at least two tenants (e.g. Snak King + WLS Demo) with
disjoint user sets to validate this. If you only have one tenant
in production, this test is a no-op and the migration is still
safe.

- [ ] Sign in as a tenant admin of tenant A. Open the LOTO
      checkout dialog. The "App users" optgroup should show ONLY
      profiles from tenant A.
- [ ] Open `/admin/workers`. Add a worker — the form is
      tenant-scoped, no cross-tenant leak in the form itself.
- [ ] In Supabase as the *anon* key, attempt:
      ```sql
      -- Run with the JWT of a tenant-A admin (use the SQL editor's "impersonate" feature
      -- or the supabase-js client with a real session token).
      select id, email from public.profiles;
      ```
      Expect: only profiles in tenant A. Tenant B users should
      NOT appear in the result.
- [ ] As a superadmin (in env allowlist + is_superadmin = true),
      the same query returns ALL profiles. Confirms the
      profiles_superadmin_read policy.

## 2. /admin/workers (CRUD)

- [ ] Drawer → Admin → **Workers** opens the page. Three KPI
      tiles render (Active / Inactive / Training gaps).
- [ ] Click **+ New worker**. Fill name + employee_id + training
      completion date → **Add worker**. Row appears in the table
      with a green "current" pill.
- [ ] Submit the form again with the SAME employee_id → expect
      the friendly error "A worker with employee ID … already
      exists."
- [ ] Edit a row (pencil icon) → change the name → Save. Row
      updates inline.
- [ ] **NEW: training-error keeps form open.** Set training
      completion date but use an invalid date format like
      `2025-13-99` and submit. Worker is created but training
      record fails. Form stays open with the partial-success
      warning visible (devjr Bug 6 fix).
- [ ] Deactivate a worker (archive icon). Row shows "inactive"
      pill, drops out of the Active filter.
- [ ] Reactivate. Row returns.
- [ ] Switch to **Inactive** filter — only inactive workers
      show. Switch to **All** — all show.

## 3. LOTO Devices — checkout flow

- [ ] `/admin/loto-devices` loads. Inventory table shows seeded
      + any new devices.
- [ ] Add a device — `+ Add device` form succeeds without the
      `tenant_id` violation (migration 052 default).
- [ ] Click **Check out** on an available device. Modal opens
      with two optgroups (Workers / App users).
- [ ] Pick a worker with **current** training. Training badge
      reads green. Check out enabled.
- [ ] Pick a worker with **expired** training (set up via SQL
      if needed). Training badge reads red. Check out **disabled**
      with the tooltip explaining the gate.
- [ ] Pick a worker with **no training** record. Same red badge.
      Check out disabled.
- [ ] **+ Add new worker** form has the toggle:
  - [ ] Shop-floor worker → name + optional employee_id, no
        email needed. Training fields auto-fill the new
        worker's record.
  - [ ] App user → email required. POSTs to /api/admin/users.
- [ ] After successful add, the new worker is auto-selected and
      training pill turns green. Click Check out.
- [ ] Inventory row now shows holder name + equipment + status
      'CHECKED OUT'.
- [ ] Click **Return** on the same row. Confirm dialog → row
      goes back to AVAILABLE.

## 4. Mobile LOTO Devices

Drive on a real iPad / iPhone if available. Expo Go works for
dev; production binaries via EAS work after deeplink IDs are
filled in.

- [ ] Bottom tab bar shows **Devices** with the key icon.
- [ ] List loads with status dots + holder names where applicable.
- [ ] Tap an available device → checkout modal opens. Workers
      and App users grouped separately. Selection works.
- [ ] Training badge updates with each selection.
- [ ] **+ Add new worker** form (shop-floor only on mobile).
      Test name + training date entry. Worker added; auto-
      selected; can check out.
- [ ] Pull-to-refresh on the list works.
- [ ] Tap a checked-out device → confirm dialog → return works.

## 5. Confined-spaces auto-cancel (migration 053)

- [ ] Open a permit with status ACTIVE.
- [ ] Record a periodic atmospheric test with O₂ = 18.0
      (deliberately below the 19.5 floor).
- [ ] After save, the page auto-refetches and the StatusBanner
      transitions to CANCELED with reason
      `prohibited_condition` and the auto-generated cancel notes.
- [ ] Forms (new test, roster edit) become disabled.
- [ ] In Supabase, verify:
      ```sql
      select cancel_reason, cancel_notes from public.loto_confined_space_permits where id = '<id>';
      ```
      `cancel_notes` should mention the failed channels with
      values + thresholds.

## 6. Training-expiry reminder cron

- [ ] Set up a test record:
      ```sql
      insert into public.loto_training_records
        (tenant_id, worker_name, role, completed_at, expires_at, cert_authority)
      values
        ('<your-tenant-uuid>', 'Smoke Worker', 'authorized_employee',
         '2024-01-01', current_date + 5, 'devjr smoke');
      ```
- [ ] Trigger the cron manually:
      ```
      curl -H "Authorization: Bearer $CRON_SECRET" \
        https://YOUR-DOMAIN/api/cron/training-expiry-reminders
      ```
      Expect JSON `{ tenants_scanned: 1, recipients: ≥1, emails_sent: ≥1, ... }`.
- [ ] Tenant admin's inbox receives an email with subject
      "Training: 1 expiring — <tenant>". Body lists Smoke Worker
      with a 5d remaining badge.
- [ ] Re-run within the same minute. New email goes out — there
      is no per-day dedup, daily cron acts as the dedup. Note
      this in case the operator re-runs manually for debugging.
- [ ] Cleanup: `delete from public.loto_training_records where cert_authority = 'devjr smoke';`

## 7. Support tickets — archive + metrics

- [ ] `/superadmin/support` shows Open / Resolved / Archive / All
      pills + a Metrics button.
- [ ] Open ticket → click Resolve → row drops out of Open
      immediately (the b508b01 fix).
- [ ] Switch to Resolved → ticket appears.
- [ ] To test archive without waiting 30 days, manually:
      ```sql
      update public.support_tickets
         set resolved_at = now() - interval '31 days'
       where id = '<recent-resolved-ticket-id>';
      ```
      Then trigger the archive cron:
      ```
      curl -H "Authorization: Bearer $CRON_SECRET" \
        https://YOUR-DOMAIN/api/cron/archive-resolved-tickets
      ```
      Expect `{ archived: 1 }`. Refresh the page → ticket
      appears under Archive only.
- [ ] Click **Metrics** → `/superadmin/support/metrics` renders:
  - KPI tiles: Open / Resolved / Archived / Email failed.
  - Median + P90 + Mean time to resolve.
  - By-priority + By-tenant tables.
  - Daily opened-vs-resolved bar chart.

## 8. AI usage dashboard

- [ ] `/superadmin/ai-usage` loads (assumes ANTHROPIC_API_KEY is
      set in Vercel + at least one AI invocation has logged).
- [ ] Window selector (24h / 7d / 30d / 90d) refreshes data.
- [ ] By-surface, by-tenant, by-model tables render.
- [ ] Daily trend bars render.
- [ ] Recent failures section appears if there are any error /
      rate-limited rows.

## 9. Tenant edit form — module checkboxes

The cb92caf fix: missing keys in tenant.modules JSON should
display as their static catalog default, not as unchecked.

- [ ] Open `/superadmin/tenants/<tenant>` for an existing tenant.
- [ ] Scroll to module checkboxes. Confirm `admin-loto-devices`,
      `admin-workers`, `admin-training`, `admin-webhooks`,
      `admin-hygiene-log` are all CHECKED (their static catalog
      default is `enabled: true`).
- [ ] If they're unchecked, the post-cb92caf form should NOT be
      saving false back. Check the network tab on Save — the
      modules JSON in the request body should NOT include the
      admin-* keys as `false`.

## After running

If every item passes, the devjr session is operationally
verified. Anything that fails — paste the symptom back so we
can fix.

## 10. Photo-AI removal (commits 64368cf + 847df38)

Goal: confirm the photo-validation gate is gone from the upload
path and that the generation routes still produce reasonable
drafts without image inputs.

### 10.1 Upload latency (no validate-photo step)

- [ ] Open any equipment placard or confined-space detail page
      with a photo slot.
- [ ] Upload a clear photo. The status overlay should cycle
      `Compressing… → Uploading…` with NO `Checking…` step.
      Open DevTools → Network and confirm no
      `POST /api/validate-photo` request fires.
- [ ] Direct URL test: `https://YOUR-DOMAIN/api/validate-photo`
      should 404 (route deleted).

### 10.2 Upload an obviously-wrong photo

- [ ] Upload a blank wall, a meme, or anything not industrial.
      The upload should SUCCEED (no AI gate). The supervisor's
      review at sign-off is the only check now — confirms the
      operator's decision that AI photo validation was redundant.

### 10.3 LOTO step generation — text-only

- [ ] Go to a placard with no photos at all. Click **Edit
      steps** → **Generate with AI**.
- [ ] Drafts should still arrive within ~10-30s. Open DevTools
      Network, find the `/api/generate-loto-steps` request, and
      confirm:
  - Request body has NO `equip_photo_url` or `iso_photo_url`
    fields.
  - Steps are reasonable for the equipment description (one per
    independent energy source). Quality may differ slightly
    from photo-augmented runs — supervisors should still review
    every step.
- [ ] Repeat on a placard WITH photos. The route should ignore
      any stale `*_photo_url` fields if a cached client sends
      them; same step quality as the no-photo case.

### 10.4 Confined-space hazard generation — text-only

- [ ] Go to `/confined-spaces/<space>/permits/new`. Click
      **Suggest hazards with AI**.
- [ ] DevTools Network → `/api/generate-confined-space-hazards`
      request body has NO `equip_photo_url` or
      `interior_photo_url`. Suggestions arrive populated.
- [ ] Confirm the SYSTEM_PROMPT no longer references
      photos by checking that the suggestion text doesn't
      reference visual cues like "as visible in the attached
      photo" or "the manway visible at the top of the tank."

### 10.5 AI usage dashboard — historical data preserved

- [ ] `/superadmin/ai-usage`. Switch the window to 90 days.
- [ ] **By surface** table shows three rows (support-chat,
      generate-loto-steps, generate-confined-space-hazards).
      `validate-photo` may still appear with historical
      invocations from BEFORE the removal — that's correct,
      the dashboard reads `ai_invocations.surface` text and
      doesn't filter to the current AiSurface union.
- [ ] Switch to 7d / 24h. Expect zero new validate-photo rows.

### 10.6 KB updated

- [ ] In the in-app support chat, ask "Does the AI look at my
      photos?". The `loto.md` and `confined-spaces.md` KB
      passages now state explicitly that the AI is text-only.
      The bot's answer should reflect that.

## Known deferred items

- **Deeplink prebuild guard fails locally** (apple-app-site-
  association, assetlinks.json, eas.json still have placeholders).
  Vercel deploys succeed because `ALLOW_DEEPLINK_PLACEHOLDERS=1`
  is set in env. To remove the bypass: fill in real Apple Team
  ID + App Store Connect ID + Android SHA-256 fingerprint + path
  to play-service-account JSON, then unset the env var.
- **State-after-unmount warnings** in the mobile LOTO Devices
  load handler. Matches the existing pattern in
  apps/mobile/app/(tabs)/equipment.tsx — both should add a
  cancelled flag eventually. Not a crash, just a React warning.
- **Historical `validate-photo` rows in `ai_invocations`.** The
  table still has any rows logged before commit 64368cf. They
  surface in the AI usage dashboard's by-surface breakdown for
  windows that include the pre-removal period. Not a bug —
  intentional preservation of audit history.
