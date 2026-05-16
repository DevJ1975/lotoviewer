-- Migration 143: §147(f)(3) Group LOTO + §147(f)(4) shift-change handoff.
--
-- §147(f)(3) requires that when servicing/maintenance is performed by
-- a crew, the group's LOTO procedure provides a level of protection
-- equivalent to a personal lockout — typically a group lock box, with
-- each authorized employee attaching a personal lock that they alone
-- can remove. The primary authorized employee carries overall
-- accountability for the group.
--
-- §147(f)(4) requires a specific procedure for shift / personnel
-- changes — the off-going primary transfers authority to the on-going
-- primary so the energy-control lockout is never inadvertently
-- removed during the handoff.
--
-- Three new tables:
--
--   loto_group_permits          one per group lockout event
--   loto_group_permit_members   N:M, one row per worker on the group lock
--   loto_group_permit_handoffs  §(f)(4) shift handoff audit log
--
-- Invariants (enforced at the app level + via the close RPC):
--   - cannot close a permit with members still attached
--   - the primary authorized employee must be assigned before members
--     can join
--   - a member can leave (left_at not null) without closing the permit
--   - a handoff transitions the primary; the previous primary becomes
--     a normal member (or detaches, recorded by the workflow)

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. loto_group_permits
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.loto_group_permits (
  id                              uuid        primary key default gen_random_uuid(),
  tenant_id                       uuid        not null references public.tenants(id) on delete cascade,
  -- §(f)(3)(ii)(A) — the primary authorized employee for the group.
  -- profiles FK because they sign + accept handoffs in-app; a non-app
  -- shop-floor worker can still be ON the lock as a member.
  primary_authorized_employee_id  uuid        references public.profiles(id) on delete restrict,
  work_description                text        not null check (length(btrim(work_description)) > 0),
  -- Equipment scope. Free-text array because group locks frequently
  -- apply to BAYS / CIRCUITS that aren't in loto_equipment; the UI
  -- can validate membership when an entry happens to match.
  equipment_ids                   text[]      not null default '{}'::text[],
  started_at                      timestamptz not null default now(),
  ended_at                        timestamptz,
  status                          text        not null default 'open'
                                    check (status in ('open', 'shift_handed_off', 'closed')),
  -- Optional free-text notes for the close-out narrative.
  close_notes                     text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint chk_loto_group_close_consistent check (
    (status = 'closed' and ended_at is not null)
    or (status <> 'closed' and ended_at is null)
  )
);

create index if not exists idx_loto_group_permits_tenant_open
  on public.loto_group_permits(tenant_id, started_at desc)
  where status <> 'closed';

comment on table public.loto_group_permits is
  'Group LOTO permits per 29 CFR 1910.147(f)(3). One row per group lockout event; members attach personal locks via loto_group_permit_members.';

-- ────────────────────────────────────────────────────────────────────
-- 2. loto_group_permit_members
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.loto_group_permit_members (
  id                  uuid        primary key default gen_random_uuid(),
  group_permit_id     uuid        not null references public.loto_group_permits(id) on delete cascade,
  -- worker_id covers both shop-floor workers (loto_workers) and
  -- profile-backed users. We mirror the same pattern as
  -- loto_device_checkouts: exactly one of worker_id (loto_workers) OR
  -- user_id (profiles) is set per row.
  worker_id           uuid        references public.loto_workers(id) on delete restrict,
  user_id             uuid        references public.profiles(id) on delete restrict,
  -- Personal lock the worker attached to the group box.
  personal_lock_serial text       not null check (length(btrim(personal_lock_serial)) > 0),
  joined_at           timestamptz not null default now(),
  left_at             timestamptz,
  notes               text,
  constraint chk_loto_group_member_xor check (
    (worker_id is not null and user_id is null)
    or (worker_id is null and user_id is not null)
  )
);

create index if not exists idx_loto_group_permit_members_permit_active
  on public.loto_group_permit_members(group_permit_id)
  where left_at is null;

create index if not exists idx_loto_group_permit_members_lock
  on public.loto_group_permit_members(personal_lock_serial);

comment on table public.loto_group_permit_members is
  'Members of a group LOTO. Each row records a personal lock attached to the group box. left_at is set when the worker removes their lock without closing the whole permit.';

-- ────────────────────────────────────────────────────────────────────
-- 3. loto_group_permit_handoffs
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.loto_group_permit_handoffs (
  id              uuid        primary key default gen_random_uuid(),
  group_permit_id uuid        not null references public.loto_group_permits(id) on delete cascade,
  from_user_id    uuid        not null references public.profiles(id) on delete restrict,
  to_user_id      uuid        not null references public.profiles(id) on delete restrict,
  occurred_at     timestamptz not null default now(),
  notes           text,
  constraint chk_loto_group_handoff_distinct check (from_user_id <> to_user_id)
);

create index if not exists idx_loto_group_permit_handoffs_permit
  on public.loto_group_permit_handoffs(group_permit_id, occurred_at desc);

comment on table public.loto_group_permit_handoffs is
  'Shift / personnel-change handoffs per 29 CFR 1910.147(f)(4). Each row captures a primary-authorized-employee transition for a single group permit.';

