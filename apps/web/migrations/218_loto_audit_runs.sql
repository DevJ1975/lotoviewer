-- Migration 218: LOTO multi-agent audit — run, per-equipment results, and the
-- staged proposed-change-set, plus the audit review-link binding.
--
-- An audit RUN sweeps a tenant's equipment; for each one the FPE → DS → EHS
-- agents write a result row, and any fix they propose lands in
-- loto_audit_changes as a STAGED row (status='pending'). Nothing here touches
-- loto_equipment / loto_energy_steps — the only writer is the apply RPC in
-- migration 219, and it acts solely on rows a human has approved through the
-- review link. The review link is the gate: no approval ⇒ no write.
--
-- We reuse the existing loto_review_links portal (migration 035/134/215) by
-- tagging a link with kind='audit' and binding it to a run, rather than
-- standing up a parallel link subsystem.
--
-- RLS mirrors migration 134: tenant members read their tenant's rows; all
-- mutations flow through the service-role engine/admin API. log_audit('id')
-- triggers (migration 003) capture every insert/update/delete.

begin;

-- ── Audit run ──────────────────────────────────────────────────────────────
create table if not exists public.loto_audit_runs (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references public.tenants(id) on delete cascade,
  status              text        not null default 'running'
    check (status in ('running', 'awaiting_review', 'partially_applied', 'applied', 'failed', 'cancelled')),
  -- {department?, equipment_ids?: string[], only_active?: boolean, limit?: number}
  scope               jsonb       not null default '{}'::jsonb,
  total_equipment     integer     not null default 0,
  processed_equipment integer     not null default 0,
  -- The model id actually used per agent surface (alias-pinning audit trail).
  models              jsonb,
  -- The audit review link minted for this run (kind='audit'). Set when the run
  -- finishes processing and is ready for human review.
  review_link_id      uuid        references public.loto_review_links(id) on delete set null,
  created_by          uuid,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  error               text
);

create index if not exists idx_loto_audit_runs_tenant
  on public.loto_audit_runs (tenant_id, started_at desc);

-- ── Per-equipment results (one row per equipment per run) ───────────────────
-- unique(run_id, equipment_id) + agent_phase make a run RESUMABLE: re-running
-- skips equipment already at agent_phase='ehs_done'.
create table if not exists public.loto_audit_equipment_results (
  id                       uuid        primary key default gen_random_uuid(),
  run_id                   uuid        not null references public.loto_audit_runs(id) on delete cascade,
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  equipment_id             text        not null,
  -- Food-Production-Engineer (vision)
  equip_photo_verdict      text        check (equip_photo_verdict is null or equip_photo_verdict in ('match', 'mismatch', 'low_confidence', 'missing')),
  equip_photo_confidence   text        check (equip_photo_confidence is null or equip_photo_confidence in ('high', 'medium', 'low')),
  iso_photo_verdict        text        check (iso_photo_verdict is null or iso_photo_verdict in ('match', 'mismatch', 'low_confidence', 'missing')),
  iso_photo_confidence     text        check (iso_photo_confidence is null or iso_photo_confidence in ('high', 'medium', 'low')),
  fpe_notes                text,
  -- Data-Scientist (consistency)
  ds_equipment_confidence  text        check (ds_equipment_confidence is null or ds_equipment_confidence in ('high', 'medium', 'low')),
  ds_consistency           jsonb,      -- {missing_phases:[], duplicates:[], outliers:[], low_confidence_iso:bool}
  ds_notes                 text,
  -- Senior EHS Specialist (Cal/OSHA gate)
  ehs_pass                 boolean,
  ehs_citations            jsonb,      -- [{code, text, severity}]
  ehs_recommendations      jsonb,
  ehs_notes                text,
  -- Bookkeeping
  agent_phase              text        not null default 'pending'
    check (agent_phase in ('pending', 'fpe_done', 'ds_done', 'ehs_done', 'error')),
  raw_payload              jsonb,      -- full model outputs, for reproducibility
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (run_id, equipment_id)
);

create index if not exists idx_loto_audit_results_run
  on public.loto_audit_equipment_results (run_id, equipment_id);

