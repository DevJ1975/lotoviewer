-- Migration 193: configurable inspection / audit builder.
--
-- A generic, tenant-authored inspection engine: templates (with versioned
-- items) → inspections (a run of a template) → responses (per-item answers).
-- Distinct from the regulated, bespoke flows (equipment-readiness, hazwaste);
-- this is for ad-hoc / configurable inspections + audits.
--
-- Idempotent throughout.

begin;

create table if not exists public.inspection_templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  description  text,
  category     text not null default 'general',
  scoring_mode text not null default 'weighted' check (scoring_mode in ('weighted','none')),
  version      int  not null default 1,
  active       boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_inspection_templates_tenant
  on public.inspection_templates(tenant_id, active, name);

create table if not exists public.inspection_template_items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  template_id         uuid not null references public.inspection_templates(id) on delete cascade,
  section             text not null default 'General',
  sort_order          int  not null default 0,
  item_type           text not null
                        check (item_type in ('pass_fail_na','multiple_choice','numeric','text','photo','signature')),
  prompt              text not null,
  required            boolean not null default false,
  weight              numeric not null default 1,
  fail_creates_action boolean not null default false,
  config              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists idx_inspection_template_items_tmpl
  on public.inspection_template_items(template_id, sort_order);

create table if not exists public.inspections (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  template_id      uuid not null references public.inspection_templates(id) on delete restrict,
  template_version int not null,
  title            text not null,
  subject_type     text,
  subject_id       text,
  assignee_user_id uuid references public.profiles(id) on delete set null,
  status           text not null default 'in_progress'
                     check (status in ('in_progress','submitted')),
  score            numeric,
  max_score        numeric,
  result           text check (result in ('pass','fail')),
  due_at           date,
  started_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  submitted_by     uuid references public.profiles(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_inspections_tenant_status
  on public.inspections(tenant_id, status, started_at desc);

create table if not exists public.inspection_responses (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  item_id       uuid not null references public.inspection_template_items(id) on delete restrict,
  value         jsonb,
  result        text check (result in ('pass','fail','na')),
  evidence_id   text,
  note          text,
  created_at    timestamptz not null default now(),
  unique (inspection_id, item_id)
);

create index if not exists idx_inspection_responses_inspection
  on public.inspection_responses(tenant_id, inspection_id);

-- RLS: tenant-scope all four (member read/write; API gates admin for builder).
do $$
declare t text;
begin
  foreach t in array array[
    'inspection_templates','inspection_template_items','inspections','inspection_responses'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_scope', t);
    execute format($p$
      create policy %I on public.%I
        for all to authenticated
        using (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
        )
        with check (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
        )
    $p$, t || '_tenant_scope', t);
  end loop;
end $$;

drop trigger if exists trg_audit_inspection_templates on public.inspection_templates;
create trigger trg_audit_inspection_templates
  after insert or update or delete on public.inspection_templates
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_inspections on public.inspections;
create trigger trg_audit_inspections
  after insert or update or delete on public.inspections
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
