-- Migration 035: Public LOTO placard review portal.
--
-- Two new tables for the tokenized, no-account "client review of completed
-- LOTO placards" flow:
--
--   loto_review_links     — one row per "send a department for review"
--                           email. Holds the 32-hex token, reviewer
--                           identity, expiry, and the eventual signoff
--                           payload (typed name + drawn signature data
--                           URL + approve/needs-changes + overall notes).
--   loto_placard_reviews  — one row per equipment within a review_link
--                           batch where the reviewer left a note or
--                           marked a per-placard status. Optional;
--                           absence = no per-placard comment.
--
-- Token pattern mirrors migration 024 (next_signon_token + BEFORE INSERT
-- trigger). 32 lowercase hex chars (16 random bytes), populated by the
-- DB so callers never see a NULL token. Public lookups go via the
-- service-role API at /api/review/[token]; admin lookups use the
-- tenant-scoped RLS policy below (same predicate as migration 032).
--
-- Idempotent. Re-running is a no-op.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. loto_review_links
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.loto_review_links (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null references public.tenants(id) on delete cascade,
  department        text        not null,
  -- 32 hex chars, populated by trigger (see §3 below). Never null at
  -- the application layer; the column allows null only so the trigger
  -- can run on NEW.token IS NULL inserts. The format check + unique
  -- index enforce the real shape.
  token             text,
  reviewer_name     text        not null,
  reviewer_email    text        not null,

  -- Email channel + delivery tracking. Set when the API queues the
  -- Resend send. provider_id stores the Resend message id so support
  -- can grep deliverability logs by it.
  sent_at           timestamptz,
  email_provider_id text,
  -- Free-form message-to-reviewer entered by the admin in the Send
  -- modal (e.g. "Tony — please look at the new fryers especially").
  -- Rendered in a quoted block in the email body.
  admin_message     text,

  -- Reviewer-side state.
  first_viewed_at   timestamptz,
  signed_off_at     timestamptz,
  -- true = approved, false = needs changes, null = not yet signed.
  signoff_approved  boolean,
  -- PNG data URL captured by <SignaturePad>. Kept as text so it ships
  -- inline with the row — the typed name + signature are an atomic
  -- attestation; storing the image elsewhere would let one half drift.
  signoff_signature text,
  signoff_typed_name text,
  signoff_notes     text,
  -- Reviewer's IP + user agent at signoff time. Belt-and-suspenders
  -- for the repudiation defense outlined in the design doc.
  signoff_ip        text,
  signoff_user_agent text,

  -- Lifecycle.
  expires_at        timestamptz not null default (now() + interval '30 days'),
  revoked_at        timestamptz,
  revoked_by        uuid        references auth.users(id),

  created_at        timestamptz not null default now(),
  created_by        uuid        not null references auth.users(id)
);

-- Token format guard. Allows NULL only on the BEFORE INSERT path
-- because the trigger fills it in before the row hits storage.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'loto_review_links_token_format'
  ) then
    alter table public.loto_review_links
      add constraint loto_review_links_token_format
      check (token is null or token ~ '^[0-9a-f]{32}$');
  end if;
end $$;

create unique index if not exists idx_loto_review_links_token
  on public.loto_review_links(token)
  where token is not null;

create index if not exists idx_loto_review_links_tenant_dept
  on public.loto_review_links(tenant_id, department)
  where revoked_at is null;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. loto_placard_reviews
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.loto_placard_reviews (
  id              uuid        primary key default gen_random_uuid(),
  review_link_id  uuid        not null references public.loto_review_links(id) on delete cascade,
  -- Not an FK because equipment_id is a tenant-scoped string, not a UUID.
  -- The review_link_id pin already enforces tenant scoping transitively.
  equipment_id    text        not null,
  status          text        not null check (status in ('approved','needs_changes')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (review_link_id, equipment_id)
);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Token generator + BEFORE INSERT trigger
-- ──────────────────────────────────────────────────────────────────────────
--
-- Reuses migration 024's next_signon_token() — same 16-random-bytes-as-hex
-- shape, with the same pgcrypto-or-fallback path. We don't define a new
-- generator, just a new trigger that calls the existing function on this
-- table.

create or replace function public.set_review_link_token()
  returns trigger
  language plpgsql
as $$
begin
  if new.token is null then
    new.token := public.next_signon_token();
  end if;
  return new;
end $$;

drop trigger if exists trg_loto_review_links_set_token on public.loto_review_links;
create trigger trg_loto_review_links_set_token
  before insert on public.loto_review_links
  for each row
  execute function public.set_review_link_token();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. updated_at trigger on loto_placard_reviews
-- ──────────────────────────────────────────────────────────────────────────
--
-- Mirrors the convention from earlier migrations: any table with both
-- created_at + updated_at gets a BEFORE UPDATE trigger to bump
-- updated_at. Keeps audit timestamps honest without app-layer code.

create or replace function public.touch_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_loto_placard_reviews_touch on public.loto_placard_reviews;
create trigger trg_loto_placard_reviews_touch
  before update on public.loto_placard_reviews
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 5. RLS — admin tenant-scoped read, service-role inserts via API
-- ──────────────────────────────────────────────────────────────────────────
--
-- loto_review_links: same tenant-scoped policy shape as migration 032
-- applies to every other domain table. The active-tenant header check
-- gives superadmins per-tenant scoping; the membership check enforces
-- the baseline access rule.
--
-- loto_placard_reviews: same predicate applied transitively via the
-- review_link_id → loto_review_links join. Service role bypasses both
-- (Supabase service-role JWT skips RLS), which is what the public
-- /api/review/[token] route uses to insert reviewer rows.

alter table public.loto_review_links     enable row level security;
alter table public.loto_placard_reviews  enable row level security;

drop policy if exists loto_review_links_tenant_scope on public.loto_review_links;
create policy loto_review_links_tenant_scope on public.loto_review_links
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

drop policy if exists loto_placard_reviews_tenant_scope on public.loto_placard_reviews;
create policy loto_placard_reviews_tenant_scope on public.loto_placard_reviews
  for all to authenticated
  using (
    review_link_id in (
      select id from public.loto_review_links
       where (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
         and (
           tenant_id in (select public.current_user_tenant_ids())
           or public.is_superadmin()
         )
    )
  )
  with check (
    review_link_id in (
      select id from public.loto_review_links
       where (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
         and (
           tenant_id in (select public.current_user_tenant_ids())
           or public.is_superadmin()
         )
    )
  );

-- Reload PostgREST schema so the new tables show up immediately.
notify pgrst, 'reload schema';

commit;
