-- Migration 138: Public review-link mode.
--
-- Replaces the per-reviewer invite model from migrations 035 + 134 with a
-- single "public" link per (tenant, department). Anyone with the URL can
-- type a name and leave per-placard notes + a final sign-off. No email,
-- no per-reviewer identity at link-creation time, no 30-day expiry.
--
-- Schema changes (all additive / nullability-loosening — old per-reviewer
-- rows from 035 + 134 stay valid):
--
--   1. loto_review_links.reviewer_name / reviewer_email become nullable
--      so the public-link create path doesn't need placeholder values.
--   2. loto_review_links.created_by becomes nullable for service-role
--      paths that don't carry a user (future-proofing; today's API still
--      always sets it).
--   3. New column `is_public BOOLEAN NOT NULL DEFAULT false` so the API
--      can distinguish the public row from legacy per-reviewer rows when
--      reading. Stored, not derived, because the predicate is queried on
--      the GET path and a stored boolean is cheaper than IS NULL + IS NULL.
--   4. New partial unique index on (tenant_id, department) WHERE
--      is_public AND revoked_at IS NULL — exactly one active public link
--      per department. Get-or-create relies on this.
--
-- Idempotent. Re-running is a no-op.

begin;

-- 1 + 2. Loosen NOT NULL on per-reviewer columns.
do $$
begin
  alter table public.loto_review_links alter column reviewer_name  drop not null;
exception when others then null;
end $$;

do $$
begin
  alter table public.loto_review_links alter column reviewer_email drop not null;
exception when others then null;
end $$;

do $$
begin
  alter table public.loto_review_links alter column created_by     drop not null;
exception when others then null;
end $$;

-- 3. is_public column.
alter table public.loto_review_links
  add column if not exists is_public boolean not null default false;

-- 4. Exactly-one-active-public-link per (tenant, department).
create unique index if not exists idx_loto_review_links_one_public_per_dept
  on public.loto_review_links(tenant_id, department)
  where is_public and revoked_at is null;

-- 5. Retire every legacy per-reviewer invite link. The new model is one
--    anonymous public link per department; honouring outstanding invites
--    would mean the reviewer's email + name lives on after the design
--    pivot, which the product owner explicitly does not want. Anyone who
--    had a working URL hits the "Link revoked" screen and asks the
--    tenant admin to share the public URL instead.
update public.loto_review_links
   set revoked_at = coalesce(revoked_at, now())
 where is_public is not true
   and revoked_at is null;

-- Reload PostgREST schema so the new column is visible.
notify pgrst, 'reload schema';

commit;
