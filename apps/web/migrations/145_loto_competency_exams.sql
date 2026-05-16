-- Migration 145: §1910.147(c)(7) competency exam module.
--
-- §147(c)(7) requires the employer to provide training so authorized
-- and affected employees can demonstrate understanding of the
-- energy-control procedures. Today the app records training events
-- (loto_training_records) but has no way to prove understanding —
-- a cert without a competency test is just a sign-in sheet.
--
-- Two new tables:
--
--   loto_competency_exams — template definitions per role
--     (operator | supervisor | energy_iso | rescue). Questions are
--     stored as a jsonb array of { prompt, choices, answer_index }
--     so the schema doesn't need a migration when an exam adds a
--     new MC question. passing_score is the integer % that
--     attempts must meet or exceed.
--
--   loto_competency_exam_attempts — one row per (worker, exam,
--     attempt). Captures start/complete timestamps, computed score,
--     pass boolean, and the answers array for review. The
--     `proctor_user_id` field is the admin who sat with the worker
--     (a proctored attempt is what §147(c)(7) audits accept; an
--     unproctored attempt is informational only).
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. loto_competency_exams
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.loto_competency_exams (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          uuid        not null references public.tenants(id) on delete cascade,
  title              text        not null check (length(btrim(title)) > 0),
  role               text        not null
                       check (role in ('operator', 'supervisor', 'energy_iso', 'rescue')),
  -- jsonb array of question objects. The TS validator
  -- (lotoCompetencyExam.ts) defines the shape; the DB only enforces
  -- that it's an array because question schemas evolve faster than
  -- migrations should.
  questions          jsonb       not null default '[]'::jsonb,
  passing_score      integer     not null default 80
                       check (passing_score between 0 and 100),
  active             boolean     not null default true,
  created_by         uuid        references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chk_loto_exam_questions_is_array check (jsonb_typeof(questions) = 'array')
);

create index if not exists idx_loto_competency_exams_role
  on public.loto_competency_exams(tenant_id, role)
  where active;

comment on table public.loto_competency_exams is
  'Templates for §1910.147(c)(7) competency exams. One row per (tenant, role, version). Questions are jsonb; the TS validator pins the shape.';

-- ────────────────────────────────────────────────────────────────────
-- 2. loto_competency_exam_attempts
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.loto_competency_exam_attempts (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references public.tenants(id) on delete cascade,
  exam_id             uuid        not null references public.loto_competency_exams(id) on delete cascade,
  worker_id           uuid        not null references public.loto_workers(id) on delete cascade,
  -- The admin who proctored the attempt. NULL = self-attempted,
  -- which the audit doesn't accept. The UI surfaces "unproctored"
  -- badges on attempts with no proctor.
  proctor_user_id     uuid        references public.profiles(id) on delete set null,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  score               integer     check (score is null or score between 0 and 100),
  passed              boolean,
  -- jsonb array of selected choice indices, parallel to the exam's
  -- questions array. Stored verbatim so a future "show the worker
  -- their answers" feature doesn't need to rederive them.
  answers             jsonb       not null default '[]'::jsonb,
  -- Optional FK so a passing attempt can be auto-linked to the
  -- training_records row the route creates.
  training_record_id  uuid        references public.loto_training_records(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint chk_loto_exam_attempt_completed_consistent check (
    (completed_at is null and score is null and passed is null)
    or (completed_at is not null and score is not null and passed is not null)
  ),
  constraint chk_loto_exam_attempt_answers_array check (jsonb_typeof(answers) = 'array')
);

create index if not exists idx_loto_competency_exam_attempts_worker
  on public.loto_competency_exam_attempts(tenant_id, worker_id, started_at desc);

create index if not exists idx_loto_competency_exam_attempts_exam
  on public.loto_competency_exam_attempts(exam_id, completed_at desc);

comment on table public.loto_competency_exam_attempts is
  'One row per (worker, exam) attempt of a §147(c)(7) competency exam. proctor_user_id is required for audit-grade attempts; the answers jsonb mirrors the exam questions for replay.';

-- ────────────────────────────────────────────────────────────────────
-- 3. RLS + audit
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_competency_exams         enable row level security;
alter table public.loto_competency_exam_attempts enable row level security;

drop policy if exists "loto_competency_exams_tenant_scope"
  on public.loto_competency_exams;
create policy "loto_competency_exams_tenant_scope"
  on public.loto_competency_exams
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop policy if exists "loto_competency_exam_attempts_tenant_scope"
  on public.loto_competency_exam_attempts;
create policy "loto_competency_exam_attempts_tenant_scope"
  on public.loto_competency_exam_attempts
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_audit_loto_competency_exams
  on public.loto_competency_exams;
create trigger trg_audit_loto_competency_exams
  after insert or update or delete on public.loto_competency_exams
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_loto_competency_exam_attempts
  on public.loto_competency_exam_attempts;
create trigger trg_audit_loto_competency_exam_attempts
  after insert or update or delete on public.loto_competency_exam_attempts
  for each row execute function public.log_audit('id');

drop trigger if exists trg_loto_competency_exams_updated_at
  on public.loto_competency_exams;
create trigger trg_loto_competency_exams_updated_at
  before update on public.loto_competency_exams
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';

commit;
