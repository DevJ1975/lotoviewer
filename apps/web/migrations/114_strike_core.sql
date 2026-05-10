-- Migration 114: STRIKE microlearning and task-readiness foundation.
--
-- STRIKE = Safety Training & Rapid Instruction for Knowledge Execution.
-- Adds the versioned training library, quiz, assignment, completion,
-- high-risk task requirement, readiness-check, tenant settings, and
-- STRIKE Studio request tables needed for the Phase 1 MVP.

begin;

create table if not exists public.strike_modules (
  id                 uuid not null primary key default gen_random_uuid(),
  tenant_id          uuid references public.tenants(id) on delete cascade,
  library_scope      text not null check (library_scope in ('global', 'tenant')),
  title              text not null check (length(trim(title)) between 1 and 160),
  slug               text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  description        text,
  category           text,
  tags               text[] not null default '{}',
  estimated_minutes  int check (estimated_minutes is null or estimated_minutes between 1 and 60),
  status             text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'archived', 'superseded')),
  thumbnail_path     text,
  created_by         uuid references auth.users(id),
  updated_by         uuid references auth.users(id),
  published_at       timestamptz,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  check (
    (library_scope = 'global' and tenant_id is null)
    or (library_scope = 'tenant' and tenant_id is not null)
  )
);

create unique index if not exists strike_modules_global_slug_uq
  on public.strike_modules(slug)
  where library_scope = 'global';

create unique index if not exists strike_modules_tenant_slug_uq
  on public.strike_modules(tenant_id, slug)
  where library_scope = 'tenant';

create index if not exists idx_strike_modules_tenant_status
  on public.strike_modules(tenant_id, status, updated_at desc);

create table if not exists public.strike_module_versions (
  id                 uuid not null primary key default gen_random_uuid(),
  module_id          uuid not null references public.strike_modules(id) on delete cascade,
  tenant_id          uuid references public.tenants(id) on delete cascade,
  library_scope      text not null check (library_scope in ('global', 'tenant')),
  version_number     int not null check (version_number > 0),
  status             text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'archived', 'superseded')),
  video_path         text,
  thumbnail_path     text,
  captions_path      text,
  transcript         text,
  reference_paths    jsonb not null default '[]'::jsonb,
  duration_seconds   int check (duration_seconds is null or duration_seconds > 0),
  passing_score      int not null default 80 check (passing_score between 0 and 100),
  retake_limit       int check (retake_limit is null or retake_limit > 0),
  created_by         uuid references auth.users(id),
  published_at       timestamptz,
  created_at         timestamptz not null default now(),

  unique (module_id, version_number),
  check (
    (library_scope = 'global' and tenant_id is null)
    or (library_scope = 'tenant' and tenant_id is not null)
  )
);

create index if not exists idx_strike_versions_module_status
  on public.strike_module_versions(module_id, status, version_number desc);

create table if not exists public.strike_quiz_questions (
  id                 uuid not null primary key default gen_random_uuid(),
  module_version_id  uuid not null references public.strike_module_versions(id) on delete cascade,
  tenant_id          uuid references public.tenants(id) on delete cascade,
  library_scope      text not null check (library_scope in ('global', 'tenant')),
  question_type      text not null check (question_type in ('multiple_choice', 'true_false', 'select_all', 'acknowledgement')),
  prompt             text not null check (length(trim(prompt)) between 1 and 2000),
  explanation        text,
  sort_order         int not null default 0,
  required           boolean not null default true,
  points             int not null default 1 check (points >= 0),
  created_at         timestamptz not null default now(),

  check (
    (library_scope = 'global' and tenant_id is null)
    or (library_scope = 'tenant' and tenant_id is not null)
  )
);

create index if not exists idx_strike_questions_version_order
  on public.strike_quiz_questions(module_version_id, sort_order, id);

create table if not exists public.strike_quiz_answers (
  id           uuid not null primary key default gen_random_uuid(),
  question_id  uuid not null references public.strike_quiz_questions(id) on delete cascade,
  tenant_id    uuid references public.tenants(id) on delete cascade,
  library_scope text not null check (library_scope in ('global', 'tenant')),
  answer_text  text not null check (length(trim(answer_text)) between 1 and 1000),
  is_correct   boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),

  check (
    (library_scope = 'global' and tenant_id is null)
    or (library_scope = 'tenant' and tenant_id is not null)
  )
);

