-- Migration 174: Posted Prop 65 warning signs.
--
-- Cal. Code Regs tit. 27 §§25602–25607 govern "clear and reasonable"
-- warnings. The actual physical sign (or its digital equivalent) is
-- the operative artifact in an enforcement action; this table holds
-- the metadata that proves "we posted it at this site on this date,
-- here's the photo, here's the text it carried".
--
-- prop65_chemical_ids is uuid[] because one sign may cover multiple
-- listed chemicals. We keep the rendered warning_text on the row so
-- changes in the warning-text helper (packages/core/src/prop65WarningText.ts)
-- don't retroactively alter what was actually posted.
--
-- Idempotent.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prop65_warning_type') then
    create type public.prop65_warning_type as enum ('long_form', 'short_form');
  end if;
end $$;

create table if not exists public.prop65_warnings (
  id                       uuid        primary key default gen_random_uuid(),
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  site_id                  uuid        not null references public.prop65_sites(id) on delete cascade,
  -- Array of prop65_chemicals.id values. We don't FK-enforce element-
  -- level integrity (Postgres can't FK an array element); the API
  -- validates against prop65_chemicals on insert.
  prop65_chemical_ids      uuid[]      not null default '{}'::uuid[],
  warning_type             public.prop65_warning_type not null,
  harm_endpoint            public.prop65_harm_endpoint not null,
  posted_at                timestamptz not null default now(),
  posted_by_user_id        uuid        references auth.users(id) on delete set null,
  -- Storage key in the loto-photos bucket under prop65/<tenant>/...
  -- See packages/core/src/storagePaths.ts → prop65WarningPhotoPath.
  photo_url                text,
  removed_at               timestamptz,
  removed_by_user_id       uuid        references auth.users(id) on delete set null,
  warning_text             text        not null check (length(btrim(warning_text)) > 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (cardinality(prop65_chemical_ids) > 0),
  check (
    case
      when removed_at is not null then removed_by_user_id is not null
      else removed_by_user_id is null
    end
  )
);

create index if not exists idx_prop65_warnings_site_active
  on public.prop65_warnings (tenant_id, site_id, posted_at desc)
  where removed_at is null;
create index if not exists idx_prop65_warnings_site_all
  on public.prop65_warnings (tenant_id, site_id, posted_at desc);

comment on table public.prop65_warnings is
  'Records of physical Prop 65 warning signs posted at a site (Cal. Code Regs tit. 27 §25602). warning_text snapshots the rendered sign text for audit replay.';

drop trigger if exists trg_prop65_warnings_touch on public.prop65_warnings;
create trigger trg_prop65_warnings_touch
  before update on public.prop65_warnings
  for each row execute function public.touch_updated_at();

alter table public.prop65_warnings enable row level security;

drop policy if exists "prop65_warnings_tenant_scope" on public.prop65_warnings;
create policy "prop65_warnings_tenant_scope"
  on public.prop65_warnings
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

-- Anonymous read for /prop65/[slug] public route — joins through
-- prop65_sites on the slug. The slug itself is the access token; we
-- don't surface tenant_id columns in the public view.
drop policy if exists "prop65_warnings_public_read" on public.prop65_warnings;
create policy "prop65_warnings_public_read"
  on public.prop65_warnings
  for select to anon
  using (removed_at is null);

drop trigger if exists trg_audit_prop65_warnings on public.prop65_warnings;
create trigger trg_audit_prop65_warnings
  after insert or update or delete on public.prop65_warnings
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
