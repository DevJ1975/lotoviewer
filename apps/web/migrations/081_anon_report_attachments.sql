-- Migration 081: Photo + voice-memo attachments for anonymous reports.
--
-- Reporter UX upgrade (plan phase 2b). The /report/[token] form
-- gains an "Add photos / voice note" affordance; uploads go to the
-- existing loto-photos bucket under
--   <tenant_uuid>/anonymous-reports/<incident_id>/<seq>_<ts>.<ext>
-- which sits inside the tenant-scoped storage RLS pattern from
-- migration 033.
--
-- Two-step submit: the public POST creates the incident and returns
-- a short-lived signed JWT scoped to the report's storage prefix.
-- The browser uploads each file directly to Supabase Storage. On
-- success, the browser POSTs back to /api/anonymous-report/attach
-- to record the storage_path in this table.
--
-- Service role inserts here, never the anonymous client. Tenant
-- members read attachments for incidents they can already see.

begin;

create table if not exists public.incident_attachments (
  id            uuid not null primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  incident_id   uuid not null references public.incidents(id) on delete cascade,

  -- The path inside the loto-photos bucket. Tenant-prefixed by
  -- convention (see migration 033 for the storage RLS rule).
  storage_path  text not null,

  -- Mime is recorded so the gallery UI can switch <img> vs <audio>
  -- without sniffing. Allowed at write time:
  --   image/jpeg, image/png, image/webp, image/heic
  --   audio/webm, audio/mp4, audio/ogg
  mime          text not null,

  byte_size     int  not null check (byte_size > 0 and byte_size <= 10 * 1024 * 1024),

  -- Caption is optional; the public form doesn't currently collect
  -- one but a triage admin may add one later.
  caption       text,

  created_at    timestamptz not null default now()
);

create index if not exists idx_incident_attachments_incident
  on public.incident_attachments(incident_id);
create index if not exists idx_incident_attachments_tenant
  on public.incident_attachments(tenant_id, created_at desc);

alter table public.incident_attachments enable row level security;

-- Read: any tenant member with access to the parent incident. The
-- existing incident RLS already gates on tenant; piggy-back on that
-- by checking the same predicate here.
drop policy if exists incident_attachments_read on public.incident_attachments;
create policy incident_attachments_read on public.incident_attachments
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- Write: service role only. Public uploads come through the
-- two-step submit flow which validates the upload token server-side.
-- No anon or authenticated INSERT/UPDATE/DELETE policy defined, so
-- those clients are denied by default.

notify pgrst, 'reload schema';

commit;
