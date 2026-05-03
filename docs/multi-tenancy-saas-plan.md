# Multi-Tenancy SaaS Plan

Companion to [`multi-tenant-plan.md`](./multi-tenant-plan.md). That doc covers the
mechanics of row-level tenancy (tenants, memberships, RLS, storage paths). This
doc layers the **SaaS productisation** on top: tenant numbering, the Snak King
cutover, the demo tenant, the superadmin role, and per-tenant module toggles.

Read [`multi-tenant-plan.md`](./multi-tenant-plan.md) first — every reference to
"Phase 1/2/3/…" below means that doc's phases. This plan slots additions into
those phases rather than re-doing them.

> **Migration numbering correction.** `multi-tenant-plan.md` was written when
> the latest migration was 006. Current head is `026_loto_devices.sql`, so the
> Phase 1/2/3 migrations land at **027 / 028 / 029** — not 007/008/009. Every
> SQL filename below uses the corrected sequence.

## Decisions taken

| Question | Decision |
|---|---|
| Tenant URL strategy | Single domain (`lotoviewer.app`) + in-app tenant switcher |
| Module toggle granularity | Top-level modules only; children inherit |
| Superadmin model | `profiles.is_superadmin` flag **plus** `SUPERADMIN_EMAILS` env allowlist (both required) |
| Demo tenant content | Full seed across LOTO, Confined Spaces, Hot Work, training, audit |
| Tenant ID convention | UUID PK (for FKs/RLS) + 4-digit `tenant_number` (for humans/URLs/logs) |
| First tenant | Snak King = `0001`, assigned to the existing populated database |
| Demo tenant | `0002` "WLS Demo", seeded |
| Numbering policy | Sequential, zero-padded, never reused |

## Architecture additions on top of multi-tenant-plan.md

### A1. `tenants.tenant_number` — the 4-digit human ID

Add a `tenant_number` column to `tenants` so support tickets, log lines, and
the URL-bar breadcrumb can reference a stable, human-friendly ID without
exposing UUIDs.

```sql
alter table public.tenants
  add column if not exists tenant_number text unique
    check (tenant_number ~ '^[0-9]{4}$');

-- Sequence drives the next number. Start at 1 so the first allocation is 0001.
create sequence if not exists public.tenant_number_seq start 1 minvalue 1;

create or replace function public.next_tenant_number()
returns text
language sql
as $$
  select lpad(nextval('public.tenant_number_seq')::text, 4, '0')
$$;
```

**Why a sequence + a checked text column instead of an integer:**
zero-padded display is the dominant use case (URLs, support tickets, exports),
and storing the canonical form avoids 17 places forgetting to format it. The
CHECK constraint keeps anything but `^[0-9]{4}$` out.

**4-digit ceiling:** 9,999 tenants. If we ever cross that, widen the CHECK to
`^[0-9]{4,5}$` and keep the existing 4-digit numbers — old IDs stay valid.

### A2. `tenants.is_demo` — the demo flag

```sql
alter table public.tenants
  add column if not exists is_demo boolean not null default false;
```

`is_demo = true` enables three behaviours:
- The "Reset demo" button (superadmin only) is visible.
- A header banner reads "Demo environment — data resets nightly" (or however we
  decide to communicate it).
- Cron job `/api/cron/reset-demo` is allowed to wipe + re-seed this tenant only.

### A3. `tenants.modules` — per-tenant module enablement

Top-level module toggles live in a JSONB column on `tenants`:

```sql
alter table public.tenants
  add column if not exists modules jsonb not null default '{}'::jsonb;

-- modules looks like:
-- {"loto": true, "confined-spaces": false, "hot-work": false,
--  "near-miss": false, "jha": false,
--  "reports-scorecard": true, "reports-insights": false,
--  "reports-compliance-bundle": true, "reports-inspector": true,
--  "admin-loto-devices": false, "admin-webhooks": false}
```

**Why JSONB and not a `tenant_modules` join table:** the toggle set is the
top-level modules from the feature registry — about a dozen keys, all known at
build time. A flat JSONB column is one row per tenant, no join, easy to read in
the admin UI. We can switch to a join table later if we ever need per-toggle
audit history; until then this is the obvious choice.

