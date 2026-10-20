-- Migration 301: STRIKE assisted (ADA) delivery and certificate signatory.
--
-- Assisted delivery is for workers who can't read or write: they watch the
-- narrated scenes only, and a supervisor verifies their understanding in
-- person, ticks a checklist and signs on the same device. That signed record
-- is the completion's evidence instead of a quiz score.
--
--   strike_attempts.delivery          'standard' or 'assisted'; an open
--                                     attempt is only resumed in its own mode.
--   strike_assisted_verifications     one signed verification per attempt.
--                                     The checklist and acknowledgment are
--                                     stored as the server built them, so the
--                                     record says exactly what was signed.
--                                     Written only by the service role.
--   strike_certificate_signatory      the platform's certificate signer:
--                                     name, title and a drawn signature,
--                                     stamped on every completion
--                                     certificate. One row; superadmin API
--                                     only.
--
--   strike_module_versions.title      the version's own title, for a version
--                                     in another language than the module
--                                     row (LOTO 101's Spanish version). Null
--                                     means the module's title.
--
-- Idempotent.

begin;

alter table public.strike_module_versions
  add column if not exists title text check (title is null or length(title) between 1 and 200);

alter table public.strike_attempts
  add column if not exists delivery text not null default 'standard'
    check (delivery in ('standard', 'assisted'));

create table if not exists public.strike_assisted_verifications (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  attempt_id         uuid not null unique references public.strike_attempts(id) on delete cascade,
  module_id          uuid not null references public.strike_modules(id) on delete cascade,
  module_version_id  uuid not null references public.strike_module_versions(id) on delete cascade,
  user_id            uuid references auth.users(id) on delete set null,
  member_id          uuid references public.members(id) on delete set null,
  verifier_user_id   uuid not null references auth.users(id),
  verifier_name      text not null check (length(verifier_name) between 1 and 200),
  locale             text not null check (locale in ('en', 'es')),
  checklist          jsonb not null check (jsonb_typeof(checklist) = 'array'),
  acknowledgment     text not null check (length(acknowledgment) between 1 and 2000),
  signature_png      text not null check (signature_png like 'data:image/png;base64,%' and length(signature_png) <= 200000),
  signed_at          timestamptz not null default now(),
  completion_id      uuid references public.strike_completions(id) on delete set null,

  constraint strike_assisted_verifications_learner_ck check (user_id is not null or member_id is not null)
);

create index if not exists strike_assisted_verifications_tenant_idx
  on public.strike_assisted_verifications(tenant_id, signed_at desc);

alter table public.strike_assisted_verifications enable row level security;

drop policy if exists strike_assisted_verifications_read on public.strike_assisted_verifications;
create policy strike_assisted_verifications_read on public.strike_assisted_verifications
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      user_id = auth.uid()
      or member_id in (select m.id from public.members m where m.profile_id = auth.uid())
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );

create table if not exists public.strike_certificate_signatory (
  id             boolean primary key default true check (id),
  signer_name    text not null check (length(signer_name) between 1 and 120),
  signer_title   text not null check (length(signer_title) <= 120),
  issuer         text not null check (length(issuer) between 1 and 120),
  signature_png  text not null check (signature_png like 'data:image/png;base64,%' and length(signature_png) <= 200000),
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now()
);

alter table public.strike_certificate_signatory enable row level security;
revoke all on public.strike_certificate_signatory from anon, authenticated;

notify pgrst, 'reload schema';

commit;
