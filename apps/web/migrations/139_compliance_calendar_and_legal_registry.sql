-- Migration 139: AI-driven Compliance Calendar + Legal Registry.
--
-- Two domain tables wired into the existing multi-tenant pattern:
--
--   * legal_register          — applicable laws, regulations, standards
--                               (OSHA, EPA, ISO 45001, state DOL, internal).
--                               One row per citation per tenant.
--   * compliance_obligations  — recurring or one-shot calendar items
--                               (annual LOTO audit, quarterly drill, OSHA
--                               300A posting). Optionally linked to a
--                               legal_register row for citation-of-record.
--
-- A small audit table records each completion so that overdue handling and
-- inspector evidence both have a stable history. The status field on the
-- obligation row is derived at query time (see @soteria/core/compliance);
-- we persist only the raw inputs to that derivation.
--
-- RLS posture matches the rest of the app: tenant members read/write rows
-- for their active tenant (header-scoped via `x-active-tenant`), admins
-- handle destructive ops at the route gate.

begin;

-- ──────────────────────────────────────────────────────────────────────
-- legal_register
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.legal_register (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,
  citation             text        not null,
  title                text        not null,
  jurisdiction         text        not null,
  authority            text,
  source_url           text,
  summary              text,
  applicability_note   text,
  status               text        not null default 'active'
                                     check (status in ('active','under_review','superseded','not_applicable')),
  effective_date       date,
  last_reviewed_at     timestamptz,
  next_review_due      date,
  review_frequency     text        check (review_frequency in (
                                     'one_time','quarterly','semiannual','annual','biennial','triennial'
                                   )),
  tags                 text[]      not null default '{}',
  ai_generated         boolean     not null default false,
  ai_model             text,
  created_by           uuid        references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, citation)
);

create index if not exists idx_legal_register_tenant_status
  on public.legal_register (tenant_id, status, next_review_due nulls last);

create index if not exists idx_legal_register_tenant_review_due
  on public.legal_register (tenant_id, next_review_due)
  where next_review_due is not null and status = 'active';

comment on table public.legal_register is
  'Per-tenant legal registry — applicable laws, regulations, and standards. AI-summarized via /api/compliance/registry/[id]/ai-summarize; humans confirm before relying on it.';

-- ──────────────────────────────────────────────────────────────────────
-- compliance_obligations
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.compliance_obligations (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,
  legal_register_id    uuid        references public.legal_register(id) on delete set null,
  title                text        not null,
  description          text,
  category             text        not null default 'other'
                                     check (category in (
                                       'training','inspection','reporting','audit',
                                       'permit_renewal','drill','submission','review','other'
                                     )),
  jurisdiction         text,
  frequency            text        not null default 'annual'
                                     check (frequency in (
                                       'one_time','daily','weekly','monthly','quarterly',
                                       'semiannual','annual','biennial','custom_days'
                                     )),
  frequency_days       integer     check (frequency_days is null or frequency_days > 0),
  next_due_date        date        not null,
  lead_days            integer     not null default 14
                                     check (lead_days >= 0 and lead_days <= 365),
  last_completed_at    timestamptz,
  snoozed_until        date,
  not_applicable       boolean     not null default false,
  responsible_party    text,
  evidence_required    boolean     not null default false,
  notes                text,
  ai_generated         boolean     not null default false,
  ai_model             text,
  created_by           uuid        references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- The hot read path: "what is due, sorted by due date" per tenant.
create index if not exists idx_compliance_obligations_tenant_due
  on public.compliance_obligations (tenant_id, next_due_date)
  where not_applicable = false;

create index if not exists idx_compliance_obligations_tenant_register
  on public.compliance_obligations (tenant_id, legal_register_id)
  where legal_register_id is not null;

comment on table public.compliance_obligations is
  'Per-tenant compliance calendar items. Status is derived from next_due_date/last_completed_at/snoozed_until/not_applicable at query time — never persisted on the row to avoid drift.';

-- ──────────────────────────────────────────────────────────────────────
-- compliance_obligation_completions
--
-- Append-only audit log. Each row records one completion of an obligation;
-- after writing, the parent obligation's last_completed_at + next_due_date
-- are bumped by the completion route (not by trigger — keeping the cadence
-- math in application code so the rule lives next to its tests).
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.compliance_obligation_completions (
  id              uuid        primary key default gen_random_uuid(),
  obligation_id   uuid        not null references public.compliance_obligations(id) on delete cascade,
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  completed_at    timestamptz not null default now(),
  completed_by    uuid        references auth.users(id) on delete set null,
  notes           text,
  evidence_url    text
);

create index if not exists idx_compliance_completions_obligation_recent
  on public.compliance_obligation_completions (obligation_id, completed_at desc);

comment on table public.compliance_obligation_completions is
  'Audit log of compliance obligation completions. Append-only; powers the inspector evidence trail.';

-- ──────────────────────────────────────────────────────────────────────
-- updated_at triggers — reuse the project-wide set_updated_at() helper.
-- (Defined in migration 040; falls back to local trigger if not present.)
-- ──────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'set_updated_at'
  ) then
    create function public.set_updated_at() returns trigger as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$ language plpgsql;
  end if;
