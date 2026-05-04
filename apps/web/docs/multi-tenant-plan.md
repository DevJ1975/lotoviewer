# Multi-Tenant Plan for lotoviewer-1

**Goal:** turn the current single-tenant LOTO PWA into a multi-tenant SaaS so each client (plant, facility, or customer org) has fully isolated data while sharing one deployment.

**Chosen model:** row-level tenancy (shared DB, shared schema, `tenant_id` column on every domain table) enforced by Supabase RLS. This is the cheapest to run, the fastest to build, and fits a small-to-mid client count. If a single large client eventually needs their own database for compliance reasons, you can migrate that one tenant out later — the code path is the same.

**Not chosen** (and why):
- *Schema-per-tenant* — complicates migrations (you have to apply them per schema), and Supabase tooling assumes the public schema.
- *Database-per-tenant* from day one — 10× the ops cost, and you don't have 10 clients yet. Revisit if you land a customer who requires a separate database in their contract.

## Phase overview

| Phase | What | Risk | Ship target |
|---|---|---|---|
| 0 | Prep: document current RLS, back up DB | low | before any migration |
| 1 | Data model: tenants, memberships, tenant_id columns (nullable) | low | one migration |
| 2 | Backfill: assign all existing rows to a "legacy" tenant | low | one migration, one UPDATE |
| 3 | Lock down: set tenant_id NOT NULL, rewrite RLS | **medium** — breaks reads if an RLS policy is wrong | one migration, tested first |
| 4 | App code: current-tenant context, scope every query | medium | several PRs |
| 5 | Storage: tenant-prefixed paths, RLS on storage.objects | medium | one migration + code |
| 6 | Onboarding flows: create tenant, invite users, switch tenant | low (new feature) | shipped per feature |
| 7 | Cleanup: remove the legacy-tenant shim, add tenant-leakage tests | low | after phase 6 |

Don't skip phases. Each one is independently reversible and independently testable; glom them together and a single RLS typo takes down every read query in production.

## Phase 0 — Prep

