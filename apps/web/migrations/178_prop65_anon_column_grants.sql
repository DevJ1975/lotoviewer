-- Migration 178: Restrict anon column access on the public Prop 65 surface.
--
-- /devjr audit finding (Module 4, Phase C).
--
-- Migrations 172 + 174 added anonymous-read RLS policies on
-- prop65_sites and prop65_warnings so the public route at
-- /prop65/[slug] can render a sign-redirect page without a login.
-- The policies grant ROW-level anon access (`using (true)` and
-- `using (removed_at is null)`), but the Supabase anon-key client
-- the route uses can request ANY column on those tables via
-- PostgREST — including tenant_id, full address, employee_count,
-- posted_by_user_id, and the chemical-id array. The page's TSX
-- only renders 4 columns; the leak is on the wire, not on the
-- screen.
--
-- This migration narrows the leak via column-level GRANTs to the
-- anon role. PostgREST honors column grants when serializing rows
-- and refuses requests for columns the caller can't see, so
--
--   GET /rest/v1/prop65_sites?select=tenant_id
--
-- from an anon caller now returns 401, while
--
--   GET /rest/v1/prop65_sites?select=id,name,city,state,public_slug
--
-- continues to work. The route already selects only safe columns,
-- so its behavior is unchanged.
--
-- We do NOT touch the `authenticated` role's grants — admins still
-- need full column access via the existing tenant-scope policy.
-- The default-deny RLS on the base tables already gates them.
--
-- Idempotent. Re-runs revoke + re-grant to the same final state.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. prop65_sites — anon may only read the slug-discovery columns
-- ────────────────────────────────────────────────────────────────────
-- Strip every base grant first so a future column addition doesn't
-- silently expose itself to anon.
revoke select on public.prop65_sites from anon;

grant select (id, name, city, state, public_slug)
  on public.prop65_sites to anon;

comment on policy "prop65_sites_public_slug_read" on public.prop65_sites is
  'Allows anon row-level access. Column-level grants in migration 178 restrict the actual readable columns to id, name, city, state, public_slug — every other column (tenant_id, address, employee_count) is unreachable from a /rest/v1 anon query.';

-- ────────────────────────────────────────────────────────────────────
-- 2. prop65_warnings — anon may only read the sign-content columns
-- ────────────────────────────────────────────────────────────────────
revoke select on public.prop65_warnings from anon;

grant select (id, site_id, warning_text, posted_at, harm_endpoint, warning_type, photo_url)
  on public.prop65_warnings to anon;

comment on policy "prop65_warnings_public_read" on public.prop65_warnings is
  'Allows anon row-level access to non-removed warnings. Column-level grants in migration 178 restrict the readable columns to id, site_id, warning_text, posted_at, harm_endpoint, warning_type, photo_url — tenant_id, posted_by_user_id, prop65_chemical_ids, removed_at are unreachable from a /rest/v1 anon query.';

notify pgrst, 'reload schema';

commit;
