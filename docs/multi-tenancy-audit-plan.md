# Multi-Tenancy Audit & Cleanup Plan

Companion to `docs/multi-tenancy-saas-plan.md`. The rollout shipped end-to-end
(phases 0–7 + invite/email follow-up). This doc catalogs **what was deferred,
what's brittle, and where coverage is thin** — so we can knock items down
without the next "where do I start?" question.

Items are tagged:
- 🟥 **Bug / risk** — known wrong or fragile behavior
- 🟧 **Refactor** — works but not clean
- 🟨 **Edge case** — works for happy path; unknown under stress
- 🟦 **Test gap** — no coverage today
- 🟪 **Observability** — debugging would be hard if it broke

Effort scale: **S** ≈ 30 min · **M** ≈ 1–2 hours · **L** ≈ half-day+

---

## A. Code refactor

### A1. Split `app/superadmin/tenants/[number]/page.tsx` (895 lines) 🟧 M
That single file holds: load logic, basic-info form, modules grid, logo
upload, members section, reset-demo section, plus three helper components.
At ~900 lines it's hard to scan. Extract:
- `app/superadmin/tenants/[number]/_components/TenantBasicInfoForm.tsx`
- `_components/TenantModulesEditor.tsx`
- `_components/TenantLogoUploader.tsx`
- `_components/TenantMembersSection.tsx`
- `_components/TenantResetDemoSection.tsx`
- `_components/StatusBadge.tsx`

Each reads what it needs from the parent's state via props (or a small
context if prop-drilling gets painful).

### A2. DRY the Bearer-token dance 🟧 S
Every superadmin client component repeats:
```ts
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token
if (!token) { setError('Not signed in'); return }
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
```
At ~6 sites today. Extract to `lib/superadminFetch.ts`:
```ts
export async function superadminFetch(input, init?) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Not signed in')
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}
```

### A3. Centralize input validation 🟧 S
`SLUG_RE`, `EMAIL_RE`, `VALID_ROLES`, `VALID_STATUSES`, the `tenant_number`
4-digit regex — defined inline in 3 different routes. Move to
`lib/validation/tenants.ts` so a future schema change is one file edit.

### A4. Centralize storage path construction 🟧 S
Four call sites build `loto-photos` paths inline (photoUpload.ts,
PlacardPdfPreview.tsx, departments/[dept]/page.tsx, SpacePhotoSlot.tsx).
The tenant prefix is duplicated logic that could drift. Extract:
```ts
// lib/storagePaths.ts
export function equipmentPhotoPath(tenantId, equipmentId, type, ts)
export function placardPdfPath(tenantId, equipmentId)
export function signedPlacardPath(tenantId, equipmentId, ts)
export function confinedSpacePhotoPath(tenantId, spaceId, slot, ts)
```

### A5. Tighten `as unknown as` casts on Supabase embeds 🟧 M
Four sites use `as unknown as RawType[]` to work around Supabase's
many-to-one being typed as array. Better long-term: run `npm run db:types`
to generate `lib/database.types.ts` and pass it as the generic to
`createClient<Database>(...)`. That removes most casts and gives us
narrowed inserts/selects everywhere.

### A6. Resolve the legacy per-user sessionStorage key 🟧 S
`TenantProvider` writes the active tenant to **two** keys:
`soteria.activeTenantId.{userId}` (legacy per-user) and
`soteria.activeTenantId` (Phase 4C, read by the fetch wrapper). Pick one.
The fetch wrapper requires the second; the per-user version was over-
engineered for a multi-user-on-same-browser case we don't actually have.

### A7. `tenant_id` on `uploadQueue.QueuedUpload` should be required 🟧 S
Made optional in Phase 5 for back-compat with pre-Phase-5 queued items.
Now that the deploy has shipped and queues drained, tighten it.

### A8. Replace `confirm()` / `prompt()` with proper modals 🟧 M
The reset-demo / cancel-invite / system-delete flows use the browser's
native `confirm()` and `prompt()`. They're ugly, can't be styled,
inconsistent on mobile, and skipped by some browsers. Build a small
`<ConfirmDialog>` component (the codebase already has `components/ui/`).

### A9. Stale `TODO(phase-D)` comment 🟧 S
`app/api/superadmin/tenants/[number]/reset-demo/route.ts` line 27 still
says "TODO(phase-D)" but Phase D shipped. Remove or update.

### A10. `is_demo` hard-coded to tenant 0002 in reset-demo 🟧 S
`if (tenant.tenant_number === '0002') reseed()` — second `is_demo` tenant
won't auto-reseed. Generalize: when `is_demo === true`, look up a seed
function name (e.g. `tenant.settings.seed_function`) or just always call
`seed_wls_demo()` if it exists. Won't matter until you have a 3rd
demo tenant; flag for then.

---

## B. Edge cases (test these by hand or write tests)

### B1. Tenant switch while a request is in flight 🟨 M
User clicks Snak King → request fires → user clicks WLS Demo before
response → response arrives with Snak King data, gets rendered "as if"
it's WLS Demo. Reproduce: throttle network, switch tenant, watch the
header pill flash old data. Fix: tag every fetch with a request ID and
discard responses that don't match the current tenant.