1. **Snapshot the database.** Supabase dashboard → Database → Backups → take one on-demand backup before Phase 1.
2. **Document current RLS.** For every table in `public`, grab `select polname, polcmd, polqual, polwithcheck from pg_policies where schemaname='public';` and save the output. You'll need to rewrite every one of these in Phase 3.
3. **Pick an ID convention.** Use `uuid` for `tenant_id` (matches Supabase's `auth.uid()`) rather than a slug — slugs can change, UUIDs can't.
4. **Decide on user-belongs-to-many-tenants or one-tenant-per-user.** One-tenant-per-user is simpler (tenant_id becomes a column on `profiles` and you stop). Many-tenants-per-user needs a membership table and a "current tenant" switcher. The rest of this doc assumes many-per-user because it's the more flexible option; cut it down if you only need one.

## Phase 1 — Data model

Write this as `migrations/007_multi_tenant_schema.sql`. Everything is nullable / additive at this phase — no existing queries break.

```sql
-- 007: tenants, memberships, and nullable tenant_id on domain tables.
-- Backfill + NOT NULL + RLS happen in later migrations.

create extension if not exists "pgcrypto";

create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,   -- e.g. "acme-refining" for URLs and logs
  name        text not null,
  created_at  timestamptz not null default now(),
  -- Optional: per-tenant branding/config as JSONB so you don't keep adding columns
  settings    jsonb not null default '{}'::jsonb
);

-- Role values are free-form strings to keep it flexible, but keep the set small:
-- 'owner'   — full admin, can invite / remove members, delete tenant
-- 'admin'   — everything except deleting the tenant
-- 'member'  — standard field-worker access (upload photos, run placards)
-- 'viewer'  — read-only
create table if not exists public.tenant_memberships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  role        text not null default 'member',
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index if not exists idx_memberships_tenant on public.tenant_memberships(tenant_id);
create index if not exists idx_memberships_user   on public.tenant_memberships(user_id);

-- Nullable tenant_id on every domain table. NOT NULL is set in migration 009.
alter table public.loto_equipment     add column if not exists tenant_id uuid references public.tenants(id);
alter table public.loto_energy_steps  add column if not exists tenant_id uuid references public.tenants(id);
alter table public.loto_reviews       add column if not exists tenant_id uuid references public.tenants(id);

-- audit_log (if present) — audit rows get a tenant_id too, but nullable forever
-- is fine since cross-tenant admin actions may legitimately have none.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='audit_log') then
    alter table public.audit_log add column if not exists tenant_id uuid references public.tenants(id);
  end if;
end $$;

-- Composite indexes so the RLS predicate (tenant_id = X) is cheap on big tables.
create index if not exists idx_equipment_tenant     on public.loto_equipment(tenant_id);
create index if not exists idx_energy_steps_tenant  on public.loto_energy_steps(tenant_id);
create index if not exists idx_reviews_tenant       on public.loto_reviews(tenant_id);

notify pgrst, 'reload schema';
```

## Phase 2 — Backfill

`migrations/008_multi_tenant_backfill.sql`.

```sql
-- 008: create a "legacy" tenant and assign every pre-existing row to it.
-- Idempotent — re-running is a no-op once rows have tenant_ids.

insert into public.tenants (slug, name)
values ('legacy', 'Legacy (pre-multi-tenant)')
on conflict (slug) do nothing;

-- Give every currently-authenticated user membership of the legacy tenant
-- so their existing access isn't broken by Phase 3.
insert into public.tenant_memberships (user_id, tenant_id, role)
select u.id, t.id, 'member'
from auth.users u
cross join public.tenants t
where t.slug = 'legacy'
on conflict do nothing;

-- Backfill domain rows.
update public.loto_equipment
   set tenant_id = (select id from public.tenants where slug='legacy')
 where tenant_id is null;

update public.loto_energy_steps
   set tenant_id = (select id from public.tenants where slug='legacy')
 where tenant_id is null;

update public.loto_reviews
   set tenant_id = (select id from public.tenants where slug='legacy')
 where tenant_id is null;

-- audit_log: only backfill rows that have a clear tenant context. Ambiguous
-- rows stay NULL (will stay NULL forever since the column is nullable).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='audit_log') then
    update public.audit_log a
       set tenant_id = (select id from public.tenants where slug='legacy')
     where a.tenant_id is null
       and a.row_id in (select equipment_id from public.loto_equipment);
  end if;
end $$;

-- Promote the first user (or whoever's marked is_admin) to 'owner' of the
-- legacy tenant so someone can invite others.
update public.tenant_memberships
   set role = 'owner'
 where tenant_id = (select id from public.tenants where slug='legacy')
   and user_id in (select id from public.profiles where coalesce(is_admin, false) = true);
```

After running it, manually verify in Supabase SQL Editor:
```sql
select 'equipment' as t, count(*) from loto_equipment where tenant_id is null
union all select 'steps', count(*) from loto_energy_steps where tenant_id is null
union all select 'reviews', count(*) from loto_reviews where tenant_id is null;
```
Every count must be zero before moving to Phase 3.

## Phase 3 — Lock down (the risky one)

`migrations/009_multi_tenant_rls.sql`. **Run this in a staging/branch database first.** A typo in an RLS `using` clause will make every read return zero rows in production.

```sql
-- 009: enforce tenant isolation. NOT NULL tenant_id, rewritten RLS.

-- Helper that reads the caller's memberships once per query.
create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select tenant_id from public.tenant_memberships where user_id = auth.uid()
$$;

alter table public.loto_equipment    alter column tenant_id set not null;
alter table public.loto_energy_steps alter column tenant_id set not null;
alter table public.loto_reviews      alter column tenant_id set not null;

-- Replace the existing "authenticated_all" policies with tenant-scoped ones.
drop policy if exists "loto_equipment_authenticated_all"    on public.loto_equipment;
drop policy if exists "loto_energy_steps_authenticated_all" on public.loto_energy_steps;

create policy "loto_equipment_tenant_scope" on public.loto_equipment
  for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

create policy "loto_energy_steps_tenant_scope" on public.loto_energy_steps
  for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

create policy "loto_reviews_tenant_scope" on public.loto_reviews
  for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

-- Tenants table: users can see tenants they belong to.
alter table public.tenants enable row level security;
drop policy if exists "tenants_member_read" on public.tenants;
create policy "tenants_member_read" on public.tenants
  for select to authenticated
  using (id in (select public.current_user_tenant_ids()));

-- Memberships: users can read their own rows; owners/admins read all rows in their tenant.
alter table public.tenant_memberships enable row level security;
drop policy if exists "memberships_self_read"  on public.tenant_memberships;
drop policy if exists "memberships_owner_all"  on public.tenant_memberships;
create policy "memberships_self_read" on public.tenant_memberships
  for select to authenticated
  using (user_id = auth.uid());
create policy "memberships_owner_all" on public.tenant_memberships
  for all to authenticated
  using (tenant_id in (
    select tenant_id from public.tenant_memberships
     where user_id = auth.uid() and role in ('owner','admin')
  ))
  with check (tenant_id in (
    select tenant_id from public.tenant_memberships
     where user_id = auth.uid() and role in ('owner','admin')
  ));

notify pgrst, 'reload schema';
```

**Pre-flight checklist for Phase 3:**
- Clone the prod DB to a staging project.
- Apply migrations 007, 008, 009 on staging.
- Log in as a member of the legacy tenant. Open the dashboard. Every row must still be visible.
- Log in as a user with *no* membership. Every domain query must return zero rows.
- Only then apply to prod.

**Rollback** (in case you botch Phase 3 on prod): `drop policy` each tenant-scoped policy, re-create the old `authenticated_all` policies, `alter column tenant_id drop not null`. Don't drop the tenant_id column itself — you'll just have to re-backfill.

## Phase 4 — Application code

### 4a. Current-tenant context

Add `components/TenantProvider.tsx` analogous to `SessionProvider`. It:
- Reads the current user's memberships via `supabase.from('tenant_memberships').select('tenant_id, role, tenants(slug, name)')`
- Caches the active `tenant_id` in `sessionStorage`
- Exposes `useTenant() → { tenantId, tenantSlug, role, tenants, switchTenant(id) }`
- Default active tenant: the user's only membership, or the last-used one from sessionStorage.

Mount it under `SessionProvider` in `app/layout.tsx`.

### 4b. Scope every query (belt-and-suspenders with RLS)

Even though RLS enforces isolation at the DB layer, the app should filter by tenant for *clarity* and *safer failure modes* (e.g. if RLS is somehow disabled, the query still scopes correctly).

Find every `supabase.from('loto_...')` call and add `.eq('tenant_id', tenantId)`. Key files from memory:
- [hooks/usePhotoUpload.ts](../hooks/usePhotoUpload.ts)
- [components/UploadQueueProvider.tsx](../components/UploadQueueProvider.tsx)
- [components/dashboard/PlacardDetailPanel.tsx](../components/dashboard/PlacardDetailPanel.tsx)
- [app/page.tsx](../app/page.tsx)
- [app/equipment/[id]/page.tsx](../app/equipment/[id]/page.tsx)
- [app/import/page.tsx](../app/import/page.tsx)
- [app/departments/page.tsx](../app/departments/page.tsx)
- [components/GlobalSearch.tsx](../components/GlobalSearch.tsx)
- [components/equipment/AddEquipmentDialog.tsx](../components/equipment/AddEquipmentDialog.tsx)
- [components/placard/PlacardPdfPreview.tsx](../components/placard/PlacardPdfPreview.tsx)
- [components/BatchPrintModal.tsx](../components/BatchPrintModal.tsx)

Every `INSERT` and `UPSERT` must include `tenant_id: currentTenantId` in its payload, or the RLS `with check` blocks it.

### 4c. CSV import / add-equipment dialogs

In [lib/csvImport.ts](../lib/csvImport.ts), add `tenant_id` to every row built in `row.insert()`. In [components/equipment/AddEquipmentDialog.tsx](../components/equipment/AddEquipmentDialog.tsx), add it to the insert payload.

### 4d. Realtime subscriptions

[app/page.tsx](../app/page.tsx) subscribes to `loto_equipment_changes`. Supabase realtime honors RLS, so you'll only get events for rows in your tenant — but add a filter for clarity:
```ts
.on('postgres_changes', { event: '*', schema: 'public', table: 'loto_equipment', filter: `tenant_id=eq.${tenantId}` }, ...)
```

## Phase 5 — Storage

Photos currently land at `loto-photos/{sanitized_id}/{equipment_id}_{type}_{ts}.jpg` (see [hooks/usePhotoUpload.ts](../hooks/usePhotoUpload.ts)). Two tenants with the same equipment ID would collide. Fix by prefixing with tenant:

```ts
const storagePath = `${tenantId}/${sanitized}/${equipmentId}_${type}_${timestamp}.jpg`
```

Update every place that constructs a storage path (`usePhotoUpload`, `UploadQueueProvider`, anywhere we read `loto_photo_url` into a known path).

### Storage RLS

Replace the current `loto-photos` RLS (from migration 005) with tenant-scoped variants. Storage paths are strings, so we scope by path prefix:

```sql
-- migrations/010_storage_tenant_scope.sql
drop policy if exists "loto_photos_authenticated_insert" on storage.objects;
drop policy if exists "loto_photos_authenticated_update" on storage.objects;
drop policy if exists "loto_photos_authenticated_delete" on storage.objects;
drop policy if exists "loto_photos_public_read"          on storage.objects;

-- Upload: first path segment must be a tenant the user belongs to.
create policy "loto_photos_tenant_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'loto-photos'
    and (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids())
  );

create policy "loto_photos_tenant_update" on storage.objects
  for update to authenticated
  using      (bucket_id = 'loto-photos' and (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids()))
  with check (bucket_id = 'loto-photos' and (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids()));

create policy "loto_photos_tenant_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'loto-photos' and (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids()));

-- Public read remains by URL if you want shareable placard photo links — the
-- URL itself is the capability. If you'd rather lock reads to tenant members,
-- replace with a members-only select policy and switch client calls from
-- getPublicUrl to createSignedUrl.
create policy "loto_photos_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'loto-photos');
```

**Legacy data** lives at `loto-photos/{equipment_id}/...` without a tenant prefix. Two choices:
- Migrate: write a one-off script that moves legacy objects to `loto-photos/{legacy_tenant_id}/{equipment_id}/...` and updates every `equip_photo_url` / `iso_photo_url` in `loto_equipment`.
- Grandfather: keep public-read permissive and let the legacy objects coexist. Simpler, acceptable if you trust the existing data.

## Phase 6 — Onboarding flows

New screens:

1. **Create a tenant** (`/admin/tenants/new`) — admin-only. Server action calls `supabase.from('tenants').insert({ slug, name })` then inserts the caller as `'owner'` in `tenant_memberships`.
2. **Invite a user** (`/tenants/[slug]/members`) — owner/admin only. Sends a Supabase invite email, on acceptance creates a `tenant_memberships` row. Until accepted, show as pending in the members list.
3. **Switch tenant** — dropdown in [components/AppChrome.tsx](../components/AppChrome.tsx) header when the user has more than one membership. Updates `useTenant().switchTenant(id)` which re-renders the whole app.
4. **First-run** — if a signed-in user has zero memberships, redirect to a "create your org or accept an invite" page instead of `/`.

## Phase 7 — Cleanup and tenant-leakage tests

1. Once every active user has a real-tenant membership, you can optionally delete the "legacy" tenant — or keep it forever for historical context.
2. Write a **tenant-leakage integration test.** Cheapest form:
   ```ts
   // __tests__/integration/tenant-isolation.test.ts
   // Seed two tenants with overlapping equipment_ids.
   // Log in as user A. Assert dashboard + CSV export + PDF only show tenant A's rows.
   // Log in as user B. Same.
   // Attempt a direct supabase.from('loto_equipment').select() for tenant A's UUID while authenticated as user B — must return zero rows.
   ```
   This test catches every future query that forgets to add `tenant_id` to an insert.
3. Remove or reduce the `console.info('[placard] energy-steps fetched', ...)` logs and any other debug instrumentation that no longer matters.

## Gotchas and things that bite

**Realtime and RLS.** Supabase realtime *does* honor RLS, but broadcasts in batches — under load, a tenant A user might briefly receive a tenant B event and have it silently dropped by the filter. Double-check that your `.filter('tenant_id=eq.X')` is on the subscribe call, not just in your reconcile function.

**`auth.uid()` in SECURITY DEFINER functions.** `current_user_tenant_ids()` uses `security definer`, which bypasses RLS on `tenant_memberships` (intentional — otherwise the policy would recurse). Double-check the function is owned by a role that only has the privileges it needs; do not grant it access beyond `tenant_memberships`.

**Offline upload queue** (`lib/uploadQueue.ts`) stores blobs in IndexedDB keyed by equipment ID. When that queue drains via `UploadQueueProvider`, it needs to know the tenant — store `tenant_id` alongside the blob in IndexedDB when enqueueing, and include it on the upload path + `.insert()`. A user who signs out and in as a different tenant must not be able to drain a previous tenant's queued upload into the wrong tenant.

**Audit log.** The `audit_log` table is written by triggers. Add `tenant_id` as a column populated by the trigger (derive from `NEW.tenant_id` on inserts, from `OLD.tenant_id` on deletes). Then RLS the audit view to tenant members only, so admins can see their tenant's audit trail but not others'.

**PDFs and shareable URLs.** [components/placard/PlacardPdfPreview.tsx](../components/placard/PlacardPdfPreview.tsx) and `pdfPlacard.ts` embed photos via public URLs. Across tenants, the public URL itself is the capability — whoever has it can fetch. If a customer's contract demands strict isolation of photo content at rest, switch photo reads to `createSignedUrl` (short-lived, auth-required) and update [components/placard/PlacardPhotoSlot.tsx](../components/placard/PlacardPhotoSlot.tsx) + the PDF renderer to use signed URLs.

**Storage migration for legacy data.** If you do move the legacy photos into `/{legacy_tenant_id}/` paths, be aware that the `equip_photo_url` / `iso_photo_url` columns store absolute URLs — you must rewrite the URL columns too, not just move the blobs. Do both in a single transaction on a cloned DB first.

**"Tenant switcher" vs URL-scoped routes.** The plan above keeps URLs as-is (`/`, `/equipment/[id]`, etc.) and infers the tenant from the current-tenant context. A later, deeper version puts the tenant in the URL (`/t/[slug]/` or `acme.lotoviewer.app`) — better for shareable links, harder to retrofit later. If you think subdomain routing is inevitable (e.g. enterprise customers want their own subdomain), consider doing it in Phase 4 rather than after launch.

## Cost and limits

Supabase's free tier and paid tiers are **per project**, not per tenant. Row-level tenancy means 100 tenants = one project bill, scaled by total rows/storage/bandwidth. Good for your budget up to a few hundred tenants; after that, bottlenecks usually show up as realtime event volume before DB size.

A large customer eventually asking for their own database: at that point you spin up a second Supabase project, export their tenant's rows + storage objects, and point a subdomain at the new project. The code doesn't change — only the Supabase client's URL — because tenant-scoped queries work identically whether there's one tenant in the DB or a hundred.

## Estimated effort (calendar days, not engineer-hours)

| Phase | Effort | Notes |
|---|---|---|
| 0 | 0.5 day | backups, docs |
| 1 | 0.5 day | one migration |
| 2 | 0.5 day | backfill migration + manual verify |
| 3 | 2 days | RLS rewrite + staging test pass |
| 4 | 5 days | touching ~10+ files, careful review |
| 5 | 2 days | storage path + RLS + legacy migration |
| 6 | 4 days | new UI screens for tenant mgmt |
| 7 | 2 days | cleanup, leakage tests |
| **Total** | **~17 days** | sequential, with room for pauses |

Realistic calendar time if shipped in off-hours around normal feature work: 4–6 weeks.
