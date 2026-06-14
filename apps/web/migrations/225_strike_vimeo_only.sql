-- Migration 225: STRIKE video goes Vimeo-only.
--
-- The Supabase-storage + Cloudflare Stream pipeline is retired. A module
-- version now references a Vimeo video by id: video_external_id holds the
-- numeric Vimeo id, and video_meta.vimeo_hash holds the optional unlisted
-- privacy hash. The old provider columns (video_provider, video_ready,
-- video_path, captions_path) are left in place but dormant — dropping them is
-- irreversible and unnecessary, so it's deferred to a later cleanup once we've
-- confirmed nothing depends on them.
--
-- This migration only RELAXES constraints so the Vimeo shape is representable:
--   - The provider-domain check ('storage' | 'cloudflare') and the
--     "cloudflare requires an external id" rule no longer apply.
--   - The media-access audit keeps its historical 'storage'/'cloudflare' rows
--     valid while admitting new 'vimeo' rows.

begin;

alter table public.strike_module_versions
  drop constraint if exists strike_versions_provider_ck;
alter table public.strike_module_versions
  drop constraint if exists strike_module_versions_video_provider_check;
alter table public.strike_module_versions
  alter column video_provider set default 'vimeo';

alter table public.strike_media_access
  drop constraint if exists strike_media_access_provider_check;
alter table public.strike_media_access
  add constraint strike_media_access_provider_check
    check (provider in ('storage', 'cloudflare', 'vimeo'));

notify pgrst, 'reload schema';

commit;