**Module catalogue is a derived list, not a stored one.** The set of valid
keys comes from `lib/features.ts` (`getModules('safety')`,
`getModules('reports')`, `getModules('admin')`). The admin UI renders one
checkbox per top-level module discovered there, so adding a new module to
`features.ts` automatically adds a row to the toggle UI without a migration.

### A4. `profiles.is_superadmin` + env allowlist

```sql
alter table public.profiles
  add column if not exists is_superadmin boolean not null default false;
```

Plus a new env var:

```
SUPERADMIN_EMAILS=devj1975@example.com
```

(comma-separated, server-side only, never exposed to the browser).

Authorization helper, both checks required:

```ts
// lib/auth/superadmin.ts
export async function requireSuperadmin(): Promise<void> {
  const { user, profile } = await getServerSession()
  if (!user || !profile) throw forbidden()
  if (!profile.is_superadmin) throw forbidden()
  const allowlist = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!allowlist.includes(user.email.toLowerCase())) throw forbidden()
}
```

Both gates must pass: a DB-write attacker who flips `is_superadmin` still can't
hit the routes without controlling an allow-listed email; conversely, an
allow-listed email without the DB flag also can't (so removing access is a
single SQL update, no redeploy).

`profiles` RLS additions for the new column: superadmins can read/write any
profile; everyone else only their own (already true today).

## Phase-by-phase additions

The base plan's seven phases stand. Below are the **additional steps** layered
into each.

### Phase 0 — Prep (additions)

- Add `SUPERADMIN_EMAILS` to the env doc and to Vercel project env (Production
  + Preview).
- Confirm the live Snak King DB is the one we want to brand as `0001` (it is —
  it has the migrated data).

### Phase 1 — Data model (additions to `027_multi_tenant_schema.sql`)

Add the columns and helpers from sections A1–A4 above to the same migration as
the base `tenants` / `tenant_memberships` tables. One migration, atomic.

### Phase 2 — Backfill (changes to `028_multi_tenant_backfill.sql`)

Replace the base plan's "legacy" tenant with **Snak King as `0001`** and create
the **demo tenant as `0002`** in the same migration:

```sql
-- 028: assign Snak King to tenant 0001, create demo tenant 0002.

insert into public.tenants (slug, name, tenant_number, is_demo, modules)
values
  ('snak-king', 'Snak King',
    public.next_tenant_number(),  -- 0001
    false,
    '{"loto": true,
      "confined-spaces": false,
      "hot-work": false,
      "near-miss": false,
      "jha": false,
      "reports-scorecard": true,
      "reports-insights": true,
      "reports-compliance-bundle": true,
      "reports-inspector": true,
      "admin-loto-devices": true,
      "admin-configuration": true,
      "admin-webhooks": true,
      "admin-training": false,
      "admin-hygiene-log": true,
      "settings-notifications": true,
      "support": true}'::jsonb)
on conflict (slug) do nothing;

insert into public.tenants (slug, name, tenant_number, is_demo, modules)
values
  ('wls-demo', 'WLS Demo',
    public.next_tenant_number(),  -- 0002
    true,
    '{"loto": true,
      "confined-spaces": true,
      "hot-work": true,
      "near-miss": false,
      "jha": false,
      "reports-scorecard": true,
      "reports-insights": true,
      "reports-compliance-bundle": true,
      "reports-inspector": true,
      "admin-loto-devices": true,
      "admin-configuration": true,
      "admin-webhooks": true,
      "admin-training": true,
      "admin-hygiene-log": true,
      "settings-notifications": true,
      "support": true}'::jsonb)
on conflict (slug) do nothing;

-- Backfill every existing domain row to Snak King (tenant 0001).
update public.loto_equipment
   set tenant_id = (select id from public.tenants where slug='snak-king')
 where tenant_id is null;

-- ...same for loto_energy_steps, loto_reviews, loto_confined_spaces,
-- loto_confined_space_permits, loto_atmospheric_tests,
-- loto_hot_work_permits, loto_hot_work_checklists,
-- training_records, loto_devices, audit_log, push_subscriptions,
-- webhooks, photo_annotations, ...
```

The full list of tables to backfill is every domain table in migrations 001–026
plus any added before Phase 2 actually runs. Generate it from
`information_schema.columns where column_name='tenant_id'` and grep the result
into the migration before applying it.