-- ── Proposed change-set (the staging table) ─────────────────────────────────
-- One row per proposed fix. old_value/new_value are jsonb so a text-field edit,
-- a confidence write, a provenance flip, and a placeholder-photo attach all
-- share one shape. Nothing is applied until status flips to 'approved' (via the
-- review link) and the apply RPC (migration 219) runs.
create table if not exists public.loto_audit_changes (
  id                  uuid        primary key default gen_random_uuid(),
  run_id              uuid        not null references public.loto_audit_runs(id) on delete cascade,
  tenant_id           uuid        not null references public.tenants(id) on delete cascade,
  equipment_id        text        not null,
  change_kind         text        not null check (change_kind in (
                        'step_field_edit',      -- a loto_energy_steps text field
                        'step_confidence',      -- write confidence onto a step
                        'equipment_field_edit', -- a loto_equipment scalar
                        'photo_provenance',     -- mark a photo placeholder/provenance
                        'placeholder_photo',    -- attach a watermarked reference image
                        'ehs_finding')),        -- non-mutating citation record
  target_table        text        not null check (target_table in ('loto_energy_steps', 'loto_equipment')),
  target_row_pk       text,       -- step id (uuid as text) or equipment_id
  target_column       text,       -- e.g. 'isolation_procedure', 'iso_photo_url', 'confidence'
  old_value           jsonb,
  new_value           jsonb,
  agent               text        not null check (agent in ('FPE', 'DS', 'EHS', 'SSD')),
  rationale           text        not null,
  severity            text        check (severity is null or severity in ('info', 'low', 'medium', 'high', 'critical')),
  status              text        not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'applied', 'superseded')),
  -- Staged placeholder image (change_kind='placeholder_photo').
  staged_storage_path text,
  staged_photo_url    text,
  -- Decision + apply bookkeeping.
  decided_by          text,
  decided_at          timestamptz,
  decided_note        text,       -- reviewer's reason on approve/reject
  applied_at          timestamptz,
  apply_error         text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_loto_audit_changes_run_status
  on public.loto_audit_changes (run_id, status);
create index if not exists idx_loto_audit_changes_run_equipment
  on public.loto_audit_changes (run_id, equipment_id);
-- One live proposal per target field per run. ehs_finding / null-target rows
-- have null target_row_pk so the unique index (nulls distinct) lets many coexist.
create unique index if not exists uq_loto_audit_changes_pending_target
  on public.loto_audit_changes (run_id, target_table, target_row_pk, target_column)
  where status = 'pending';

-- ── Audit review-link binding ───────────────────────────────────────────────
-- An audit link is kind='audit', is_public=false, audit_run_id set. The
-- floor-walk links keep the default kind='placard_walk', so both flows coexist
-- on the same loto_review_links table + token infrastructure.
alter table public.loto_review_links
  add column if not exists audit_run_id uuid references public.loto_audit_runs(id) on delete set null,
  add column if not exists kind text not null default 'placard_walk'
    check (kind in ('placard_walk', 'audit'));

-- ── RLS (tenant scope — mirrors migration 134) ──────────────────────────────
alter table public.loto_audit_runs                enable row level security;
alter table public.loto_audit_equipment_results   enable row level security;
alter table public.loto_audit_changes             enable row level security;

drop policy if exists loto_audit_runs_tenant_scope on public.loto_audit_runs;
create policy loto_audit_runs_tenant_scope on public.loto_audit_runs
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists loto_audit_results_tenant_scope on public.loto_audit_equipment_results;
create policy loto_audit_results_tenant_scope on public.loto_audit_equipment_results
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists loto_audit_changes_tenant_scope on public.loto_audit_changes;
create policy loto_audit_changes_tenant_scope on public.loto_audit_changes
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ── Audit-log triggers (reuse log_audit, migration 003) ─────────────────────
drop trigger if exists trg_audit_loto_audit_runs on public.loto_audit_runs;
create trigger trg_audit_loto_audit_runs
  after insert or update or delete on public.loto_audit_runs
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_loto_audit_changes on public.loto_audit_changes;
create trigger trg_audit_loto_audit_changes
  after insert or update or delete on public.loto_audit_changes
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
