-- Migration 003: profiles, audit log, and CRUD triggers
-- Run against your Supabase project in the SQL editor after 001 & 002.

-- ────────────────────────────────────────────────────────────────────────────
-- profiles — one row per auth.users row, carries app-specific fields
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text not null unique,
  full_name              text,
  is_admin               boolean not null default false,
  must_change_password   boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

alter table public.profiles enable row level security;

-- Users can read their own profile; admins can read everyone.
drop policy if exists "profiles_self_or_admin_read" on public.profiles;
create policy "profiles_self_or_admin_read" on public.profiles
  for select using (
    auth.uid() = id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Users can update their own profile (name + must_change_password flag).
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- Admins can update/delete any profile.
drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write" on public.profiles
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ────────────────────────────────────────────────────────────────────────────
-- audit_log — immutable CRUD trail
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id            bigserial primary key,
  actor_id      uuid,
  actor_email   text,
  table_name    text not null,
  operation     text not null check (operation in ('INSERT','UPDATE','DELETE')),
  row_pk        text,
  old_row       jsonb,
  new_row       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_log_table_time_idx   on public.audit_log (table_name, created_at desc);
create index if not exists audit_log_actor_time_idx   on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_row_idx          on public.audit_log (table_name, row_pk);

alter table public.audit_log enable row level security;

-- Only admins can read the audit log. Inserts happen via triggers (security
-- definer), so no insert policy is needed for normal users.
drop policy if exists "audit_log_admin_read" on public.audit_log;
create policy "audit_log_admin_read" on public.audit_log
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ────────────────────────────────────────────────────────────────────────────
-- log_audit() — trigger function shared by all audited tables
-- Runs as SECURITY DEFINER so it can write to audit_log regardless of the
-- caller's RLS permissions. Resolves actor from auth.uid().
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.log_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor_id    uuid := auth.uid();
  v_actor_email text;
  v_pk          text;
  v_pk_col      text := tg_argv[0];  -- PK column name, passed per-table
begin
  if v_actor_id is not null then
    select email into v_actor_email from public.profiles where id = v_actor_id;
  end if;

  if tg_op = 'DELETE' then
    v_pk := (to_jsonb(old) ->> v_pk_col);
  else
    v_pk := (to_jsonb(new) ->> v_pk_col);
  end if;

  insert into public.audit_log (actor_id, actor_email, table_name, operation, row_pk, old_row, new_row)
  values (
    v_actor_id,
    v_actor_email,
    tg_table_name,
    tg_op,
    v_pk,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Attach triggers to every audited table. Drop first so the migration is
-- idempotent.
drop trigger if exists trg_audit_loto_equipment on public.loto_equipment;
create trigger trg_audit_loto_equipment
  after insert or update or delete on public.loto_equipment
  for each row execute function public.log_audit('equipment_id');

drop trigger if exists trg_audit_loto_reviews on public.loto_reviews;
create trigger trg_audit_loto_reviews
  after insert or update or delete on public.loto_reviews
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_loto_energy_steps on public.loto_energy_steps;
create trigger trg_audit_loto_energy_steps
  after insert or update or delete on public.loto_energy_steps
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_profiles on public.profiles;
create trigger trg_audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.log_audit('id');

-- ────────────────────────────────────────────────────────────────────────────
-- handle_new_user() — auto-creates a profiles row when an auth.users row is
-- inserted (either by the admin invite flow or the Supabase dashboard).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, email, must_change_password)
  values (new.id, new.email, true)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────────────────────────
-- Lock down existing LOTO tables: require an authenticated session.
-- Previously these tables relied on the anon key; now every call must carry
-- a JWT with auth.uid() set.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_equipment     enable row level security;
alter table public.loto_energy_steps  enable row level security;

drop policy if exists "loto_equipment_authenticated_all" on public.loto_equipment;
create policy "loto_equipment_authenticated_all" on public.loto_equipment
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "loto_energy_steps_authenticated_all" on public.loto_energy_steps;
create policy "loto_energy_steps_authenticated_all" on public.loto_energy_steps
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
