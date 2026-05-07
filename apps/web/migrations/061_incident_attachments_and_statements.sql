-- Migration 061: Incident evidence — photo/video attachments + tokenized
-- witness statement collection.
--
-- Storage backend: a new Supabase Storage bucket `incident-evidence`
-- with path prefix `{tenant_id}/{incident_id}/{filename}`. Bucket
-- creation is handled via supabase init / dashboard — this migration
-- only adds the metadata table that points at the bucket, mirroring
-- how loto-photos was modeled.
--
-- Witness statements use a tokenized public-link pattern (mirrors
-- the LOTO client review portal in migration 022): an admin generates
-- a single-use token, emails it to a contractor / visitor witness who
-- has no Soteria account, and the public submission endpoint at
-- /api/witness/[token]/submit verifies the token + persists the
-- statement without authenticating the witness.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. incident_attachments — photos, videos, documents.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.incident_attachments (
  id                       uuid not null primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  incident_id              uuid not null references public.incidents(id) on delete cascade,

  -- Storage path within the `incident-evidence` bucket.
  -- Format: `{tenant_id}/{incident_id}/{uuid}.{ext}`
  storage_path             text not null,
  mime_type                text,
  file_size_bytes          int,

  -- EXIF / GPS captured client-side at upload time. Forensic value:
  -- locks down original timestamp + camera + GPS so a litigation-time
  -- challenge can prove the photo wasn't fabricated.
  exif_json                jsonb,

  caption                  text,

  uploaded_by              uuid references auth.users(id),
  uploaded_at              timestamptz not null default now()
);

create index if not exists idx_incident_attachments_incident
  on public.incident_attachments(incident_id, uploaded_at desc);
create index if not exists idx_incident_attachments_tenant
  on public.incident_attachments(tenant_id);

alter table public.incident_attachments enable row level security;

drop policy if exists incident_attachments_tenant_scope on public.incident_attachments;
create policy incident_attachments_tenant_scope on public.incident_attachments
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
-- 2. incident_witness_statements — long-form statements + tokenized
--    collection links for non-Soteria witnesses.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.incident_witness_statements (
  id                       uuid not null primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  incident_id              uuid not null references public.incidents(id) on delete cascade,
  -- Optional link back to the witness's incident_people row. Statements
  -- can also be filed without a person row (anonymous witness via QR
  -- code) — the join is informational, not required.
  witness_person_id        uuid references public.incident_people(id) on delete set null,

  -- The statement itself.
  statement_text           text,

  collected_via            text not null check (collected_via in (
    'in_person','email_link','phone','sms')),
  collected_at             timestamptz,
  collected_by             uuid references auth.users(id),

  -- ── Tokenized email/SMS collection ──────────────────────────────────
  -- When collected_via='email_link' or 'sms', an admin generates a
  -- single-use token and emails/texts the witness. The public
  -- /witness/[token] page accepts their statement and locks the token.
  collection_token         text unique,
  token_expires_at         timestamptz,
  token_consumed_at        timestamptz,

  -- ── Submission audit ────────────────────────────────────────────────
  signed_at                timestamptz,            -- when the witness submitted
  signed_name              text,                   -- name they typed on submit
  ip_address               inet,
  user_agent               text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_incident_witness_statements_incident
  on public.incident_witness_statements(incident_id, created_at desc);
create index if not exists idx_incident_witness_statements_tenant
  on public.incident_witness_statements(tenant_id);
create index if not exists idx_incident_witness_statements_token
  on public.incident_witness_statements(collection_token)
  where collection_token is not null and token_consumed_at is null;

drop trigger if exists trg_incident_witness_statements_touch on public.incident_witness_statements;
create trigger trg_incident_witness_statements_touch
  before update on public.incident_witness_statements
  for each row
  execute function public.touch_updated_at();

alter table public.incident_witness_statements enable row level security;

drop policy if exists incident_witness_statements_tenant_scope on public.incident_witness_statements;
create policy incident_witness_statements_tenant_scope on public.incident_witness_statements
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

-- The public submission endpoint (/api/witness/[token]/submit) uses
-- supabaseAdmin (RLS-bypassing) — by design, the witness has no JWT.
-- All security rests on the token: 32+ chars of randomness +
-- token_expires_at + single-use enforcement (token_consumed_at).
-- No public-anon RLS policy is added; we deliberately keep the
-- table unreachable from anon clients.

notify pgrst, 'reload schema';

commit;
