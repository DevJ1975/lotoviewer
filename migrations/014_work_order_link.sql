-- Migration 014: Work-order linkage on permits + a single-row org config
-- table for the URL template that turns a free-text WO ref into a real
-- hyperlink.
--
-- Why: the recurring jab against every LOTO software comparison is "the
-- procedure lives in one tool, the work order lives in another." Even a
-- one-line text field on the permit + a configurable URL template is
-- enough to glue most SMB-scale workflows. The hard version (real CMMS
-- API integration) can come later — this slice is the cheap-and-correct
-- version that already covers 80% of the ask.
--
-- Idempotent. Drops nothing.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. work_order_ref on permits — free-text reference to the upstream
--    CMMS / WO system.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_confined_space_permits
  add column if not exists work_order_ref text;

comment on column public.loto_confined_space_permits.work_order_ref is
  'Free-text reference to a work order in the customer''s CMMS (MaintainX, eMaint, etc.). Rendered as a hyperlink when loto_org_config.work_order_url_template is set.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. loto_org_config — single-row organisation-level config table.
--    First user: work_order_url_template. Future keys go here too rather
--    than scattering through the codebase.
-- ────────────────────────────────────────────────────────────────────────────
-- Singleton via a CHECK constraint on id = 1. Cheaper than a separate
-- "tenant_id" column at this stage; when multi-tenant lands the column
-- gets added and this row becomes "tenant 1." No migration churn for
-- existing config keys at that point.
create table if not exists public.loto_org_config (
  id                       integer primary key check (id = 1),
  -- Template that turns a work_order_ref into a clickable URL. Use {ref}
  -- as the placeholder, percent-encoded at format time. Examples:
  --   'https://maintainx.com/wo/{ref}'
  --   'https://acme.fiixsoftware.com/work-orders?id={ref}'
  -- Null means "no template" — work_order_ref renders as plain text.
  work_order_url_template  text,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.profiles(id) on delete set null
);

-- Bootstrap the singleton row so the app's UPDATE never has to think
-- about "does the row exist." Idempotent via on conflict do nothing.
insert into public.loto_org_config (id) values (1)
  on conflict (id) do nothing;

comment on table public.loto_org_config is
  'Single-row org-level configuration. Singleton enforced by CHECK (id = 1). Future tenant_id column lands here when multi-tenant enters scope.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS — read open to authenticated; write admin-only. The work-order
--    URL template is non-sensitive (it''s a URL pattern, not a secret),
--    but writes can change every permit''s rendered link so we gate them.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_org_config enable row level security;

drop policy if exists "loto_org_config_authenticated_read" on public.loto_org_config;
create policy "loto_org_config_authenticated_read" on public.loto_org_config
  for select using (auth.uid() is not null);

drop policy if exists "loto_org_config_admin_write" on public.loto_org_config;
create policy "loto_org_config_admin_write" on public.loto_org_config
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- Audit trigger so config edits show up on /admin/audit alongside
-- everything else.
drop trigger if exists trg_audit_loto_org_config on public.loto_org_config;
create trigger trg_audit_loto_org_config
  after insert or update or delete on public.loto_org_config
  for each row execute function public.log_audit('id');