end$$;

drop trigger if exists trg_legal_register_updated_at on public.legal_register;
create trigger trg_legal_register_updated_at
  before update on public.legal_register
  for each row execute function public.set_updated_at();

drop trigger if exists trg_compliance_obligations_updated_at on public.compliance_obligations;
create trigger trg_compliance_obligations_updated_at
  before update on public.compliance_obligations
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- RLS — tenant-member read, tenant-admin write. Same posture as
-- migration 040 (risk register) so the auth/tenantGate.ts helpers
-- compose without surprises.
-- ──────────────────────────────────────────────────────────────────────
alter table public.legal_register                   enable row level security;
alter table public.compliance_obligations           enable row level security;
alter table public.compliance_obligation_completions enable row level security;

-- Helper macro: a tenant-member predicate identical to the one in
-- migrations 040 and 129. Inlined for clarity; PG will optimize away.

drop policy if exists "legal_register_tenant_member_read" on public.legal_register;
create policy "legal_register_tenant_member_read"
  on public.legal_register for select to authenticated
  using (
    exists (
      select 1 from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = legal_register.tenant_id
    )
    or public.is_superadmin()
  );

drop policy if exists "legal_register_tenant_member_write" on public.legal_register;
create policy "legal_register_tenant_member_write"
  on public.legal_register for all to authenticated
  using (
    exists (
      select 1 from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = legal_register.tenant_id
         and m.role in ('owner','admin','member')
    )
    or public.is_superadmin()
  )
  with check (
    exists (
      select 1 from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = legal_register.tenant_id
         and m.role in ('owner','admin','member')
    )
    or public.is_superadmin()
  );

drop policy if exists "compliance_obligations_tenant_member_read" on public.compliance_obligations;
create policy "compliance_obligations_tenant_member_read"
  on public.compliance_obligations for select to authenticated
  using (
    exists (
      select 1 from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = compliance_obligations.tenant_id
    )
    or public.is_superadmin()
  );

drop policy if exists "compliance_obligations_tenant_member_write" on public.compliance_obligations;
create policy "compliance_obligations_tenant_member_write"
  on public.compliance_obligations for all to authenticated
  using (
    exists (
      select 1 from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = compliance_obligations.tenant_id
         and m.role in ('owner','admin','member')
    )
    or public.is_superadmin()
  )
  with check (
    exists (
      select 1 from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = compliance_obligations.tenant_id
         and m.role in ('owner','admin','member')
    )
    or public.is_superadmin()
  );

drop policy if exists "compliance_completions_tenant_member_read" on public.compliance_obligation_completions;
create policy "compliance_completions_tenant_member_read"
  on public.compliance_obligation_completions for select to authenticated
  using (
    exists (
      select 1 from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = compliance_obligation_completions.tenant_id
    )
    or public.is_superadmin()
  );

drop policy if exists "compliance_completions_tenant_member_insert" on public.compliance_obligation_completions;
create policy "compliance_completions_tenant_member_insert"
  on public.compliance_obligation_completions for insert to authenticated
  with check (
    exists (
      select 1 from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = compliance_obligation_completions.tenant_id
         and m.role in ('owner','admin','member')
    )
    or public.is_superadmin()
  );

notify pgrst, 'reload schema';

commit;