create index if not exists idx_strike_answers_question_order
  on public.strike_quiz_answers(question_id, sort_order, id);

create table if not exists public.strike_assignments (
  id                 uuid not null primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  module_id          uuid not null references public.strike_modules(id) on delete cascade,
  module_version_id  uuid references public.strike_module_versions(id) on delete set null,
  target_type        text not null check (target_type in ('tenant', 'site', 'department', 'role', 'user')),
  target_id          text,
  assigned_by        uuid references auth.users(id),
  assigned_at        timestamptz not null default now(),
  due_at             timestamptz,
  expires_at         timestamptz,
  recurrence_rule    jsonb,
  reason             text,
  status             text not null default 'active' check (status in ('active', 'paused', 'archived')),

  check ((target_type = 'tenant' and target_id is null) or (target_type <> 'tenant' and target_id is not null))
);

create index if not exists idx_strike_assignments_tenant_status
  on public.strike_assignments(tenant_id, status, due_at);
create index if not exists idx_strike_assignments_target
  on public.strike_assignments(tenant_id, target_type, target_id);

create table if not exists public.strike_attempts (
  id                 uuid not null primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  module_id          uuid not null references public.strike_modules(id) on delete cascade,
  module_version_id  uuid not null references public.strike_module_versions(id) on delete cascade,
  assignment_id      uuid references public.strike_assignments(id) on delete set null,
  user_id            uuid not null references auth.users(id) on delete cascade,
  started_at         timestamptz not null default now(),
  submitted_at       timestamptz,
  score_percent      int check (score_percent is null or score_percent between 0 and 100),
  passed             boolean not null default false,
  answers            jsonb not null default '{}'::jsonb,
  client_context     jsonb not null default '{}'::jsonb
);

create index if not exists idx_strike_attempts_user_recent
  on public.strike_attempts(tenant_id, user_id, started_at desc);
create index if not exists idx_strike_attempts_module
  on public.strike_attempts(tenant_id, module_id, started_at desc);

create table if not exists public.strike_completions (
  id                 uuid not null primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  module_id          uuid not null references public.strike_modules(id) on delete cascade,
  module_version_id  uuid not null references public.strike_module_versions(id) on delete cascade,
  assignment_id      uuid references public.strike_assignments(id) on delete set null,
  attempt_id         uuid references public.strike_attempts(id) on delete set null,
  user_id            uuid not null references auth.users(id) on delete cascade,
  completed_at       timestamptz not null default now(),
  expires_at         timestamptz,
  score_percent      int check (score_percent is null or score_percent between 0 and 100),
  passed             boolean not null default true,
  source             text not null default 'library' check (source in ('assigned', 'library', 'task_check', 'corrective_action', 'admin')),
  evidence           jsonb not null default '{}'::jsonb,

  unique (tenant_id, user_id, module_version_id, completed_at)
);

create index if not exists idx_strike_completions_user_current
  on public.strike_completions(tenant_id, user_id, module_id, completed_at desc);
create index if not exists idx_strike_completions_expiring
  on public.strike_completions(tenant_id, expires_at)
  where expires_at is not null;

create table if not exists public.strike_training_requirements (
  id                    uuid not null primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  module_id             uuid not null references public.strike_modules(id) on delete cascade,
  module_version_id     uuid references public.strike_module_versions(id) on delete set null,
  source_type           text not null check (source_type in ('loto', 'confined_space', 'hot_work', 'jha', 'chemical', 'bbs', 'incident', 'incident_action', 'safety_board', 'manual', 'custom')),
  source_id             uuid,
  hazard_category       text,
  required_before_start boolean not null default false,
  expires_after_days    int check (expires_after_days is null or expires_after_days > 0),
  active                boolean not null default true,
  notes                 text,
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now()
);

create index if not exists idx_strike_requirements_source
  on public.strike_training_requirements(tenant_id, source_type, source_id)
  where active;

