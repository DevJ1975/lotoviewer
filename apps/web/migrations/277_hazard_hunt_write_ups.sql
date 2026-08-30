-- Migration 277: Hazard Hunt write-ups (Certified Safety Professional agent output).
--
-- When a hazard-hunt inspection is submitted, the in-app CSP agent reads the
-- responses + findings and drafts a structured, citation-backed write-up. This
-- table persists that output (one row per inspection) so it can be reviewed,
-- finalized, rendered on the wiki, and ingested into the knowledge base for RAG.
-- It mirrors how the LOTO audit pipeline stages agent JSON before a human
-- finalizes it — the draft is never auto-published.
--
-- Idempotent.

begin;

create table if not exists public.hazard_hunt_write_ups (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  inspection_id         uuid not null references public.inspections(id) on delete cascade,
  status                text not null default 'draft' check (status in ('draft','final')),
  -- Executive summary prose.
  summary               text,
  -- Regulatory citations: [{ code, text, severity }] — same shape the LOTO
  -- audit agents emit (apps/web/lib/loto/audit/schemas.ts).
  citations             jsonb,
  -- Ranked corrective actions: [{ item, hierarchy_level, finding_ref }].
  recommendations       jsonb,
  -- Full agent payload, kept for reproducibility / audit.
  raw_payload           jsonb,
  -- Set once the finalized write-up is ingested into the knowledge base.
  knowledge_document_id uuid references public.knowledge_documents(id) on delete set null,
  model                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (inspection_id)
);

create index if not exists idx_hazard_hunt_write_ups_tenant
  on public.hazard_hunt_write_ups(tenant_id, status, created_at desc);

-- RLS: tenant-scope (same predicate as the inspection engine, migration 193).
alter table public.hazard_hunt_write_ups enable row level security;
drop policy if exists hazard_hunt_write_ups_tenant_scope on public.hazard_hunt_write_ups;
create policy hazard_hunt_write_ups_tenant_scope on public.hazard_hunt_write_ups
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop trigger if exists trg_hazard_hunt_write_ups_touch on public.hazard_hunt_write_ups;
create trigger trg_hazard_hunt_write_ups_touch
  before update on public.hazard_hunt_write_ups
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_hazard_hunt_write_ups on public.hazard_hunt_write_ups;
create trigger trg_audit_hazard_hunt_write_ups
  after insert or update or delete on public.hazard_hunt_write_ups
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