### B2. Reset Demo while a viewer is reading the demo tenant 🟨 M
Superadmin clicks "Wipe & re-seed" → the viewer's open page re-queries
and gets empty results mid-session. Acceptable for a demo tenant but
worth a clear UI signal (toast: "Demo data was just reset — refresh").

### B3. Tenant disabled mid-session 🟨 S
`tenants.status = 'disabled'` makes `current_user_tenant_ids()` exclude
it. The user's open page silently starts returning empty results. UX:
add a `useTenant()` watcher that toasts "Your tenant was disabled — sign
out" and forces a sign-out.

### B4. Email-case collision 🟨 S
Server lowercases the email before insert, but the UI shows whatever the
user typed in the result panel. If the same person is invited as
"Bob@x.com" and "bob@x.com", the second 409s — but the toast says the
typed casing, not the canonical. Minor.

### B5. Sequence wraparound — `tenant_number_seq` past 9999 🟨 S
`tenant_number text check (~ '^[0-9]{4}$')` will reject `'10000'`. Doc'd
in the schema header but not tested. Add a unit test that exercises
`next_tenant_number()` in a loop to confirm the failure is loud (Postgres
CHECK violation, not silent). Migration to widen the regex when we
approach the cap.

### B6. Concurrent role changes 🟨 S
Two superadmins in two tabs change the same membership's role. Last
writer wins; no conflict detection, no audit-log warning. For the team
size (1 superadmin) this is fine. Note for record.

### B7. Logo upload edge cases 🟨 S
- File > 1MB rejected by API but the UI shows a generic "Upload failed"
  rather than "File too big — must be ≤ 1MB". Surface the error message.
- File renamed to `.png` but content is PDF: server validates MIME from
  the upload header; that header can be spoofed. Acceptable since we
  trust the superadmin role, but worth a sniff in the future.

### B8. Owner self-demote on last-owner 🟨 S
The DELETE `/api/superadmin/tenants/[number]/members/[user_id]` route
refuses to remove the last owner. PATCH role-change does the same. But
what if the user is BOTH the last owner AND superadmin? They can still
escape via system-delete (which has its own last-owner check). Smoke-test
that path.

### B9. Storage prefix UUID edge case 🟨 S
`storage_path_tenant()` parses the first segment as UUID via regex
match. What about paths with leading whitespace, double-slashes
(`//path`), or unicode lookalike characters in the UUID? Postgres should
reject the cast — but if not, the policy fails closed which is fine.
Verify by attempting an upload to `' /' + tenant_id + '/...'` and
expecting 403.

### B10. Reset Demo when WLS Demo has 0 profiles 🟨 S
`seed_wls_demo()` requires at least one row in `public.profiles` (used
as the demo supervisor). Throws if none. Runtime check + clear error
already in place; add a test.

### B11. Header-scoped RLS for cron / service-role 🟨 S
`active_tenant_id()` returns NULL when not called from PostgREST (cron,
SQL editor, supabaseAdmin). Confirmed in the migration comment. Verify
the meter-bump cron at `/api/cron/meter-bump-reminders/route.ts` still
works after the change — it uses supabaseAdmin which bypasses RLS, but
worth a deliberate run.

---

## C. Test coverage gaps

### C1. `lib/auth/superadmin.ts` — `requireSuperadmin` 🟦 M
Both gates (env allowlist + DB flag) need separate tests:
- Missing bearer → 401
- Bearer with valid token but email not in allowlist → 403
- Allowlisted email but `is_superadmin = false` → 403
- Both pass → ok=true
Mock `auth.getUser` and `supabaseAdmin.from('profiles')`.

### C2. `components/TenantProvider` 🟦 M
Smoke test the provider returns sane state:
- No userId → loading, then empty available, no tenant
- userId + 1 membership → that's the active tenant + writes both
  sessionStorage keys
- userId + 2 memberships, sessionStorage has stored choice → use it
- `switchTenant(id)` writes both keys and flips active

### C3. `components/TenantHeaderPill` 🟦 M
- Single membership, not superadmin → renders pill, not interactive
- Multiple memberships → dropdown opens, options render, switch fires
- Superadmin → fetches all tenants on first open, shows them

### C4. `lib/email/sendInvite` 🟦 S
- No RESEND_API_KEY → returns false, doesn't throw
- Resend rejects → returns false, captures to Sentry
- Subject includes tenantName when provided

### C5. API route handlers (currently zero coverage) 🟦 L
At minimum, integration-style tests for:
- `POST /api/superadmin/tenants` — happy path + 409 on duplicate slug
- `PATCH /api/superadmin/tenants/[number]` — name/status/modules/disabled_at flip
- `POST /api/superadmin/tenants/[number]/members` — new user vs existing
- `DELETE /api/superadmin/tenants/[number]/members/[user_id]` — last-owner 409
- `POST /api/superadmin/tenants/[number]/reset-demo` — 403 on non-demo
- `POST /api/superadmin/tenants/[number]/logo` — file-size + MIME rejection