create table if not exists public.strike_task_checks (
  id                     uuid not null primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  user_id                uuid references auth.users(id) on delete set null,
  source_type            text not null check (source_type in ('loto', 'confined_space', 'hot_work', 'jha', 'chemical', 'bbs', 'incident', 'incident_action', 'safety_board', 'manual', 'custom')),
  source_id              uuid,
  requirement_id         uuid references public.strike_training_requirements(id) on delete set null,
  module_id              uuid references public.strike_modules(id) on delete set null,
  module_version_id      uuid references public.strike_module_versions(id) on delete set null,
  completion_id          uuid references public.strike_completions(id) on delete set null,
  readiness_status       text not null check (readiness_status in ('ready', 'partial', 'blocked', 'not_required')),
  required_count         int not null default 0 check (required_count >= 0),
  valid_completion_count int not null default 0 check (valid_completion_count >= 0),
  checked_by             uuid references auth.users(id),
  checked_at             timestamptz not null default now(),
  notes                  text
);

create index if not exists idx_strike_task_checks_source
  on public.strike_task_checks(tenant_id, source_type, source_id, checked_at desc);
create index if not exists idx_strike_task_checks_user
  on public.strike_task_checks(tenant_id, user_id, checked_at desc);

create table if not exists public.strike_tenant_settings (
  tenant_id                    uuid not null primary key references public.tenants(id) on delete cascade,
  tenant_authoring_enabled      boolean not null default false,
  require_quiz_pass_for_credit  boolean not null default true,
  default_passing_score         int not null default 80 check (default_passing_score between 0 and 100),
  leaderboard_enabled           boolean not null default true,
  team_leaderboard_enabled      boolean not null default true,
  updated_by                    uuid references auth.users(id),
  updated_at                    timestamptz not null default now()
);

create table if not exists public.strike_studio_requests (
  id                  uuid not null primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  requested_by        uuid references auth.users(id),
  title               text not null check (length(trim(title)) between 1 and 160),
  request_type        text not null default 'custom_module' check (request_type in ('custom_module', 'content_refresh', 'site_filming', 'consultation')),
  priority            text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status              text not null default 'requested' check (status in ('requested', 'scoping', 'scheduled', 'filming', 'editing', 'review', 'delivered', 'cancelled')),
  task_description    text,
  site_location       text,
  target_audience     text,
  desired_due_date    date,
  source_documents    jsonb not null default '[]'::jsonb,
  internal_notes      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_strike_studio_requests_tenant_status
  on public.strike_studio_requests(tenant_id, status, created_at desc);

alter table public.strike_modules               enable row level security;
alter table public.strike_module_versions       enable row level security;
alter table public.strike_quiz_questions        enable row level security;
alter table public.strike_quiz_answers          enable row level security;
alter table public.strike_assignments           enable row level security;
alter table public.strike_attempts              enable row level security;
alter table public.strike_completions           enable row level security;
alter table public.strike_training_requirements enable row level security;
alter table public.strike_task_checks           enable row level security;
alter table public.strike_tenant_settings       enable row level security;
alter table public.strike_studio_requests       enable row level security;

drop policy if exists strike_modules_read on public.strike_modules;
create policy strike_modules_read on public.strike_modules
  for select to authenticated
  using (
    (library_scope = 'global' and (status = 'published' or public.is_superadmin()))
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    )
  );

drop policy if exists strike_modules_write on public.strike_modules;
create policy strike_modules_write on public.strike_modules
  for all to authenticated
  using (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  )
  with check (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  );

drop policy if exists strike_global_or_tenant_content_read on public.strike_module_versions;
create policy strike_global_or_tenant_content_read on public.strike_module_versions
  for select to authenticated
  using (
    (library_scope = 'global' and (status = 'published' or public.is_superadmin()))
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    )
  );

drop policy if exists strike_global_or_tenant_content_write on public.strike_module_versions;
create policy strike_global_or_tenant_content_write on public.strike_module_versions
  for all to authenticated
  using (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  )
  with check (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  );

drop policy if exists strike_questions_read on public.strike_quiz_questions;
drop policy if exists strike_answers_read on public.strike_quiz_answers;
create policy strike_questions_read on public.strike_quiz_questions
  for select to authenticated
  using (
    (
      library_scope = 'global'
      and (
        public.is_superadmin()
        or exists (
          select 1
          from public.strike_module_versions v
          join public.strike_modules m on m.id = v.module_id
          where v.id = strike_quiz_questions.module_version_id
            and v.status = 'published'
            and m.status = 'published'
        )
      )
    )
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    )
  );
