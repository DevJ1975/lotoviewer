-- Migration 189: LOTO supervisor review flow.
--
-- Three concerns, one migration:
--
-- 1. Public review-link mode. The per-reviewer email model (mig 035)
--    requires the admin to know who's reviewing. Supervisors on the
--    shop floor with a 10-minute QR scan don't have that pre-known
--    identity. This adds an `is_public` flag + a partial unique index
--    so a tenant can have at most one active public link. The
--    public path doesn't set reviewer_name / reviewer_email, so those
--    are loosened to nullable. Existing per-reviewer rows are
--    untouched — both models coexist.
--
-- 2. 72-hour default expiry + admin extension audit. The per-reviewer
--    default was 30 days (mig 035) — fine for an external auditor,
--    excessive for a floor walk. New rows default to 72h. Admins can
--    push expiry forward via the new extend endpoint; the count + who
--    + when are captured for audit.
--
-- 3. "Mark for review" queue on the equipment row. A supervisor on the
--    public link can flag equipment they want a deeper admin look at;
--    the admin works the queue and clears the flag. A single nullable
--    timestamp + lightweight context columns is sufficient — when a
--    deeper history is needed, the audit log already captures every
--    write to loto_equipment.
--
-- Also adds reviewer_name to the photo-replacement audit row so the
-- audit trail isn't just IP + UA.
--
-- Idempotent. Re-running is a no-op.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Public review-link mode
-- ─────────────────────────────────────────────────────────────────────────

-- Loosen NOT NULL on reviewer identity columns. The public path doesn't
-- set them. Existing per-reviewer rows still carry valid values, so
-- this is purely additive.
do $$ begin
  alter table public.loto_review_links alter column reviewer_name  drop not null;
exception when others then null; end $$;
do $$ begin
  alter table public.loto_review_links alter column reviewer_email drop not null;
exception when others then null; end $$;
do $$ begin
  alter table public.loto_review_links alter column created_by     drop not null;
exception when others then null; end $$;
do $$ begin
  alter table public.loto_review_links alter column department     drop not null;
exception when others then null; end $$;

-- is_public flag distinguishes the public row from legacy per-reviewer
-- rows when reading. Stored, not derived, because the predicate is
-- queried on the GET path and a stored boolean is cheaper than IS NULL
-- + IS NULL.
alter table public.loto_review_links
  add column if not exists is_public boolean not null default false;

-- Exactly one active public link per tenant. Get-or-create relies on
-- this; an admin minting a second link while the first is still active
-- is a no-op that returns the existing row.
create unique index if not exists idx_loto_review_links_one_public_per_tenant
  on public.loto_review_links(tenant_id)
  where is_public and revoked_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. 72-hour default expiry + extension audit
-- ─────────────────────────────────────────────────────────────────────────

alter table public.loto_review_links
  alter column expires_at set default (now() + interval '72 hours');

alter table public.loto_review_links
  add column if not exists extension_count  smallint    not null default 0,
  add column if not exists last_extended_at timestamptz,
  add column if not exists last_extended_by uuid        references auth.users(id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. "Mark for review" queue on loto_equipment
-- ─────────────────────────────────────────────────────────────────────────

alter table public.loto_equipment
  add column if not exists flagged_for_review_at   timestamptz,
  add column if not exists flagged_for_review_by   text,
  add column if not exists flagged_for_review_via  text,
  add column if not exists flagged_for_review_note text;

-- Constrain `via` to known channels at the DB layer so a typo on the
-- app side surfaces as a write error, not as a noisy audit trail.
do $$ begin
  alter table public.loto_equipment
    add constraint loto_equipment_flagged_via_chk
    check (flagged_for_review_via is null
        or flagged_for_review_via in ('public-link', 'admin'));
exception when duplicate_object then null; end $$;

create index if not exists idx_loto_equipment_flagged
  on public.loto_equipment(tenant_id, flagged_for_review_at desc)
  where flagged_for_review_at is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Reviewer name on the photo-replacement audit row
-- ─────────────────────────────────────────────────────────────────────────

alter table public.loto_review_photo_replacements
  add column if not exists replaced_by_name text;

-- Reload PostgREST so the new columns are visible to the app.
notify pgrst, 'reload schema';

commit;
