-- Migration 005: RLS policies for the loto-photos storage bucket
-- Symptom we're fixing:
--   [upload-queue] sync failed
--   {error: "new row violates row-level security policy"}
-- Migration 003 locked down the table RLS but didn't touch storage.objects,
-- so authenticated INSERTs to the bucket got rejected.
--
-- Supabase Storage stores every file as a row in storage.objects, keyed by
-- bucket_id. Policies live on that table. We scope each policy to
-- bucket_id = 'loto-photos' so other buckets aren't affected.
--
-- Idempotent — safe to re-run.

-- Authenticated users can upload (queue drain, direct photo capture).
drop policy if exists "loto_photos_authenticated_insert" on storage.objects;
create policy "loto_photos_authenticated_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'loto-photos');

-- Authenticated users can overwrite (placard re-uploads, signed PDFs).
drop policy if exists "loto_photos_authenticated_update" on storage.objects;
create policy "loto_photos_authenticated_update" on storage.objects
  for update to authenticated
  using      (bucket_id = 'loto-photos')
  with check (bucket_id = 'loto-photos');

-- Authenticated users can delete (future cleanup flows).
drop policy if exists "loto_photos_authenticated_delete" on storage.objects;
create policy "loto_photos_authenticated_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'loto-photos');

-- Public reads so the <img src=publicUrl> tags resolve for anyone who has
-- the URL. If you'd rather require auth to view photos, drop this policy
-- and change getPublicUrl → createSignedUrl on the client.
drop policy if exists "loto_photos_public_read" on storage.objects;
create policy "loto_photos_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'loto-photos');

notify pgrst, 'reload schema';
