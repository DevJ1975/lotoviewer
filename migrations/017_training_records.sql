-- Migration 017: Training-records register for §1910.146(g) compliance.
--
-- Why: §1910.146(g) requires authorized-entrant / attendant / entry-
-- supervisor / rescuer training before a worker can be put on a permit.
-- The audit and the competitor scan flagged this as the last named
-- OSHA gap in our compliance moat. Brady tracks it; VelocityEHS makes
-- a meal of it; we needed a minimum-viable equivalent.
--
-- Design:
--   • Name-based, not profile-FK based. Field workers rarely have app
--     accounts — entrants / attendants are rosters of names matching
--     loto_confined_space_permits.entrants[] / .attendants[]. Mirrors
--     the same trade-off we made for the rosters themselves.
--   • Role enum constrained to the four §(g) roles plus a flexible
--     "other" slot for site-specific certifications.
--   • expires_at is nullable: some training is one-time (e.g. site
--     orientation), most has a recurrence (annual confined-space
--     refresher). Null means no expiry; the gate treats null as
--     "valid forever" until the operator says otherwise.
--   • Read open to authenticated; writes admin-only because a worker
--     could otherwise self-certify.
--
-- Idempotent.

create table if not exists public.loto_training_records (
  id              uuid primary key default gen_random_uuid(),
  -- Match against names in permits.entrants[] / .attendants[]. Stored
  -- with original case; the permit-sign gate compares case-insensitively
  -- (lib/trainingRecords.ts handles the normalization).
  worker_name     text not null,
  role            text not null
                    check (role in ('entrant', 'attendant', 'entry_supervisor', 'rescuer', 'other')),
  -- The day the training certificate was issued. Date (not timestamptz)
  -- because the cert is a calendar-day artifact — a 9 AM vs 5 PM issue
  -- time would never matter for compliance.
  completed_at    date not null,
  -- Null = no expiry. Most recurring training has a 12-month cadence;
  -- the gate treats expires_at < today() as expired.
  expires_at      date,
  cert_authority  text,
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Sanity: a cert can't expire before it was issued. Catches data-
  -- entry mistakes (typed wrong year on the date picker).
  constraint training_dates_consistent
    check (expires_at is null or expires_at >= completed_at)
);

-- Validation lookup is "give me every record for a worker name + role."
-- Lowercase the name in a partial expression index so the gate's
-- case-insensitive match doesn't full-table-scan.
create index if not exists idx_training_lookup
  on public.loto_training_records(lower(worker_name), role);

-- Listing UI sorts by worker_name + role for grouping. A simple two-
-- column index covers it.
create index if not exists idx_training_listing
  on public.loto_training_records(worker_name, role);

comment on table public.loto_training_records is
  'Per-worker training certifications for §1910.146(g) compliance. One row per (worker, role, completion). The permit-sign gate checks that every named entrant / attendant has a current record before authorizing entry.';

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — authenticated read (sign-gate validation), admin-only write
--       (a worker can't self-certify).
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_training_records enable row level security;

drop policy if exists "loto_training_records_authenticated_read" on public.loto_training_records;
create policy "loto_training_records_authenticated_read" on public.loto_training_records
  for select using (auth.uid() is not null);

drop policy if exists "loto_training_records_admin_write" on public.loto_training_records;
create policy "loto_training_records_admin_write" on public.loto_training_records
  for all
  using ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) )
  with check ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) );

-- Audit trigger — every cert add/edit/delete lands in audit_log.
drop trigger if exists trg_audit_loto_training_records on public.loto_training_records;
create trigger trg_audit_loto_training_records
  after insert or update or delete on public.loto_training_records
  for each row execute function public.log_audit('id');
