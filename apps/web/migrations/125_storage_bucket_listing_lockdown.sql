-- Migration 056: lock down LIST on the two public storage buckets.
--
-- Closes the WARN-level Supabase advisor lints:
--   public_bucket_allows_listing on `loto-photos`
--   public_bucket_allows_listing on `tenant-logos`
--
-- Both buckets stay `public = true`, so existing object URLs returned
-- by storage.getPublicUrl() (i.e. /storage/v1/object/public/<bucket>/...)
-- continue to work without RLS evaluation. The dropped policies only
-- enabled the LIST API (/storage/v1/object/list/<bucket>) and the
-- non-public object endpoint, neither of which the app calls — verified
-- with a grep across apps/web and packages/core (only .upload() and
-- .getPublicUrl() are used, plus admin .remove() under service-role
-- which bypasses RLS).
--
-- After this migration:
--   * Public photo / placard / logo URLs continue to render.
--   * Admin uploads via service-role keep working (RLS-bypassing).
--   * Anonymous + authenticated clients can no longer enumerate the
--     full bucket via the list endpoint, which is the lint's concern.

begin;

-- loto-photos: drop both broad SELECT policies.
drop policy if exists "Allow anon reads"              on storage.objects;
drop policy if exists  loto_photos_grandfathered_read on storage.objects;

-- tenant-logos: drop the single broad SELECT policy.
drop policy if exists  tenant_logos_public_read       on storage.objects;

commit;