**Existing users → Snak King memberships:**

```sql
insert into public.tenant_memberships (user_id, tenant_id, role)
select u.id, (select id from public.tenants where slug='snak-king'), 'member'
from auth.users u
on conflict do nothing;

-- Promote existing admins to 'owner' of Snak King.
update public.tenant_memberships
   set role = 'owner'
 where tenant_id = (select id from public.tenants where slug='snak-king')
   and user_id in (select id from public.profiles where is_admin = true);
```

### Phase 3 — Lock down (additions)

The base plan's `029_multi_tenant_rls.sql` rewrites every `_authenticated_all`
policy as `tenant_scope`. Two additional policies:

```sql
-- Superadmin bypass: superadmins read/write across all tenants. Used for the
-- /superadmin onboarding screens and demo reset. Belt-and-suspenders with the
-- env allowlist enforced at the route layer — RLS alone is not enough.
create or replace function public.is_superadmin()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
$$;

-- Add an OR clause to each tenant-scoped policy:
--   using (tenant_id in (select public.current_user_tenant_ids())
--          or public.is_superadmin())
```

Apply this OR clause to all `*_tenant_scope` policies generated in Phase 3.

### Phase 4 — App code (additions)

In addition to the base plan's `TenantProvider`, ship:

#### 4e. Tenant header banner

`components/AppChrome.tsx` shows the active tenant name + 4-digit number in the
header. If `tenants.is_demo`, render a yellow demo banner.

#### 4f. Module-aware drawer

`components/AppDrawer.tsx` already iterates `getModules(category)`. Wrap that
with the resolved tenant flags:

```ts
// components/AppDrawer.tsx (sketch)
const { modules } = useTenant()  // jsonb modules from tenants row
const visible = (id: string) => modules[id] ?? false

const safetyModules = getModules('safety').filter(m => visible(m.id))
```

`resolveFeatureFlags(tenantId)` in `lib/features.ts` becomes the single point
that merges the static catalog with `tenants.modules`. Update its body:

```ts
export async function resolveFeatureFlags(tenantId?: string): Promise<Map<string, FeatureDef>> {
  const map = new Map(FEATURES.map(f => [f.id, f]))
  if (!tenantId) return map
  const { data } = await supabase
    .from('tenants').select('modules').eq('id', tenantId).single()
  const overrides: Record<string, boolean> = data?.modules ?? {}
  for (const [id, def] of map) {
    if (def.parent) {
      // Children inherit their parent's toggle.
      const parentEnabled = overrides[def.parent] ?? def.enabled
      map.set(id, { ...def, enabled: parentEnabled })
    } else if (id in overrides) {
      map.set(id, { ...def, enabled: overrides[id] })
    }
  }
  return map
}
```

#### 4g. Route guards

Every page under a togglable module checks the resolved flag and 404s if off.
Cheapest hook: a server-side helper used in each module's `layout.tsx`:

```ts
// app/loto/layout.tsx, app/confined-spaces/layout.tsx, app/hot-work/layout.tsx
import { requireModule } from '@/lib/auth/requireModule'
export default async function Layout({ children }) {
  await requireModule('loto')  // throws notFound() if the active tenant has it off
  return children
}
```

`requireModule` reads the active tenant from cookies/session and the
`tenants.modules` JSONB.

### Phase 5 — Storage (no changes)

Base plan applies as written. Snak King's existing storage path is
`loto-photos/{equipment_id}/...`; the base plan's optional migration to
`loto-photos/{tenant_id}/{equipment_id}/...` is recommended for Snak King too
so the layout is uniform across tenants from day one.

### Phase 6 — Onboarding flows (replaces base plan's section)

The base plan's `/admin/tenants/new` becomes **`/superadmin/tenants/new`** —
gated by `requireSuperadmin()`. Three new screens:

#### 6a. `/superadmin/tenants` (list)

- Table of all tenants: number, name, slug, member count, modules summary,
  created date, demo flag.
- Actions per row: View / Edit modules / Invite member / Disable.
- "+ New tenant" button.

#### 6b. `/superadmin/tenants/new`