create policy strike_answers_read on public.strike_quiz_answers
  for select to authenticated
  using (
    (
      library_scope = 'global'
      and (
        public.is_superadmin()
        or exists (
          select 1
          from public.strike_quiz_questions q
          join public.strike_module_versions v on v.id = q.module_version_id
          join public.strike_modules m on m.id = v.module_id
          where q.id = strike_quiz_answers.question_id
            and v.status = 'published'
            and m.status = 'published'
        )
      )
    )
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    )
  );

drop policy if exists strike_questions_write on public.strike_quiz_questions;
drop policy if exists strike_answers_write on public.strike_quiz_answers;
create policy strike_questions_write on public.strike_quiz_questions
  for all to authenticated
  using (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  )
  with check (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  );
create policy strike_answers_write on public.strike_quiz_answers
  for all to authenticated
  using (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  )
  with check (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  );

drop policy if exists strike_assignments_read on public.strike_assignments;
create policy strike_assignments_read on public.strike_assignments
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_assignments_write on public.strike_assignments;
create policy strike_assignments_write on public.strike_assignments
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_attempts_read on public.strike_attempts;
create policy strike_attempts_read on public.strike_attempts
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      user_id = auth.uid()
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );

drop policy if exists strike_attempts_insert on public.strike_attempts;
create policy strike_attempts_insert on public.strike_attempts
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      (user_id = auth.uid() and tenant_id in (select public.current_user_tenant_ids()))
      or public.is_superadmin()
    )
  );

drop policy if exists strike_attempts_update on public.strike_attempts;
create policy strike_attempts_update on public.strike_attempts
  for update to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      (user_id = auth.uid() and tenant_id in (select public.current_user_tenant_ids()))
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      (user_id = auth.uid() and tenant_id in (select public.current_user_tenant_ids()))
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );

drop policy if exists strike_completions_read on public.strike_completions;
create policy strike_completions_read on public.strike_completions
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      user_id = auth.uid()
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );

drop policy if exists strike_completions_insert on public.strike_completions;
create policy strike_completions_insert on public.strike_completions
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      user_id = auth.uid()
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );

drop policy if exists strike_requirements_read on public.strike_training_requirements;
create policy strike_requirements_read on public.strike_training_requirements
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_requirements_write on public.strike_training_requirements;
create policy strike_requirements_write on public.strike_training_requirements
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_task_checks_read on public.strike_task_checks;
create policy strike_task_checks_read on public.strike_task_checks
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      user_id = auth.uid()
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );

drop policy if exists strike_task_checks_write on public.strike_task_checks;
create policy strike_task_checks_write on public.strike_task_checks
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_tenant_settings_admin on public.strike_tenant_settings;
create policy strike_tenant_settings_admin on public.strike_tenant_settings
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_studio_requests_read on public.strike_studio_requests;
create policy strike_studio_requests_read on public.strike_studio_requests
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_studio_requests_write on public.strike_studio_requests;
create policy strike_studio_requests_write on public.strike_studio_requests
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

insert into storage.buckets (id, name, public)
values ('strike-media', 'strike-media', false)
on conflict (id) do nothing;

drop policy if exists strike_media_read on storage.objects;
create policy strike_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'strike-media'
    and case
      when split_part(name, '/', 1) = 'global' then true
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids()) or public.is_superadmin()
      else false
    end
  );

drop policy if exists strike_media_write on storage.objects;
create policy strike_media_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'strike-media'
    and case
      when split_part(name, '/', 1) = 'global' then public.is_superadmin()
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (split_part(name, '/', 1))::uuid in (select public.current_user_admin_tenant_ids()) or public.is_superadmin()
      else false
    end
  )
  with check (
    bucket_id = 'strike-media'
    and case
      when split_part(name, '/', 1) = 'global' then public.is_superadmin()
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (split_part(name, '/', 1))::uuid in (select public.current_user_admin_tenant_ids()) or public.is_superadmin()
      else false
    end
  );

notify pgrst, 'reload schema';

commit;
