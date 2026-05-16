-- Migration 155: AI-assisted severity-prediction audit log.
--
-- A reporter's initial severity classification is often wrong on
-- two ends:
--   * Under-classification because the reporter is downplaying.
--   * Under-classification because the reporter doesn't yet know
--     the full impact (delayed-care injuries, missed days that
--     hadn't surfaced when the report was filed).
--
-- Running a model over the description after intake and asking
-- "should this have been called a higher severity?" surfaces the
-- under-classified cases. We log every invocation so:
--   1. Operators can audit token spend per tenant (joins to
--      ai_invocations via the same model + prompt_version).
--   2. We can A/B prompt revisions against historical incidents.
--   3. The UI shows the latest prediction without re-calling the
--      model.
--
-- The prediction is advisory — nothing in this migration auto-edits
-- severity_actual. The incident detail page surfaces it as a banner
-- when shouldEscalate() is true.
--
-- Idempotent.

begin;

create table if not exists public.incident_predictions (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,
  incident_id          uuid        not null references public.incidents(id) on delete cascade,
  -- One of the incident severity_actual values plus 'catastrophic'.
  -- Stored as text so a future severity-axis change doesn't require
  -- a column migration.
  predicted_severity   text        not null check (predicted_severity in (
    'catastrophic','fatality','lost_time','medical','first_aid','none')),
  -- Numeric in [0,1]. Constraint enforces the range so a model that
  -- returns 1.5 fails at insert.
  confidence           numeric     not null
                         check (confidence >= 0 and confidence <= 1),
  -- The exact Claude model id the prediction came from
  -- (e.g. 'claude-haiku-4-5'). Joins with the ai_invocations log via
  -- ai_invocations.model.
  model                text        not null check (length(btrim(model)) > 0),
  -- Versioned prompt identifier so prompt revisions are auditable.
  -- Free-form short string ('v1', 'v2-stricter', etc.).
  prompt_version       text        not null check (length(btrim(prompt_version)) > 0),
  predicted_at         timestamptz not null default now(),
  -- Full Anthropic response payload — we keep it for A/B
  -- experimentation. JSONB so future fields don't need a column.
  raw_response         jsonb       not null default '{}'::jsonb
);

create index if not exists idx_incident_predictions_incident
  on public.incident_predictions(incident_id, predicted_at desc);

create index if not exists idx_incident_predictions_tenant_severity
  on public.incident_predictions(tenant_id, predicted_severity, predicted_at desc);

comment on table public.incident_predictions is
  'AI-assisted severity-escalation predictions. Advisory only — no auto-mutation of severity_actual. One row per /api/incidents/[id]/predict-escalation invocation.';

alter table public.incident_predictions enable row level security;

drop policy if exists "incident_predictions_tenant_scope"
  on public.incident_predictions;
create policy "incident_predictions_tenant_scope"
  on public.incident_predictions
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_audit_incident_predictions on public.incident_predictions;
create trigger trg_audit_incident_predictions
  after insert or update or delete on public.incident_predictions
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