Form:
- Tenant name (e.g. "Acme Refining")
- Slug (auto-derived from name, editable)
- Owner email (will receive an invite)
- Modules (checkboxes, top-level only — children inherit)
- Demo flag (default off; setting it on offers to seed)

Submit → server action:
1. `requireSuperadmin()`
2. Insert `tenants` row with `tenant_number = next_tenant_number()`.
3. Send Supabase invite to owner email.
4. Pre-create a `tenant_memberships` row with `role='owner'` and a placeholder
   user_id flag — resolved on invite acceptance via a DB trigger that ties
   `auth.users.email` to the pending row.
5. If `is_demo`, run the seed function (see Phase D below).

#### 6c. `/superadmin/tenants/[number]`

Single-tenant view: members list, modules editor (inline checkboxes),
"Send invite", "Reset demo" (visible only when `is_demo`), audit-log peek.

#### 6d. Tenant switcher (any user with >1 membership)

Dropdown in `AppChrome.tsx`. Updates `useTenant().switchTenant(id)`. Stored in
sessionStorage. Re-fetches `resolveFeatureFlags(tenantId)` on switch.

#### 6e. First-run flow

Sign-in with zero memberships → redirect to a "Waiting for invite acceptance"
page (since superadmin always provisions tenants ahead of users, this should
be rare; still need it to fail informatively).

### Phase 7 — Cleanup (additions)

Add tenant-isolation tests (base plan covers this) **plus**:
- A test that flips `tenants.modules.loto = false` for a tenant and asserts
  every `/loto`, `/status`, `/departments`, `/print`, `/import`,
  `/decommission` route 404s for that tenant's users.
- A test that asserts a non-superadmin user cannot reach any `/superadmin/*`
  route, and cannot mutate `tenants.modules` directly via Supabase.

## Phase D — Demo tenant seeding

**New phase, runs once after Phase 3 ships.** Lives in
`migrations/030_seed_demo_tenant.sql` (or a TypeScript script under `lib/seed/`
called from a one-off `npm run seed:demo`).

The seed should produce a believable, "showable" demo. Approximate counts:

| Module | Rows | Notes |
|---|---|---|
| `loto_equipment` | ~30 | Mix of departments (Packaging, Frying, Maintenance), a few decommissioned, photo placeholders |
| `loto_energy_steps` | ~80 | 2–3 per equipment, varied energy types |
| `loto_reviews` | 4 | One per major department, signed |
| `loto_confined_spaces` | 6 | Mix of permit-required + non-permit |
| `loto_confined_space_permits` | 3 | One active, two completed |
| `loto_atmospheric_tests` | 12 | Realistic O₂/LEL/H₂S/CO readings |
| `loto_hot_work_permits` | 5 | One active with a fire watcher, four completed |
| `loto_hot_work_checklists` | 30 | Realistic answers |
| `training_records` | 20 | Demo inspectors + entrants with mixed expiry dates |
| `loto_devices` | 15 | Lock + tag inventory with checkout history |
| `audit_log` | n/a | Generated naturally as the seed runs |

Photo assets: a small set of generic, copyright-clean industrial photos under
`public/demo/` referenced by URL. Don't ship Snak King photos in the demo.

The "Reset demo" superadmin action runs `truncate ... where tenant_id = 0002`
on every domain table, then re-runs the seed. **Restricted by RLS to the demo
tenant's `tenant_id` only** — there must be no path by which Reset Demo can
truncate Snak King.

## Files that need to change (rough inventory)

This is the change footprint relative to the base plan. The base plan covers
the long list of `supabase.from('loto_*')` call sites; below are SaaS-only
touchpoints.

**New files:**
- `migrations/027_multi_tenant_schema.sql` — base + sections A1–A4
- `migrations/028_multi_tenant_backfill.sql` — Snak King + demo tenant
- `migrations/029_multi_tenant_rls.sql` — base + superadmin bypass
- `migrations/030_seed_demo_tenant.sql` *or* `lib/seed/demoTenant.ts` + `npm run seed:demo`
- `migrations/031_storage_tenant_scope.sql` — base plan Phase 5
- `lib/auth/superadmin.ts` — `requireSuperadmin()`
- `lib/auth/requireModule.ts` — module-flag route guard
- `lib/seed/demoTenant.ts` — used by both the migration and the Reset Demo button
- `components/TenantProvider.tsx` — base plan
- `app/superadmin/layout.tsx` — wraps every superadmin route in `requireSuperadmin()`
- `app/superadmin/tenants/page.tsx` — list
- `app/superadmin/tenants/new/page.tsx` — create
- `app/superadmin/tenants/[number]/page.tsx` — manage
- `app/api/superadmin/reset-demo/route.ts` — POST, gated, demo-only

