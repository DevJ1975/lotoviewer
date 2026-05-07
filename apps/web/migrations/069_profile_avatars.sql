-- Migration 069: profile avatars (Phase 1 of the internal collaboration suite)
--
-- Adds avatar_url to profiles and creates a public-read storage bucket so the
-- AppChrome / UserMenu / chat / comments / boards can render an <img> for
-- every user without signed URLs. Writes are restricted to the user's own
-- path so a member of tenant A can't overwrite the avatar of someone in
-- tenant B.
--
-- Path convention: profile-pictures/{user_id}.{ext}
--
-- Idempotent — re-running this migration won't duplicate the bucket or
-- fail on already-existing policies.

-- ────────────────────────────────────────────────────────────────────────────
-- profiles.avatar_url
-- ────────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists avatar_url text
    check (avatar_url is null or avatar_url ~ '^https?://');

-- ────────────────────────────────────────────────────────────────────────────
-- profile-pictures storage bucket
-- ────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('profile-pictures', 'profile-pictures', true)
on conflict (id) do nothing;

drop policy if exists "profile_pictures_public_read"  on storage.objects;
drop policy if exists "profile_pictures_owner_write"  on storage.objects;

create policy "profile_pictures_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'profile-pictures');

-- Owner-only write. The path MUST start with the caller's auth.uid()
-- followed by a dot and the file extension (e.g. `<uid>.jpg`). Any
-- other path is rejected by RLS even if the route layer has a bug.
create policy "profile_pictures_owner_write" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'profile-pictures'
    and name like auth.uid()::text || '.%'
  )
  with check (
    bucket_id = 'profile-pictures'
    and name like auth.uid()::text || '.%'
  );

-- Reload PostgREST schema cache so avatar_url shows up immediately.
notify pgrst, 'reload schema';
