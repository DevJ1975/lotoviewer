-- Migration 240: Unified Training & Competency Matrix.
--
-- Graduates the migration-119 "training matrix placeholder" into a real,
-- course-driven module, and unifies completions onto the member roster:
--   • training_courses             — the first-class course catalog (the missing
--                                    primitive; replaces the loose TrainingRole
--                                    enum + free-text requirement labels).
--   • loto_training_records        — becomes the single, MEMBER-KEYED completion
--                                    store: adds member_id + course_id, and KEEPS
--                                    worker_name + role so the pure permit
--                                    validators (packages/core/src/trainingRecords.ts)
--                                    keep working unchanged.
--   • position_course_requirements — position → required course (graduates
--                                    position_training_requirements).
--   • v_training_matrix            — org-wide "member × required course" status
--                                    view the admin matrix reads.
--
-- Backfill is best-effort + idempotent: seeds one course per training role in
-- use, links legacy completions to members by UNAMBIGUOUS name match (leaves
-- NULL on collisions/no-match — those stay name-only, still covered by the
-- name-based validators), and migrates the legacy position requirements to
-- courses.
--
-- Idempotent (if not exists / on conflict do nothing / drop ... if exists).

begin;

-- ── 1. training_courses — the catalog ───────────────────────────────────────
create table if not exists public.training_courses (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  code               text not null check (length(btrim(code)) between 1 and 80),
  title              text not null check (length(btrim(title)) between 1 and 160),
  category           text,
  -- Maps a course to a legacy permit TrainingRole (entrant, authorized_employee,
  -- hazcom, …) so the permit gates + My-Readiness reconcile a course with the
  -- name-based records. NULL for general courses (forklift, fall protection, …)
  -- with no permit-gate equivalent.
  role               text,
  -- NULL = one-time / no expiry; else drives expires_at on each completion.
  validity_months    int check (validity_months is null or validity_months > 0),
  competency_exam_id uuid references public.loto_competency_exams(id) on delete set null,
  -- True when every active member must hold this course (e.g. Fire/EAP, HazCom).
  required_for_all   boolean not null default false,
  active             boolean not null default true,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists idx_training_courses_tenant_active
  on public.training_courses (tenant_id, active, code);

-- ── 2. loto_training_records → member-keyed single completion store ─────────
alter table public.loto_training_records
  add column if not exists member_id uuid references public.members(id) on delete set null,
  add column if not exists course_id uuid references public.training_courses(id) on delete set null;

create index if not exists idx_loto_training_records_member
  on public.loto_training_records (tenant_id, member_id) where member_id is not null;
create index if not exists idx_loto_training_records_course
  on public.loto_training_records (tenant_id, course_id) where course_id is not null;

-- ── 3. position_course_requirements — position → required course ────────────
create table if not exists public.position_course_requirements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  position_id   uuid not null references public.worker_positions(id) on delete cascade,
  course_id     uuid not null references public.training_courses(id) on delete cascade,
  required      boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, position_id, course_id)
);

create index if not exists idx_position_course_requirements_position
  on public.position_course_requirements (tenant_id, position_id, required);

-- ── 4. RLS — member-read / admin-write, mirroring migration 119 ─────────────
alter table public.training_courses             enable row level security;
alter table public.position_course_requirements enable row level security;

drop policy if exists training_courses_read on public.training_courses;
create policy training_courses_read on public.training_courses
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists training_courses_write on public.training_courses;
create policy training_courses_write on public.training_courses
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists position_course_requirements_read on public.position_course_requirements;
create policy position_course_requirements_read on public.position_course_requirements
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists position_course_requirements_write on public.position_course_requirements;
create policy position_course_requirements_write on public.position_course_requirements
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop trigger if exists trg_training_courses_touch on public.training_courses;
create trigger trg_training_courses_touch
  before update on public.training_courses
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_position_course_requirements_touch on public.position_course_requirements;
create trigger trg_position_course_requirements_touch
  before update on public.position_course_requirements
  for each row execute function public.touch_updated_at();

-- ── 5. Backfill (idempotent) ────────────────────────────────────────────────
-- 5a. Seed one course per distinct training role currently in use.
insert into public.training_courses (tenant_id, code, title, role, validity_months)
select x.tenant_id, x.role,
       case x.role
         when 'entrant'             then 'Authorized entrant'
         when 'attendant'           then 'Attendant'
         when 'entry_supervisor'    then 'Entry supervisor'
         when 'rescuer'             then 'Rescuer'
         when 'hot_work_operator'   then 'Hot-work operator'
         when 'fire_watcher'        then 'Fire watcher'
         when 'authorized_employee' then 'LOTO authorized employee'
         when 'hazcom'              then 'HazCom 2012'
         when 'chemical_specific'   then 'Chemical-specific handler'
         else initcap(replace(x.role, '_', ' '))
       end,
       x.role,
       x.recurrence_months
