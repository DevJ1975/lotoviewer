-- Migration 129: near_miss_ai_insights — AI-authored triage card per row.
--
-- The /near-miss/[id] detail page shows admins themes (top keywords),
-- escalation-risk score (low/medium/high), and a one-line rationale
-- the model derived from the description + adjacent recent reports.
-- This is read-only acceleration; the admin still confirms escalation
-- via the existing escalate flow.
--
-- One row per near-miss. Classifier route upserts with model + a
-- generated_at stamp; UI auto-fetches on first view, then renders the
-- cached row until an admin clicks Regenerate (?force=1).

begin;

create table if not exists public.near_miss_ai_insights (
  near_miss_id    uuid primary key references public.near_misses(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  themes          text[] not null default '{}',
  escalation_risk text not null check (escalation_risk in ('low','medium','high')),
  rationale       text,
  model           text not null,
  generated_at    timestamptz not null default now()
);

create index if not exists idx_near_miss_ai_insights_tenant_recent
  on public.near_miss_ai_insights (tenant_id, generated_at desc);

comment on table public.near_miss_ai_insights is
  'AI triage card per near-miss. Read-only — admin still confirms escalation. Upserted by /api/near-miss/[id]/classify; cached for 7 days unless ?force=1.';

-- ──────────────────────────────────────────────────────────────────────
-- RLS — tenant members read their own; service role (the route) writes.
-- ──────────────────────────────────────────────────────────────────────
alter table public.near_miss_ai_insights enable row level security;

drop policy if exists "near_miss_ai_insights_tenant_member_read" on public.near_miss_ai_insights;
create policy "near_miss_ai_insights_tenant_member_read"
  on public.near_miss_ai_insights for select to authenticated
  using (
    exists (
      select 1 from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = near_miss_ai_insights.tenant_id
    )
    or public.is_superadmin()
  );

-- No insert / update / delete policies — writes flow through service role
-- in the classify route. Admin role enforcement happens at the route's
-- requireTenantAdmin gate.

notify pgrst, 'reload schema';

commit;
