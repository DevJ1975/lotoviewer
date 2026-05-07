-- Migration 066: Incident notifications — fan-out rules + sent log.
--
-- Two tables:
--   incident_notification_rules   per-tenant configurable rules; "if
--                                 incident_type=injury_illness AND
--                                 severity_actual ∈ {lost_time,fatality}
--                                 → notify owner+admin via email+push
--                                 with 60-min escalation window".
--   incident_notifications        immutable log of every send attempt.
--                                 Surfaces in the per-incident
--                                 notifications tab so investigators
--                                 can audit who-knew-what-when.
--
-- The rules engine itself is pure code in
-- packages/core/src/incidentNotificationRules.ts — these tables just
-- store the inputs (rules) and outputs (sends). Cron + the on-create
-- handler in /api/incidents POST evaluate rules against new/changed
-- incidents and dispatch via the existing email + web-push infra.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. incident_notification_rules — per-tenant configuration.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.incident_notification_rules (
  id                       uuid not null primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  name                     text not null,
  enabled                  boolean not null default true,

  -- ── Match criteria (all conditions ANDed; null = "any") ───────────────
  match_incident_type      text[] check (match_incident_type is null or match_incident_type <@
    array['injury_illness','near_miss','property_damage','environmental']::text[]),
  match_severity_actual    text[] check (match_severity_actual is null or match_severity_actual <@
    array['none','first_aid','medical','lost_time','fatality','catastrophic']::text[]),
  match_severity_potential text[] check (match_severity_potential is null or match_severity_potential <@
    array['low','moderate','high','extreme']::text[]),
  -- nullable boolean: null = match either, true = recordable only,
  -- false = non-recordable only.
  match_recordable         boolean,

  -- ── Recipients (any combination ORed together) ────────────────────────
  notify_roles             text[] check (notify_roles is null or notify_roles <@
    array['owner','admin','member','viewer']::text[]),
  notify_user_ids          uuid[],
  notify_emails            text[],

  -- ── Channels ──────────────────────────────────────────────────────────
  channels                 text[] not null default array['email','push']::text[]
    check (channels <@ array['email','push','sms']::text[]),

  -- ── Escalation ────────────────────────────────────────────────────────
  -- If the incident has not transitioned to status='investigating'
  -- within escalation_minutes, the cron job re-fires the rule against
  -- the escalation recipients. NULL = no escalation.
  escalation_minutes       int check (escalation_minutes is null or escalation_minutes > 0),

  description              text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id),
  updated_by               uuid references auth.users(id)
);

create index if not exists idx_incident_notif_rules_tenant
  on public.incident_notification_rules(tenant_id) where enabled = true;

drop trigger if exists trg_incident_notif_rules_touch on public.incident_notification_rules;
create trigger trg_incident_notif_rules_touch
  before update on public.incident_notification_rules
  for each row
  execute function public.touch_updated_at();

alter table public.incident_notification_rules enable row level security;

drop policy if exists incident_notif_rules_tenant_scope on public.incident_notification_rules;
create policy incident_notif_rules_tenant_scope on public.incident_notification_rules
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. incident_notifications — append-only send log.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.incident_notifications (
  id                       bigserial primary key,
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  incident_id              uuid not null references public.incidents(id) on delete cascade,
  -- Which rule fired this notification. NULL for manual sends from
  -- the per-incident "notify now" button.
  rule_id                  uuid references public.incident_notification_rules(id) on delete set null,
  -- 'initial' = first fire, 'escalation' = re-fire after timeout, 'manual' = button.
  trigger_type             text not null default 'initial' check (trigger_type in (
    'initial','escalation','manual')),

  channel                  text not null check (channel in ('email','push','sms')),
  recipient_user_id        uuid references auth.users(id),
  recipient_email          text,
  recipient_phone          text,

  status                   text not null check (status in ('sent','failed','skipped')),
  provider_id              text,                   -- Resend/web-push message id
  error_text               text,

  sent_at                  timestamptz not null default now()
);

create index if not exists idx_incident_notifications_incident
  on public.incident_notifications(incident_id, sent_at desc);
create index if not exists idx_incident_notifications_tenant
  on public.incident_notifications(tenant_id, sent_at desc);

revoke update, delete on public.incident_notifications from public;
revoke update, delete on public.incident_notifications from authenticated;
revoke update, delete on public.incident_notifications from anon;

create or replace function public.incident_notifications_immutable()
  returns trigger
  language plpgsql
as $$
begin
  raise exception 'incident_notifications is append-only (tg_op=% on row id=%)', tg_op, coalesce(old.id, new.id)
    using errcode = 'integrity_constraint_violation';
end $$;

drop trigger if exists trg_incident_notifications_immutable on public.incident_notifications;
create trigger trg_incident_notifications_immutable
  before update or delete on public.incident_notifications
  for each row
  execute function public.incident_notifications_immutable();

alter table public.incident_notifications enable row level security;

drop policy if exists incident_notifications_tenant_select on public.incident_notifications;
create policy incident_notifications_tenant_select on public.incident_notifications
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

drop policy if exists incident_notifications_tenant_insert on public.incident_notifications;
create policy incident_notifications_tenant_insert on public.incident_notifications
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

grant insert, select on public.incident_notifications to authenticated;
grant usage, select on sequence public.incident_notifications_id_seq to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Default rules — seeded once per tenant on first activation of the
--    incidents module. We don't seed all existing tenants here because
--    not every tenant has the module enabled; the activation handler
--    in the tenant module-toggle UI calls a small RPC (added in a
--    later migration) that seeds the defaults for that tenant.
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.seed_incident_notification_defaults(p_tenant_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- Idempotent: skip if any rule already exists for the tenant.
  if exists (select 1 from public.incident_notification_rules where tenant_id = p_tenant_id) then
    return;
  end if;

  insert into public.incident_notification_rules
    (tenant_id, name, match_incident_type, match_severity_actual, notify_roles, channels, escalation_minutes, description)
  values
    (p_tenant_id, 'Serious injury → leadership',
     null,
     array['lost_time','fatality','catastrophic']::text[],
     array['owner','admin']::text[],
     array['email','push']::text[],
     60,
     'Notifies tenant owners + admins on any lost-time, fatal, or catastrophic event. Escalates if no investigation begun within 60 minutes.'),
    (p_tenant_id, 'Environmental spill → coordinator',
     array['environmental']::text[],
     null,
     array['admin']::text[],
     array['email']::text[],
     null,
     'Emails admins for any environmental incident regardless of severity — drives the regulatory threshold check workflow.'),
    (p_tenant_id, 'Near-miss digest',
     array['near_miss']::text[],
     null,
     array['admin']::text[],
     array['email']::text[],
     null,
     'Notifies admins on every near-miss for trend awareness. The weekly digest cron rolls these up; this rule covers the immediate "we filed one" signal.');
end $$;

notify pgrst, 'reload schema';

commit;