from (
  select tenant_id, role, max(recurrence_months) as recurrence_months
    from public.position_training_requirements
   group by tenant_id, role
  union
  select tenant_id, role, null::int
    from public.loto_training_records
   group by tenant_id, role
) x
on conflict (tenant_id, code) do nothing;

-- 5b. Link legacy completions to members by UNAMBIGUOUS case-insensitive name
-- match (display_name or email). A name that maps to 0 or >1 members stays
-- NULL (name-only) — the name-based validators still cover those.
update public.loto_training_records r
   set member_id = m.id
  from (
    select n.tenant_id, n.lname, min(mm.id) as id
      from (select distinct tenant_id, lower(btrim(worker_name)) as lname
              from public.loto_training_records) n
      join public.members mm
        on mm.tenant_id = n.tenant_id
       and mm.merged_into_member_id is null
       and (lower(btrim(mm.display_name)) = n.lname or lower(btrim(mm.email)) = n.lname)
     group by n.tenant_id, n.lname
    having count(distinct mm.id) = 1
  ) m
 where r.member_id is null
   and r.tenant_id = m.tenant_id
   and lower(btrim(r.worker_name)) = m.lname;

-- 5c. Link legacy completions to the seeded course for their role.
update public.loto_training_records r
   set course_id = c.id
  from public.training_courses c
 where r.course_id is null
   and c.tenant_id = r.tenant_id
   and c.role = r.role;

-- 5d. Migrate position_training_requirements → position_course_requirements.
insert into public.position_course_requirements (tenant_id, position_id, course_id, required, notes)
select p.tenant_id, p.position_id, c.id, p.required, p.source_note
  from public.position_training_requirements p
  join public.training_courses c on c.tenant_id = p.tenant_id and c.role = p.role
on conflict (tenant_id, position_id, course_id) do nothing;

-- ── 6. v_training_matrix — member × required course, with derived status ────
create or replace view public.v_training_matrix
  with (security_invoker = true)
as
with member_position as (
  -- Each active member's current position: assignment by member_id, else by the
  -- member's login user (profile_id), else by a position_title → title match.
  select m.id as member_id, m.tenant_id,
         coalesce(a_mem.position_id, a_usr.position_id, wp_title.id) as position_id
    from public.members m
    left join public.worker_position_assignments a_mem
      on a_mem.tenant_id = m.tenant_id and a_mem.member_id = m.id and a_mem.is_current
    left join public.worker_position_assignments a_usr
      on a_usr.tenant_id = m.tenant_id and a_usr.user_id = m.profile_id and a_usr.is_current
    left join public.worker_positions wp_title
      on wp_title.tenant_id = m.tenant_id
     and lower(btrim(wp_title.title)) = lower(btrim(m.position_title))
   where m.status = 'active' and m.merged_into_member_id is null
),
required as (
  -- required_for_all courses ∪ the member's position-required courses.
  select mp.member_id, mp.tenant_id, c.id as course_id
    from member_position mp
    join public.training_courses c
      on c.tenant_id = mp.tenant_id and c.active and c.required_for_all
  union
  select mp.member_id, mp.tenant_id, pcr.course_id
    from member_position mp
    join public.position_course_requirements pcr
      on pcr.tenant_id = mp.tenant_id and pcr.position_id = mp.position_id and pcr.required
    join public.training_courses c
      on c.id = pcr.course_id and c.active
)
select
  req.tenant_id,
  req.member_id,
  m.display_name,
  m.department,
  m.position_title,
  req.course_id,
  c.code  as course_code,
  c.title as course_title,
  c.category,
  comp.completed_at,
  comp.expires_at,
  case
    when comp.id is null then 'missing'
    when comp.expires_at is not null and comp.expires_at < current_date then 'overdue'
    when comp.expires_at is not null and comp.expires_at <= current_date + interval '30 days' then 'due_soon'
    else 'current'
  end as status
from required req
join public.members m on m.id = req.member_id
join public.training_courses c on c.id = req.course_id
left join lateral (
  -- Freshest completion for this member+course (member_id, or name fallback for
  -- legacy rows not yet linked).
  select t.id, t.completed_at, t.expires_at
    from public.loto_training_records t
   where t.tenant_id = req.tenant_id
     and t.course_id = req.course_id
     and (t.member_id = req.member_id
          or (t.member_id is null
              and lower(btrim(t.worker_name)) = lower(btrim(m.display_name))))
   order by t.completed_at desc, t.created_at desc
   limit 1
) comp on true;

notify pgrst, 'reload schema';

commit;