**Modified files:**
- `lib/features.ts` — finish `resolveFeatureFlags(tenantId)` (currently a stub)
- `components/AppChrome.tsx` — tenant header + switcher dropdown + demo banner
- `components/AppDrawer.tsx` — filter modules through resolved flags
- `components/AuthGate.tsx` — redirect zero-membership users; pass active tenant
- `app/layout.tsx` — mount `TenantProvider`
- `app/loto/layout.tsx`, `app/confined-spaces/layout.tsx`, `app/hot-work/layout.tsx` — `requireModule()` guard
- `lib/types.ts` — `Tenant`, `TenantMembership`, `TenantRole`, extend `Profile` with `is_superadmin`
- `vercel.json` / env docs — `SUPERADMIN_EMAILS`
- `__tests__/integration/tenant-isolation.test.ts` — base plan
- `__tests__/integration/module-toggles.test.ts` — new
- `__tests__/integration/superadmin-only.test.ts` — new
- `PROJECT_OVERVIEW.md` — note the multi-tenant transition

## Open questions to resolve before we start coding

These don't block the plan but want explicit answers before each touches code:

1. **Pre-Phase-1 backup.** When do we take the snapshot? Recommend: right
   before applying migration 027, in the same change-window as the deploy.
2. **Inviting Snak King users.** Phase 2 auto-grants every existing
   `auth.users` membership of Snak King. Do we want to instead curate the list
   (drop test accounts, etc.)? Recommend: take a list of who's currently real
   before running 028 and prune in the migration.
3. **Tenant deletion semantics.** "Disable" vs hard delete. Recommend: a
   `tenants.disabled_at timestamptz` soft-delete; never `delete from tenants`
   in the app — there's too much FK fan-out and audit value to throw away.
4. **Demo tenant credentials.** Single shared "demo@wls.example" login that
   WLS hands to prospects, or per-prospect short-lived invites? Recommend:
   one shared `member`-role demo login plus a "Demo viewer" role that's
   read-only — keeps the data clean across multiple parallel demos.
5. **Subdomain branding (revisit later).** Single domain ships first. If a
   client asks for `acme.lotoviewer.app` we add wildcard DNS + a
   middleware.ts that maps host → tenant_id and forces the active tenant.
   Tracked but not in scope now.

## Effort

On top of the base plan's ~17 days:

| Task | Effort |
|---|---|
| Sections A1–A4 in migration 027 | +0.5 day |
| Snak King + demo tenant in migration 028 | +0.5 day |
| Superadmin RLS bypass + helper | +0.5 day |
| `resolveFeatureFlags` wiring + module route guards | +1 day |
| `/superadmin/*` UI (3 pages + API) | +3 days |
| Demo seed script + Reset Demo flow | +2 days |
| Module-toggle integration tests | +1 day |
| **SaaS-layer total** | **~8.5 days** |

Combined with the base plan: **~25.5 engineering days**, sequential, with
inevitable pauses for testing each phase. Realistic calendar: 6–10 weeks
shipping in off-hours around normal feature work.

## Sequencing recommendation

1. Phase 0 (prep, backup, env vars) — 0.5 day
2. Phase 1 + A1–A4 in one migration (027) — 1 day
3. Phase 2 (Snak King + demo tenants, backfill) — 1 day
4. Phase 3 + superadmin RLS (029) **on staging first** — 2 days
5. Phase 4 + module guards + `TenantProvider` — 6 days
6. Phase 5 storage migration — 2 days
7. Phase D demo seed — 2 days
8. Phase 6 superadmin UI + tenant switcher — 4 days
9. Phase 7 cleanup + leakage / module / superadmin tests — 3 days

Don't fork phases. Each one is independently reversible; combining them turns
a single RLS typo into a customer-visible outage.
