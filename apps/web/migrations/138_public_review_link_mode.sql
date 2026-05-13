-- Migration 138: Public review-link mode.
--
-- Replaces the per-reviewer invite model from migrations 035 + 134 with a
-- single anonymous "public" link per tenant. Anyone with the URL sees
-- every active placard in the tenant grouped by department and can leave
-- per-placard freeform comments. No email, no reviewer identity, no
-- sign-off, no expiry.
--
-- Schema changes (all additive / nullability-loosening — old per-reviewer
-- rows from 035 + 134 stay valid):
--
--   1. loto_review_links.reviewer_name / reviewer_email / created_by /
--      department all become nullable. The public path doesn't set any
--      of them (department is null because the link is tenant-wide).
--   2. New column `is_public BOOLEAN NOT NULL DEFAULT false` so the API
--      can distinguish the public row from legacy per-reviewer rows when
--      reading. Stored, not derived, because the predicate is queried on
--      the GET path and a stored boolean is cheaper than IS NULL + IS NULL.
--   3. New partial unique index on (tenant_id) WHERE is_public AND
--      revoked_at IS NULL — exactly one active public link per tenant.
--      Get-or-create relies on this.
--   4. Every active legacy per-reviewer row is revoked. The new model is
--      the only one in use after this migration; honouring outstanding
--      invites would mean stale per-reviewer identity persists past the
--      design pivot.
--
-- Idempotent. Re-running is a no-op.

begin;

-- 1. Loosen NOT NULL on the columns the public path no longer sets.
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

do $$
begin
  alter table public.loto_review_links alter column department     drop not null;
exception when others then null;
end $$;

-- 2. is_public column.
alter table public.loto_review_links
  add column if not exists is_public boolean not null default false;

-- 3. Exactly-one-active-public-link per tenant. The previous (tenant,
--    department) variant of this index is dropped if it exists from an
--    earlier iteration of this migration.
drop index if exists public.idx_loto_review_links_one_public_per_dept;
create unique index if not exists idx_loto_review_links_one_public_per_tenant
  on public.loto_review_links(tenant_id)
  where is_public and revoked_at is null;

-- 4. Retire every legacy per-reviewer invite link. The new model is one
--    anonymous public link per tenant; honouring outstanding invites
--    would mean the reviewer's email + name lives on after the design
--    pivot. Anyone holding an old URL hits the "Link revoked" screen.
update public.loto_review_links
   set revoked_at = coalesce(revoked_at, now())
 where is_public is not true
   and revoked_at is null;

-- Reload PostgREST schema so the new column is visible.
notify pgrst, 'reload schema';

commit;