These need a Supabase mock harness; ~half-day to set up, then each test
is small.

### C6. Storage RLS migration 🟦 S
A SQL test (or a manual curl check) that:
- Authed user uploads to `<their_tenant>/foo.jpg` → 200
- Authed user uploads to `<other_tenant>/foo.jpg` → 403
- Authed user uploads to `not-a-uuid/foo.jpg` → 403
- Anon read of any path → 200 (grandfathered)

### C7. Snapshot test for the `tenants.modules` jsonb defaults 🟦 S
Migration 028 hardcodes the modules object for Snak King + WLS Demo.
A small test reading the live values and asserting against the migration's
literal would catch drift if someone hand-edits in SQL.

---

## D. Observability / debugging

### D1. Structured request tags 🟪 M
Sentry calls in the new routes use mixed tag styles
(`{ route: '...' }` vs `{ source: '...', stage: '...' }`). Adopt one
shape and apply consistently. Helps grouping in Sentry.

### D2. Audit-log entries for module toggles 🟪 S
`tenants` UPDATE writes the whole row to audit_log. Querying "when was
LOTO turned off for client X" requires JSON-diffing every audit row.
Cheap improvement: a trigger that writes a separate audit_log row per
module key change. Optional — can be done later when someone needs the
report.

### D3. Log when `active_tenant_id()` parses NULL from a malformed header 🟪 S
Today the function returns NULL silently when the header is missing OR
malformed. If a buggy client starts sending `x-active-tenant: null`,
queries silently widen to "all tenants." Add a Sentry breadcrumb in the
fetch wrapper if the value isn't a UUID.

### D4. PWA service-worker cache after deploy 🟪 S
We hit this twice during the rollout. The service worker caches the
old JS bundle and ignores the new one until a hard reload. Long-term
fix: add `skipWaiting()` + a "new version available — reload" toast
that the existing `UpdateBanner` is supposed to surface. Verify the
banner actually triggers on this app's deploy flow.

### D5. listUsers pagination cap in members GET 🟪 S
`/api/superadmin/tenants/[number]/members` calls
`auth.admin.listUsers({ perPage: 200 })` once. Tenants with > 200
members would lose `last_sign_in_at` for the rest. Page through results.

---

## E. Risks to fix outright

### E1. `TenantProvider`: stale data after `switchTenant` if dropdown was open 🟥 S
After switching, `available` reflects the new state but the dropdown's
`allTenants` cache (for superadmin) doesn't refresh. If the superadmin
just created a tenant on `/superadmin/tenants/new` and then switches
via the dropdown, the new tenant doesn't appear until manual reload.
Easy fix: invalidate `allTenants` on `switchTenant` OR on a window-focus
event.

### E2. `useTenant()` returns null tenant for superadmin who's not a member 🟥 S
Superadmin who joins NO tenants would get `tenant: null` in the header
pill — pill renders nothing, app looks half-broken. Phase 4A renders
nothing for `loading || !tenant`; we should render a "no tenant — pick
one" state instead. Today this only matters if you carefully de-member
yourself from every tenant; covered for now since you're a member of
both 0001 and 0002.

### E3. Logo public URL stays in DB after Storage object is deleted 🟥 S
`DELETE /api/superadmin/tenants/[number]/logo` clears `logo_url` but
leaves the Storage object. Re-uploading overwrites at the same path,
so this is mostly fine, but a chain of "upload PNG → delete →
upload SVG" leaves the PNG forever. Add a Storage delete in the API
route.

---

## Sequencing recommendation

**Round 1 — quick wins (≈ half-day total)**
- A2 (`superadminFetch` helper)
- A3 (centralize validation)
- A4 (storage path helpers)
- A6 (kill the legacy per-user sessionStorage key)
- A7 (tighten `tenantId` to required)
- A9 (drop the stale TODO)
- E1, E3 (small fixes)

**Round 2 — file splits + tests (≈ 1 day)**
- A1 (split the 895-line page)
- C1, C2, C3, C4 (the four small unit-test files)

**Round 3 — full API integration tests (≈ 1 day)**
- C5 (mock harness + the six route tests)

**Round 4 — observability + edge cases (≈ half-day)**
- D1, D3, D5
- B1, B3, B7 (tenant-switch race, disabled-tenant UX, logo error UX)

**Defer indefinitely** unless a real need surfaces:
- A5 (db:types codegen)
- A8 (replace `confirm()`)
- A10 (generalize is_demo seed lookup)
- B5 (sequence wraparound) — at current rate, won't hit 9999 in this lifetime
- B6 (concurrent role changes) — single superadmin user
- D2 (per-key module audit) — no consumer yet
- D4 (PWA cache UX) — hot reload + Update Banner already exist; verify rather than rebuild

---

## Recommended starting point

**Round 1.** Each item is small, mostly mechanical, and the wins compound:
DRY'd code makes Round 2 file splits easier; centralized validation makes
Round 3 tests simpler. After Round 1 the codebase is meaningfully
cleaner without changing any behavior, which is the lowest-risk thing to
ship next.
