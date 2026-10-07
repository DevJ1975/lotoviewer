-- Migration 298: RECOVERY (reconstructed) of out-of-band migration 20260513205353
-- ("compliance_calendar_and_legal_registry_139", applied to production 2026-05-13
-- via MCP).
--
-- legal_register, compliance_obligations and compliance_obligation_completions
-- exist in production (0 rows each, per docs/audits/migration-reconciliation-2026-08-28.md)
-- but in no committed migration, so a rebuild from migrations/ loses them — and
-- breaks 241, which indexes compliance_obligation_completions.
--
-- THIS IS A RECONSTRUCTION, NOT THE BYTE-IDENTICAL LEDGER BODY. The production
-- ledger was not reachable when this was written. Columns, nullability and FKs
-- come from packages/core/src/database.types.ts (generated from the live
-- schema); column DEFAULTS that the types only reveal as "optional on insert"
-- (status, category, frequency, lead_days) are inferred; check constraints,
-- indexes and the original policies are unknown and are NOT invented. If anyone
-- can fetch the ledger body, replace this file with it (verify by md5) — the
-- statements below are written so that doing so changes nothing in production.
--
-- Production-safe by construction:
--   * `create table if not exists`: a no-op wherever the table exists.
--   * Row-level security is enabled (a no-op where already on) and a baseline
--     tenant-scope policy is created ONLY when the table has no policy at all,
--     so production's existing policies are never replaced or added to.
--   * Nothing is dropped or altered.
--
-- The next migration converges production and a fresh rebuild onto one known
-- column set and policy set. Numbered 298 to leave 294-297 for migrations
-- already in review on other branches.
--
-- Idempotent. No rollback: this only restores objects that already exist in
-- production, and dropping them would destroy tenant data.

begin;

create table if not exists public.legal_register (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  title               text not null,
  citation            text not null,
  jurisdiction        text not null,
  authority           text,
  summary             text,
  applicability_note  text,
  source_url          text,
  effective_date      date,
  status              text not null default 'active',
  review_frequency    text,
  last_reviewed_at    timestamptz,
  next_review_due     date,
  tags                text[] not null default '{}',
  ai_generated        boolean not null default false,
  ai_model            text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.compliance_obligations (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  legal_register_id   uuid references public.legal_register(id),
  title               text not null,
  description         text,
  category            text not null default 'general',
  jurisdiction        text,
  frequency           text not null default 'annual',
  frequency_days      int,
  next_due_date       date not null,
  last_completed_at   timestamptz,
  lead_days           int not null default 30,
  responsible_party   text,
  evidence_required   boolean not null default false,
  not_applicable      boolean not null default false,
  snoozed_until       date,
  notes               text,
  ai_generated        boolean not null default false,
  ai_model            text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.compliance_obligation_completions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  obligation_id       uuid not null references public.compliance_obligations(id),
  completed_at        timestamptz not null default now(),
  completed_by        uuid,
  evidence_url        text,
  notes               text
);

alter table public.legal_register                     enable row level security;
alter table public.compliance_obligations             enable row level security;
alter table public.compliance_obligation_completions enable row level security;

-- Baseline policy, only where the table has none (a fresh rebuild). Where any
-- policy exists - production - nothing is touched.
do $$
declare
  t text;
begin
  foreach t in array array['legal_register', 'compliance_obligations', 'compliance_obligation_completions']
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      execute format($pol$
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
      $pol$, t || '_tenant_scope', t);
    end if;
  end loop;
end $$;

create index if not exists idx_legal_register_tenant on public.legal_register (tenant_id);
create index if not exists idx_compliance_obligations_tenant on public.compliance_obligations (tenant_id);

notify pgrst, 'reload schema';

commit;
