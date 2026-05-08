-- Migration 087: Dedicated audit log for QR-token CRUD.
--
-- Plan phase 4c. The existing incident_audit_log captures changes
-- to incidents themselves; admin actions on the tokens (create,
-- enable/disable, label change, delete) leave only the row's own
-- created_by / updated_by fields, which is insufficient for
-- regulatory review of who controlled the anonymous-reporting
-- channel and when.
--
-- Kept separate from incident_audit_log: that table's queries are
-- shaped around an incident_id, and shoehorning token events with
-- nullable subject columns makes those queries gnarlier.

begin;

create table if not exists public.qr_token_audit_log (
  id           bigserial primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  token_id     uuid not null,

  event_type   text not null check (event_type in (
    'create', 'update', 'enable', 'disable', 'delete',
    'rotate', 'config_geofence', 'config_captcha'
  )),

  -- Snapshot of the row before the change (null on create) and
  -- after (null on delete). Stored as jsonb so adding columns to
  -- incident_anon_intake_tokens later doesn't break this table.
  before_row   jsonb,
  after_row    jsonb,

  actor_id     uuid references auth.users(id),
  actor_email  text,

  -- Free-form context. Used for "rotated because reporter complained
  -- the QR was tampered with" or similar admin notes.
  context      text,

  occurred_at  timestamptz not null default now()
);

create index if not exists idx_qr_token_audit_token
  on public.qr_token_audit_log(token_id, occurred_at desc);

create index if not exists idx_qr_token_audit_tenant
  on public.qr_token_audit_log(tenant_id, occurred_at desc);

-- Immutable: once written, audit rows are read-only. UPDATE and
-- DELETE are revoked from authenticated and anon roles. Service
-- role retains DELETE for the unlikely case of a tenant-deletion
-- cleanup, but never UPDATE.
alter table public.qr_token_audit_log enable row level security;

drop policy if exists qr_token_audit_read on public.qr_token_audit_log;
create policy qr_token_audit_read on public.qr_token_audit_log
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

revoke update on public.qr_token_audit_log from authenticated, anon;
revoke delete on public.qr_token_audit_log from authenticated, anon;

notify pgrst, 'reload schema';

commit;
