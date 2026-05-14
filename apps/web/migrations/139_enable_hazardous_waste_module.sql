-- Migration 139: enable the Hazardous Waste module on every existing tenant.
--
-- The hazardous-waste feature shipped in migration 138 (manual publish) and
-- the FEATURES catalog (packages/core/src/features.ts). The static catalog
-- defaults to `enabled: true`, so the moduleVisibility resolver already
-- treats it as visible for any tenant whose `modules` jsonb lacks the key.
--
-- This migration writes the key explicitly so:
--   1. The superadmin module-toggle UI shows the row with the right value
--      instead of relying on the static fallback.
--   2. Tenants that have an explicit `modules` jsonb (Snak King = 0001,
--      WLS Demo = 0002, etc.) carry the module in their record without
--      needing a one-off SQL touch later.
--
-- Mirrors the equipment-readiness enable step in migration 118.
-- Idempotent: re-running is a no-op for rows that already carry the key.

begin;

update public.tenants
   set modules    = coalesce(modules, '{}'::jsonb) || jsonb_build_object('hazardous-waste', true),
       updated_at = now()
 where modules is null
    or not (modules ? 'hazardous-waste');

notify pgrst, 'reload schema';

commit;