-- ────────────────────────────────────────────────────────────────────
-- 4. RLS — tenant-scoped via the parent permit
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_group_permits          enable row level security;
alter table public.loto_group_permit_members   enable row level security;
alter table public.loto_group_permit_handoffs  enable row level security;

drop policy if exists "loto_group_permits_tenant_scope"
  on public.loto_group_permits;
create policy "loto_group_permits_tenant_scope"
  on public.loto_group_permits
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop policy if exists "loto_group_permit_members_tenant_scope"
  on public.loto_group_permit_members;
create policy "loto_group_permit_members_tenant_scope"
  on public.loto_group_permit_members
  for all to authenticated
  using (
    group_permit_id in (
      select id from public.loto_group_permits
      where tenant_id in (select public.current_user_tenant_ids())
        or public.is_superadmin()
    )
  )
  with check (
    group_permit_id in (
      select id from public.loto_group_permits
      where tenant_id in (select public.current_user_tenant_ids())
        or public.is_superadmin()
    )
  );

drop policy if exists "loto_group_permit_handoffs_tenant_scope"
  on public.loto_group_permit_handoffs;
create policy "loto_group_permit_handoffs_tenant_scope"
  on public.loto_group_permit_handoffs
  for all to authenticated
  using (
    group_permit_id in (
      select id from public.loto_group_permits
      where tenant_id in (select public.current_user_tenant_ids())
        or public.is_superadmin()
    )
  )
  with check (
    group_permit_id in (
      select id from public.loto_group_permits
      where tenant_id in (select public.current_user_tenant_ids())
        or public.is_superadmin()
    )
  );

-- Audit triggers + updated_at
drop trigger if exists trg_audit_loto_group_permits          on public.loto_group_permits;
create trigger trg_audit_loto_group_permits          after insert or update or delete on public.loto_group_permits          for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_loto_group_permit_members   on public.loto_group_permit_members;
create trigger trg_audit_loto_group_permit_members   after insert or update or delete on public.loto_group_permit_members   for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_loto_group_permit_handoffs  on public.loto_group_permit_handoffs;
create trigger trg_audit_loto_group_permit_handoffs  after insert or update or delete on public.loto_group_permit_handoffs  for each row execute function public.log_audit('id');

drop trigger if exists trg_loto_group_permits_updated_at     on public.loto_group_permits;
create trigger trg_loto_group_permits_updated_at
  before update on public.loto_group_permits
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- 5. RPCs — close + handoff with invariant checks
-- ────────────────────────────────────────────────────────────────────
-- §(f)(3) requires every personal lock be removed before the group
-- box is opened. This RPC refuses to close while any member row has
-- left_at IS NULL. It also stamps ended_at + status under a row lock
-- so two admins clicking Close simultaneously can't both succeed.
create or replace function public.close_loto_group_permit(
  p_permit_id uuid,
  p_close_notes text default null
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_permit public.loto_group_permits%rowtype;
  v_active_members integer;
begin
  select * into v_permit
    from public.loto_group_permits
   where id = p_permit_id
   for update;
  if not found then raise exception 'group permit not found'; end if;
  if v_permit.status = 'closed' then raise exception 'group permit already closed'; end if;

  select count(*) into v_active_members
    from public.loto_group_permit_members
   where group_permit_id = p_permit_id
     and left_at is null;
  if v_active_members > 0 then
    raise exception 'cannot close group permit: % member(s) still attached', v_active_members;
  end if;

  update public.loto_group_permits
     set status = 'closed',
         ended_at = now(),
         close_notes = nullif(btrim(coalesce(p_close_notes, '')), '')
   where id = p_permit_id;
end $$;

-- §(f)(4) handoff RPC. Records the audit row, swaps the primary on
-- the parent permit, and sets status='shift_handed_off' to make
-- the transition visible in the list view. Idempotent against repeat
-- clicks via the row lock.
create or replace function public.handoff_loto_group_permit(
  p_permit_id  uuid,
  p_to_user_id uuid,
  p_notes      text default null
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_permit public.loto_group_permits%rowtype;
  v_from_user uuid := auth.uid();
begin
  if v_from_user is null then
    raise exception 'handoff requires an authenticated user';
  end if;
  if p_to_user_id is null then
    raise exception 'to_user_id is required';
  end if;
  if p_to_user_id = v_from_user then
    raise exception 'cannot hand off to yourself';
  end if;

  select * into v_permit
    from public.loto_group_permits
   where id = p_permit_id
   for update;
  if not found then raise exception 'group permit not found'; end if;
  if v_permit.status = 'closed' then raise exception 'cannot hand off a closed permit'; end if;

  insert into public.loto_group_permit_handoffs (
    group_permit_id, from_user_id, to_user_id, notes
  )
  values (
    p_permit_id, v_from_user, p_to_user_id, nullif(btrim(coalesce(p_notes, '')), '')
  );

  update public.loto_group_permits
     set primary_authorized_employee_id = p_to_user_id,
         status = 'shift_handed_off'
   where id = p_permit_id;
end $$;

notify pgrst, 'reload schema';

commit;
