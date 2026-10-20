-- Migration 299: STRIKE XP ledger and leaderboard opt-in.
--
-- Append-only by design (docs/handoffs/2026-08-29-strike-phase-2.md): XP is
-- the sum of ledger rows, never a counter, and
--   unique (tenant_id, member_id, event_type, dedupe_key)
-- with dedupe keys like `version:<id>` means passing the same version twice
-- earns zero. Point values and the no-speed / no-streak / never-score rules
-- live in packages/core/src/strikeGamification.ts.
--
-- Writes come only from the grading path on the service role (no insert
-- policy). Learners read their own rows; admins read their tenant's.
-- Individual leaderboards need both strike_tenant_settings.leaderboard_enabled
-- and a row in strike_leaderboard_optins — nobody is ranked publicly without
-- choosing to be.
--
-- Idempotent.

begin;

create table if not exists public.strike_xp_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  event_type  text not null check (event_type in ('module_passed', 'on_time', 'practice_solved', 'curriculum_complete')),
  dedupe_key  text not null check (length(dedupe_key) between 1 and 300),
  points      int not null check (points >= 0),
  module_id   uuid references public.strike_modules(id) on delete set null,
  created_at  timestamptz not null default now(),

  unique (tenant_id, member_id, event_type, dedupe_key)
);

create index if not exists strike_xp_events_member_idx on public.strike_xp_events(tenant_id, member_id);

alter table public.strike_xp_events enable row level security;

drop policy if exists strike_xp_events_read on public.strike_xp_events;
create policy strike_xp_events_read on public.strike_xp_events
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      member_id in (select m.id from public.members m where m.profile_id = auth.uid())
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );

create or replace function public.strike_xp_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'strike_xp_events is append-only'
    using errcode = 'integrity_constraint_violation';
end;
$$;

drop trigger if exists strike_xp_events_no_update on public.strike_xp_events;
create trigger strike_xp_events_no_update
  before update on public.strike_xp_events
  for each row execute function public.strike_xp_events_append_only();

create table if not exists public.strike_leaderboard_optins (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  opted_in_at   timestamptz not null default now(),
  primary key (tenant_id, member_id)
);

alter table public.strike_leaderboard_optins enable row level security;

drop policy if exists strike_leaderboard_optins_own on public.strike_leaderboard_optins;
create policy strike_leaderboard_optins_own on public.strike_leaderboard_optins
  for all to authenticated
  using (member_id in (select m.id from public.members m where m.profile_id = auth.uid()))
  with check (member_id in (select m.id from public.members m where m.profile_id = auth.uid()));

notify pgrst, 'reload schema';

commit;
