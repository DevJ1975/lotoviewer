-- Migration 019: Hot Work Permit module — OSHA 29 CFR 1910.252 + NFPA 51B
--                + Cal/OSHA Title 8 §6777 / §§4848-4853.
--
-- Hot Work is welding / cutting / grinding / brazing / soldering / torch-
-- applied roofing in non-designated areas — every plant doing maintenance
-- needs this. Mirrors the Confined Space module structurally (single
-- permit table, lifecycle states, multi-party signature, audit-logged)
-- but the regulatory shape is different:
--   • No atmospheric tests (unless inside a CS — then the CS permit
--     owns the readings; this permit references it via FK).
--   • Fire watch is the central concept — a separate roster from
--     operators, required to stay during work AND for ≥ 60 min after
--     per NFPA 51B (Cal/OSHA §6777 references this standard).
--   • Pre-work checklist (combustibles cleared 35 ft, sprinklers
--     operational, fire extinguisher present, etc.) is structured
--     jsonb so v2 can extend without a migration.
--   • Post-work fire watch is its own lifecycle phase — work_completed_at
--     starts the 60-minute timer; the permit can't close until that
--     timer elapses.
--
-- Same conventions as migrations 009-018: idempotent, RLS authenticated_all
-- (admin-write), audit triggers reuse public.log_audit('id') from
-- migration 003, serial generator follows the CSP- pattern from migration 011.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. loto_hot_work_permits — the permit row
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.loto_hot_work_permits (
  id                            uuid primary key default gen_random_uuid(),
  -- Human-readable serial HWP-YYYYMMDD-NNNN populated by the BEFORE INSERT
  -- trigger below. Used on the printed permit, the QR code, the status
  -- board, and the cross-reference text on linked Confined Space permits.
  serial                        text,
  -- §1910.252(a)(2)(iv) — identify the location of the work. Free text
  -- because hot work happens anywhere (a wall, a tank exterior, a
  -- structural beam) — not tied to a fixed inventory like CS spaces.
  work_location                 text not null,
  -- §1910.252(a)(2)(vii) — what the work consists of. Free-text scope
  -- statement that prints on the permit.
  work_description              text not null,
  -- Multi-select — most jobs are a single type but some span (e.g. a
  -- repair that involves both grinding AND welding).
  work_types                    text[] not null default '{}',
  -- ── Cross-references (both nullable) ────────────────────────────────
  -- When hot work is performed inside a confined space, the CS permit
  -- (per §1910.146(f)(15) / §(k)) must list the hot work as a concurrent
  -- permit. We FK so the linkage is guaranteed; ON DELETE SET NULL
  -- because canceling a CS permit shouldn't auto-cascade-delete hot work
  -- audit history.
  associated_cs_permit_id       uuid
                                  references public.loto_confined_space_permits(id)
                                  on delete set null,
  -- When the work is on a specific machine, surface the LOTO procedure
  -- on the permit detail page. Optional — exterior structural welding
  -- has no equipment_id.
  equipment_id                  text
                                  references public.loto_equipment(equipment_id)
                                  on update cascade
                                  on delete set null,
  -- Free-text WO ref matching the loto_org_config.work_order_url_template
  -- shape from migration 014.
  work_order_ref                text,
  -- ── Time bounding (mirrors migration 011's CS 8h cap) ───────────────
  started_at                    timestamptz not null default now(),
  expires_at                    timestamptz not null,
  -- ── Authorization (NFPA 51B "Permit Authorizing Individual") ────────
  pai_id                        uuid not null
                                  references public.profiles(id)
                                  on delete restrict,
  pai_signature_at              timestamptz,
  -- ── Personnel rosters (text[] mirroring migration 010's CS pattern) ─
  -- Cal/OSHA §6777: fire watcher must NOT also be performing hot work.
  -- The application validates the no-overlap rule; the schema doesn't
  -- enforce it because we want soft warnings on edits rather than a
  -- hard FK violation breaking the form.
  hot_work_operators            text[] not null default '{}',
  fire_watch_personnel          text[] not null default '{}',
  fire_watch_signature_at       timestamptz,
  fire_watch_signature_name     text,                                    -- which watcher signed on
  -- ── Pre-work checklist (jsonb) ──────────────────────────────────────
  -- Schema validated in lib/hotWorkChecklist.ts. Storing as jsonb so
  -- adding a check item (e.g. "alarm system tested") in v2 doesn't
  -- need a migration — the renderer iterates known keys and falls back
  -- gracefully on unknown ones.
  pre_work_checks               jsonb not null default '{}'::jsonb,
  -- ── Post-work fire watch (NFPA 51B §8.7) ────────────────────────────
  -- work_completed_at = supervisor flipped "work done" toggle. This
  -- starts the post-watch timer. Permit cannot close until
  -- now() >= work_completed_at + post_watch_minutes.
  work_completed_at             timestamptz,
  -- 60 min is the NFPA 51B floor; high-risk sites bump to 120. Per-
  -- permit override so an FM Global-insured client can configure it.
  post_watch_minutes            int not null default 60
                                  check (post_watch_minutes > 0 and post_watch_minutes <= 240),
  -- ── Cancel / close-out ──────────────────────────────────────────────
  canceled_at                   timestamptz,
  -- 'task_complete'      — normal close-out after post-watch elapsed
  -- 'fire_observed'      — emergency cancel; pushes alert to all subs
  -- 'unsafe_condition'   — pre-condition no longer met (e.g. sprinkler
  --                        went down mid-work)
  -- 'expired'            — permit ran past expires_at without close-out
  -- 'other'              — supervisor describes in cancel_notes
  cancel_reason                 text
                                  check (cancel_reason is null or cancel_reason in (
                                    'task_complete','fire_observed','unsafe_condition','expired','other'
                                  )),
  cancel_notes                  text,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  -- ── Constraints ─────────────────────────────────────────────────────
  -- Mirror the CS 8h cap from migration 011.
  constraint hot_work_duration_cap_8h
    check (expires_at - started_at <= interval '8 hours' and expires_at > started_at),
  -- canceled_at and cancel_reason go together (mirrors migration 009's
  -- cancel_state_consistent on the CS permit table).
  constraint hot_work_cancel_state_consistent
    check ((canceled_at is null) = (cancel_reason is null))
);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Indices — same shapes as the CS permit indices from migration 009
-- ────────────────────────────────────────────────────────────────────────────
create index if not exists idx_hot_work_open
  on public.loto_hot_work_permits(started_at desc)
  where canceled_at is null;

create index if not exists idx_hot_work_canceled_at
  on public.loto_hot_work_permits(canceled_at desc)
  where canceled_at is not null;

-- For surfacing "linked hot work permits" on a CS permit detail page —
-- partial index on the FK to keep it small.
create index if not exists idx_hot_work_associated_cs
  on public.loto_hot_work_permits(associated_cs_permit_id)
  where associated_cs_permit_id is not null;

-- For "what hot work is happening on this machine" lookups from the
-- LOTO equipment detail page (Phase 3 surface — index now so the
-- query is ready).
create index if not exists idx_hot_work_equipment_id
  on public.loto_hot_work_permits(equipment_id)
  where equipment_id is not null;

comment on table public.loto_hot_work_permits is
  'Hot Work permits per OSHA 29 CFR 1910.252 + NFPA 51B + Cal/OSHA Title 8 §6777. Canceled permits are retained for OSHA audit trail — never hard-delete.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Serial generator — HWP-YYYYMMDD-NNNN, mirroring migration 011 for CSP
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.next_hot_work_serial(p_started_at timestamptz)
  returns text
  language plpgsql
  stable
as $$
declare
  date_part text := to_char(p_started_at, 'YYYYMMDD');
  seq int;
begin
  -- Per-day sequence. The unique index below catches the rare race
  -- between two concurrent inserts on the same day; the trigger has
  -- no retry loop because the app-level error surface is already
  -- "could not create permit, try again" which a supervisor can act on.
  select coalesce(max(substring(serial from 14)::int), 0) + 1
    into seq
    from public.loto_hot_work_permits
   where serial like 'HWP-' || date_part || '-%';

  return 'HWP-' || date_part || '-' || lpad(seq::text, 4, '0');
end $$;

create or replace function public.set_hot_work_serial()
  returns trigger
  language plpgsql
as $$
begin
  if new.serial is null then
    new.serial := public.next_hot_work_serial(new.started_at);
  end if;
  return new;
end $$;

drop trigger if exists trg_set_hot_work_serial on public.loto_hot_work_permits;
create trigger trg_set_hot_work_serial
  before insert on public.loto_hot_work_permits
  for each row execute function public.set_hot_work_serial();

-- Unique index on serial — defends against the rare race; matches the
-- CSP serial uniqueness from migration 011.
create unique index if not exists idx_hot_work_serial_unique
  on public.loto_hot_work_permits(serial);

-- After the trigger has populated serial on every existing row (none
-- on a fresh deploy), make the column NOT NULL so future direct INSERTs
-- can't smuggle in a null. Wrapped in a DO block because the table
-- might already have NOT NULL set on a re-run.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'loto_hot_work_permits'
       and column_name  = 'serial'
       and is_nullable  = 'YES'
  ) then
    alter table public.loto_hot_work_permits
      alter column serial set not null;
  end if;
end $$;

comment on column public.loto_hot_work_permits.serial is
  'Human-readable serial HWP-YYYYMMDD-NNNN. Populated automatically by the BEFORE INSERT trigger. Date component reflects started_at. Mirrors the CSP- format from migration 011 so OSHA inspectors see one consistent serial scheme across all permits.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS — authenticated_all (matches the CS permit pattern from migration 009)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_hot_work_permits enable row level security;

drop policy if exists "loto_hot_work_permits_authenticated_all" on public.loto_hot_work_permits;
create policy "loto_hot_work_permits_authenticated_all" on public.loto_hot_work_permits
  for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Audit trigger — reuse public.log_audit(pk_col) from migration 003
-- ────────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_loto_hot_work_permits on public.loto_hot_work_permits;
create trigger trg_audit_loto_hot_work_permits
  after insert or update or delete on public.loto_hot_work_permits
  for each row execute function public.log_audit('id');
