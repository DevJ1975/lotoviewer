-- Migration 033: Tenant-scoped storage RLS for loto-photos bucket
--
-- Phase 5 of the multi-tenant rollout. After this migration, every NEW
-- upload to the loto-photos bucket must use a path whose first segment
-- is the uploader's tenant_id (or be performed by a superadmin). The
-- bucket layout becomes:
--
--   loto-photos/<tenant_uuid>/<equipment_id>_EQUIP_<ts>.jpg
--   loto-photos/<tenant_uuid>/<equipment_id>_ISO_<ts>.jpg
--   loto-photos/<tenant_uuid>/<equipment_id>_placard.pdf
--   loto-photos/<tenant_uuid>/signed-placards/<eq>_<ts>.pdf
--   loto-photos/<tenant_uuid>/confined-spaces/<space>/<slot>_<ts>.jpg
--
-- LEGACY DATA (Snak King's existing uploads at the bucket root) is
-- grandfathered: the public read policy still covers them so existing
-- equip_photo_url / iso_photo_url / placard_url columns keep resolving.
-- A future migration may move them under {snak_king_uuid}/ to make the
-- layout uniform; for now the two co-exist without conflict.
--
-- Pre-flight: migrations 027 + 029 must already be applied (we depend
-- on current_user_tenant_ids() and is_superadmin()).

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- Drop the old loto-photos policies installed by migration 005.
-- The policy names are conventional; if they were renamed in another
-- environment, drop those by hand.
-- ────────────────────────────────────────────────────────────────────────────
drop policy if exists "loto_photos_authenticated_insert" on storage.objects;
drop policy if exists "loto_photos_authenticated_update" on storage.objects;
drop policy if exists "loto_photos_authenticated_delete" on storage.objects;
drop policy if exists "loto_photos_authenticated_read"   on storage.objects;
drop policy if exists "loto_photos_public_read"          on storage.objects;
-- Defensive: drop the new policy names too in case this migration is
-- being re-applied after a partial failure.
drop policy if exists "loto_photos_tenant_insert" on storage.objects;
drop policy if exists "loto_photos_tenant_update" on storage.objects;
drop policy if exists "loto_photos_tenant_delete" on storage.objects;
drop policy if exists "loto_photos_grandfathered_read" on storage.objects;

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: parse the first path segment as a UUID, NULL on failure.
-- Storage paths from legacy data don't have a UUID prefix, so the
-- coerce-and-check returns NULL there and the policy fails closed for
-- writes (which is what we want — legacy paths can't be overwritten by
-- the new client).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.storage_path_tenant(name text)
returns uuid
language sql
immutable
as $$
  -- split_part returns '' if the separator isn't found, which would
  -- make ::uuid throw — guard with a regex.
  select case
    when split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 1)::uuid
    else null
  end
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Tenant-scoped write policies: insert / update / delete all require the
-- first path segment to be a tenant the caller belongs to (or superadmin).
-- ────────────────────────────────────────────────────────────────────────────
create policy "loto_photos_tenant_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'loto-photos'
    and (
      public.is_superadmin()
      or public.storage_path_tenant(name) in (select public.current_user_tenant_ids())
    )
  );

create policy "loto_photos_tenant_update" on storage.objects
  for update to authenticated
  using      (
    bucket_id = 'loto-photos'
    and (
      public.is_superadmin()
      or public.storage_path_tenant(name) in (select public.current_user_tenant_ids())
    )
  )
  with check (
    bucket_id = 'loto-photos'
    and (
      public.is_superadmin()
      or public.storage_path_tenant(name) in (select public.current_user_tenant_ids())
    )
  );

create policy "loto_photos_tenant_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'loto-photos'
    and (
      public.is_superadmin()
      or public.storage_path_tenant(name) in (select public.current_user_tenant_ids())
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Read policy stays open so:
--   1. Legacy Snak King paths (no tenant prefix) keep resolving from
--      stored equip_photo_url / iso_photo_url / placard_url columns.
--   2. The placard PDF embeds work for inspectors who only have the URL.
--      The URL itself is the capability — same posture as the original
--      migration-005 policy.
-- If a tenant later requires strictly-private photo reads, swap this to
-- a tenant-scoped SELECT policy and switch every reader to
-- createSignedUrl() with a short expiry.
-- ────────────────────────────────────────────────────────────────────────────
create policy "loto_photos_grandfathered_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'loto-photos');

commit;
