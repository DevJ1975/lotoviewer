-- Migration 317: hazardous waste manifests (shipments).
--
-- The hazardous-waste module (140, 142, 272) tracks waste until a container is
-- closed. This adds what happens next: a shipment is one manifest, listing the
-- closed containers that left on it, and it carries the clock the generator is
-- held to for getting the signed copy back from the receiving facility.
--
--   hazardous_waste_shipments            one row per manifest: parties, waste codes,
--                                        dates, and a status that only moves forward.
--   hazardous_waste_shipment_containers  which containers are on which manifest.
--
-- generator_category is a SNAPSHOT of the site's category on the day of the
-- shipment. The category can change later; the return clock must keep using the
-- one the shipment was made under, so it is copied here and never recomputed.
--
-- Status moves only through hw_create_shipment / hw_transition_shipment, which
-- change the manifest and its containers in one transaction. Both are SECURITY
-- INVOKER: RLS applies to everything they touch. A guard trigger refuses any other
-- route to a status or date, and refuses edits to a manifest once it has shipped,
-- so a direct update cannot mark a manifest completed while its containers still
-- say "in shipment".
--
-- A seed or a repair runs as the table owner with no signed-in user, so it cannot call
-- the functions. To put a manifest in a later status, insert it as a draft with its
-- containers, then name it to the guard and update it in the same transaction:
--   select set_config('soteria.hw_shipment_transition', '<manifest id>', true);
--   update public.hazardous_waste_shipments set status = 'shipped', shipped_on = '<date>' where id = '<manifest id>';
-- The containers' own status is then the seed's to set.
--
-- Access: any member of the account reads and creates; the creator or a tenant
-- admin edits a draft and moves it along; only a tenant admin deletes. Unlike the
-- older hazardous_waste_* tables (140, 142), which are not facility-scoped, these
-- follow migration 211: a request scoped to one site sees only that site's
-- manifests, and no site header is the roll-up. The (tenant_id, facility_id) pair
-- is a composite foreign key (uq_facilities_tenant_id_pair, migration 284).
--
-- VERIFY (no regulatory text here has been confirmed against the current CFR; each
-- needs confirmation by a CSP or the state agency before it is relied on):
--   * manifest tracking number: 9 digits then 3 letters (EPA Form 8700-22).
--   * EPA ID number: 3 letters then 9 digits. A state-issued or foreign ID that
--     does not fit would be refused; confirm with the agency.
--   * the return clock itself (40 CFR 262.42) lives in packages/core, not here.
--
-- Depends on 140 (containers), 209-211 (facilities) and 284 (facility pair key).
-- Idempotent. Rollback: 317_rollback.sql (restores containers: see its header).

begin;

-- ── Manifests ────────────────────────────────────────────────────────────────
create table if not exists public.hazardous_waste_shipments (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  facility_id               uuid not null default public.active_facility_id(),

  -- Null while a draft. Unique per account so the same paper form is never two records.
  manifest_tracking_number  text check (manifest_tracking_number is null or manifest_tracking_number ~ '^[0-9]{9}[A-Z]{3}$'),
  status                    text not null default 'draft'
                              check (status in ('draft', 'shipped', 'completed', 'exception_reported', 'cancelled')),
  -- 'federal' or 'state:CA'. California treats a VSQG as an SQG, which changes the clock.
  jurisdiction              text not null default 'federal' check (jurisdiction ~ '^(federal|state:[A-Z]{2})$'),
  generator_category        text not null check (generator_category in ('lqg', 'sqg', 'vsqg')),

  generator_epa_id          text check (generator_epa_id   is null or generator_epa_id   ~ '^[A-Z]{3}[0-9]{9}$'),
  transporter_epa_id        text check (transporter_epa_id is null or transporter_epa_id ~ '^[A-Z]{3}[0-9]{9}$'),
  tsdf_epa_id               text check (tsdf_epa_id        is null or tsdf_epa_id        ~ '^[A-Z]{3}[0-9]{9}$'),
  transporter_name          text check (transporter_name   is null or length(transporter_name) <= 200),
  tsdf_name                 text check (tsdf_name          is null or length(tsdf_name) <= 200),

  waste_codes               text[] not null default '{}' check (cardinality(waste_codes) <= 50),
  dot_description           text check (dot_description is null or length(dot_description) <= 1000),
  -- Submitted through EPA's e-Manifest rather than on paper.
  electronic                boolean not null default false,

  -- The day the initial transporter accepted the waste: day 0 of the return clock.
  shipped_on                date,
  -- The day the signed final copy came back.
  completed_on              date,
  exception_reported_on     date,
  notes                     text check (notes is null or length(notes) <= 2000),

  created_by                uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade,
  constraint hw_shipments_tenant_id_key unique (tenant_id, id),
  constraint hw_shipments_tenant_tracking_key unique (tenant_id, manifest_tracking_number),

  -- A cancelled draft never had a number to give; every other state past draft has one.
  constraint hw_shipments_tracking_once_past_draft
    check (status in ('draft', 'cancelled') or manifest_tracking_number is not null),
  constraint hw_shipments_shipped_on_required
    check (status not in ('shipped', 'completed', 'exception_reported') or shipped_on is not null),
  constraint hw_shipments_completed_on_required
    check (status <> 'completed' or completed_on is not null),
  constraint hw_shipments_exception_on_required
    check (status <> 'exception_reported' or exception_reported_on is not null),
  constraint hw_shipments_completed_on_only_when_completed
    check (completed_on is null or status = 'completed'),
  constraint hw_shipments_exception_on_only_when_reported
    check (exception_reported_on is null or status = 'exception_reported'),
  constraint hw_shipments_completed_after_shipped
    check (completed_on is null or (shipped_on is not null and completed_on >= shipped_on)),
  constraint hw_shipments_exception_after_shipped
    check (exception_reported_on is null or (shipped_on is not null and exception_reported_on >= shipped_on)),
  constraint hw_shipments_draft_has_no_dates
    check (status <> 'draft' or (shipped_on is null and completed_on is null and exception_reported_on is null))
);

create index if not exists idx_hw_shipments_facility_status
  on public.hazardous_waste_shipments (tenant_id, facility_id, status);
-- The return clock only runs on shipped manifests, oldest first.
create index if not exists idx_hw_shipments_open_clock
  on public.hazardous_waste_shipments (tenant_id, shipped_on) where status = 'shipped';

-- ── Containers on a manifest ─────────────────────────────────────────────────
-- A container leaves a manifest only when the manifest is cancelled (released_at);
-- until then it can be on no other.
create table if not exists public.hazardous_waste_shipment_containers (
  shipment_id   uuid not null,
  -- No action, not restrict: a tenant delete cascades to containers and to this table
  -- in one statement, and restrict would refuse it depending on which was visited first.
  container_id  uuid not null references public.hazardous_waste_containers(id),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  released_at   timestamptz,
  created_at    timestamptz not null default now(),

  primary key (shipment_id, container_id),
  foreign key (tenant_id, shipment_id) references public.hazardous_waste_shipments(tenant_id, id) on delete cascade
);

create unique index if not exists uq_hw_shipment_containers_on_manifest
  on public.hazardous_waste_shipment_containers (container_id) where released_at is null;
create index if not exists idx_hw_shipment_containers_container
  on public.hazardous_waste_shipment_containers (container_id);
create index if not exists idx_hw_shipment_containers_shipment
  on public.hazardous_waste_shipment_containers (tenant_id, shipment_id);

-- ── Guards ───────────────────────────────────────────────────────────────────
-- Why a setting and not a column: the transition function runs as the caller, so the
-- guard cannot tell its update from the caller's own. The function names the
-- manifest it is moving for the length of its transaction; nothing else does.
create or replace function public.hw_shipments_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_in_transition boolean := coalesce(current_setting('soteria.hw_shipment_transition', true), '') = old.id::text;
  -- Everything else is frozen once the manifest has left draft; a column added later
  -- is frozen by default.
  v_after_draft_mutable constant text[] :=
    array['status', 'shipped_on', 'completed_on', 'exception_reported_on', 'notes', 'updated_at', 'created_by'];
begin
  if new.tenant_id <> old.tenant_id or new.facility_id <> old.facility_id then
    raise exception 'A manifest cannot move to another account or site.'
      using errcode = 'check_violation', detail = 'hw_manifest';
  end if;

  if not v_in_transition and (
       new.status                is distinct from old.status
    or new.shipped_on            is distinct from old.shipped_on
    or new.completed_on          is distinct from old.completed_on
    or new.exception_reported_on is distinct from old.exception_reported_on
  ) then
    raise exception 'A manifest''s status and dates change only by shipping, receiving, reporting an exception on, or cancelling it.'
      using errcode = 'check_violation', detail = 'hw_manifest';
  end if;

  if old.status <> 'draft' and (
       (not v_in_transition and new.notes is distinct from old.notes)
    or (to_jsonb(new) - v_after_draft_mutable) is distinct from (to_jsonb(old) - v_after_draft_mutable)
  ) then
    raise exception 'This manifest is % and can no longer be edited. Cancel it and start a new one if it was wrong.', old.status
      using errcode = 'check_violation', detail = 'hw_manifest';
  end if;

  return new;
end $$;

drop trigger if exists trg_hw_shipments_guard on public.hazardous_waste_shipments;
create trigger trg_hw_shipments_guard before update on public.hazardous_waste_shipments
  for each row execute function public.hw_shipments_guard();

drop trigger if exists trg_hw_shipments_touch on public.hazardous_waste_shipments;
create trigger trg_hw_shipments_touch before update on public.hazardous_waste_shipments
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_hazardous_waste_shipments on public.hazardous_waste_shipments;
create trigger trg_audit_hazardous_waste_shipments after insert or update or delete on public.hazardous_waste_shipments
  for each row execute function public.log_audit('id');

-- Deleting a manifest that still holds containers would leave them "in shipment" with
-- no manifest to finish them. A completed or exception-reported manifest's waste has
-- left the site, so its containers are not put back.
create or replace function public.hw_shipments_release_containers()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status in ('draft', 'shipped') then
    update public.hazardous_waste_containers c
       set status = 'closed'
     where c.status = 'in_shipment'
       and c.id in (
         select j.container_id from public.hazardous_waste_shipment_containers j
          where j.shipment_id = old.id and j.released_at is null
       );
  end if;
  return old;
end $$;

drop trigger if exists trg_hw_shipments_release_containers on public.hazardous_waste_shipments;
create trigger trg_hw_shipments_release_containers before delete on public.hazardous_waste_shipments
  for each row execute function public.hw_shipments_release_containers();

-- A manifest and its containers belong to one account and one site, and containers
-- are added only while the manifest is a draft. RLS already keeps accounts apart;
-- like the container guard in 140, this holds if a policy is ever loosened.
create or replace function public.hw_shipment_container_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_container public.hazardous_waste_containers%rowtype;
  v_shipment  public.hazardous_waste_shipments%rowtype;
begin
  select * into v_container from public.hazardous_waste_containers where id = new.container_id;
  if not found then
    raise exception 'container % not found', new.container_id using errcode = 'no_data_found';
  end if;
  select * into v_shipment from public.hazardous_waste_shipments where id = new.shipment_id;
  if not found then
    raise exception 'manifest % not found', new.shipment_id using errcode = 'no_data_found';
  end if;

  if v_container.tenant_id <> new.tenant_id or v_shipment.tenant_id <> new.tenant_id then
    raise exception 'A container and its manifest must belong to the same account.'
      using errcode = 'check_violation', detail = 'hw_manifest';
  end if;
  if v_container.facility_id is distinct from v_shipment.facility_id then
    raise exception 'A container and its manifest must be at the same site.'
      using errcode = 'check_violation', detail = 'hw_manifest';
  end if;
  if v_shipment.status <> 'draft' then
    raise exception 'Containers can be added only while a manifest is a draft.'
      using errcode = 'check_violation', detail = 'hw_manifest';
  end if;
  return new;
end $$;

drop trigger if exists trg_hw_shipment_containers_guard on public.hazardous_waste_shipment_containers;
create trigger trg_hw_shipment_containers_guard before insert on public.hazardous_waste_shipment_containers
  for each row execute function public.hw_shipment_container_guard();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.hazardous_waste_shipments           enable row level security;
alter table public.hazardous_waste_shipment_containers enable row level security;

drop policy if exists hw_shipments_read on public.hazardous_waste_shipments;
create policy hw_shipments_read on public.hazardous_waste_shipments
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- A new manifest is a draft: it becomes anything else only through the transition function.
drop policy if exists hw_shipments_member_insert on public.hazardous_waste_shipments;
create policy hw_shipments_member_insert on public.hazardous_waste_shipments
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and status = 'draft'
    and created_by = auth.uid()
  );

drop policy if exists hw_shipments_creator_or_admin_update on public.hazardous_waste_shipments;
create policy hw_shipments_creator_or_admin_update on public.hazardous_waste_shipments
  for update to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (
      tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
      or (tenant_id in (select public.current_user_tenant_ids()) and created_by = auth.uid())
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (
      tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
      or (tenant_id in (select public.current_user_tenant_ids()) and created_by = auth.uid())
    )
  );

drop policy if exists hw_shipments_admin_delete on public.hazardous_waste_shipments;
create policy hw_shipments_admin_delete on public.hazardous_waste_shipments
  for delete to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

-- The junction has no site of its own: it is visible and writable through its manifest,
-- whose policies (this migration's, applied to the subquery) carry the site scope.
drop policy if exists hw_shipment_containers_read on public.hazardous_waste_shipment_containers;
create policy hw_shipment_containers_read on public.hazardous_waste_shipment_containers
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and exists (
      select 1 from public.hazardous_waste_shipments s
       where s.id = shipment_id and s.tenant_id = tenant_id
         and (public.active_facility_id() is null or s.facility_id = public.active_facility_id())
    )
  );

drop policy if exists hw_shipment_containers_creator_or_admin_insert on public.hazardous_waste_shipment_containers;
create policy hw_shipment_containers_creator_or_admin_insert on public.hazardous_waste_shipment_containers
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and exists (
      select 1 from public.hazardous_waste_shipments s
       where s.id = shipment_id and s.tenant_id = tenant_id
         and (public.active_facility_id() is null or s.facility_id = public.active_facility_id())
         and (s.created_by = auth.uid() or s.tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  );

drop policy if exists hw_shipment_containers_creator_or_admin_update on public.hazardous_waste_shipment_containers;
create policy hw_shipment_containers_creator_or_admin_update on public.hazardous_waste_shipment_containers
  for update to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and exists (
      select 1 from public.hazardous_waste_shipments s
       where s.id = shipment_id and s.tenant_id = tenant_id
         and (public.active_facility_id() is null or s.facility_id = public.active_facility_id())
         and (s.created_by = auth.uid() or s.tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists hw_shipment_containers_admin_delete on public.hazardous_waste_shipment_containers;
create policy hw_shipment_containers_admin_delete on public.hazardous_waste_shipment_containers
  for delete to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and exists (
      select 1 from public.hazardous_waste_shipments s
       where s.id = shipment_id and s.tenant_id = tenant_id
         and (public.active_facility_id() is null or s.facility_id = public.active_facility_id())
    )
  );

grant select, insert, update, delete on public.hazardous_waste_shipments           to authenticated;
grant select, insert, update, delete on public.hazardous_waste_shipment_containers to authenticated;

-- ── Transition functions ─────────────────────────────────────────────────────
-- What the functions refuse is said to the person, so the message is the API's answer.
-- The detail marks a message written for people; a constraint's own message is not,
-- and the API never shows it.
create or replace function public.hw_manifest_refuse(p_message text, p_sqlstate text default '23514')
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception '%', p_message using errcode = p_sqlstate, detail = 'hw_manifest';
end $$;

-- Creates a draft manifest for closed containers and puts those containers "in shipment".
--
-- Which containers count is decided here, not left to RLS alone: the older container
-- policies (140) are not site-scoped, and a container from another account must answer
-- "not found", exactly as a container that does not exist.
--
-- p_fields takes only the columns a person fills in; any other key is refused, so a
-- caller cannot set a status, an account or an owner through it.
create or replace function public.hw_create_shipment(p_container_ids uuid[], p_fields jsonb)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_caller        uuid := auth.uid();
  v_fields        jsonb := coalesce(p_fields, '{}'::jsonb);
  v_allowed       constant text[] := array[
                    'generator_category', 'jurisdiction', 'manifest_tracking_number', 'generator_epa_id', 'transporter_epa_id',
                    'tsdf_epa_id', 'transporter_name', 'tsdf_name', 'waste_codes', 'dot_description', 'electronic', 'notes'];
  v_unknown       text;
  v_ids           uuid[];
  v_visible       int;
  v_tenant_count  int;
  v_tenant        uuid;
  v_site_count    int;
  v_site          uuid;
  v_unsited       boolean;
  v_not_ready     text;
  v_codes         text[] := '{}';
  v_id            uuid;
begin
  if v_caller is null then
    perform public.hw_manifest_refuse('Sign in to create a manifest.', '42501');
  end if;
  if jsonb_typeof(v_fields) <> 'object' then
    perform public.hw_manifest_refuse('The manifest details must be an object.');
  end if;
  select k into v_unknown from jsonb_object_keys(v_fields) k where k <> all (v_allowed) limit 1;
  if v_unknown is not null then
    perform public.hw_manifest_refuse(format('%s is not a manifest field.', v_unknown));
  end if;

  select coalesce(array_agg(distinct c), '{}') into v_ids from unnest(coalesce(p_container_ids, '{}')) c where c is not null;
  if cardinality(v_ids) = 0 then
    perform public.hw_manifest_refuse('Choose at least one container.');
  end if;
  if cardinality(v_ids) > 100 then
    perform public.hw_manifest_refuse('A manifest can carry at most 100 containers.');
  end if;

  -- Lock in a fixed order so two manifests being drawn up over the same containers
  -- cannot deadlock; the second one then sees them already "in shipment".
  perform c.id from public.hazardous_waste_containers c where c.id = any (v_ids) order by c.id for update;

  select count(*), count(distinct c.tenant_id), min(c.tenant_id::text)::uuid,
         count(distinct c.facility_id), min(c.facility_id::text)::uuid, coalesce(bool_or(c.facility_id is null), false)
    into v_visible, v_tenant_count, v_tenant, v_site_count, v_site, v_unsited
    from public.hazardous_waste_containers c
   where c.id = any (v_ids)
     and (public.active_tenant_id() is null or c.tenant_id = public.active_tenant_id())
     and (c.tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
     and (public.active_facility_id() is null or c.facility_id = public.active_facility_id());
  if v_visible <> cardinality(v_ids) then
    perform public.hw_manifest_refuse('container not found', 'P0002');
  end if;
  if v_tenant_count > 1 then
    perform public.hw_manifest_refuse('Containers from different accounts cannot share a manifest.');
  end if;

  select string_agg(format('%s (%s)', c.label, case when c.archived_at is not null then 'archived' else replace(c.status, '_', ' ') end),
                    ', ' order by c.label)
    into v_not_ready
    from public.hazardous_waste_containers c
   where c.id = any (v_ids) and (c.status <> 'closed' or c.archived_at is not null);
  if v_not_ready is not null then
    perform public.hw_manifest_refuse(format('Only closed containers can go on a manifest. Not ready: %s.', v_not_ready));
  end if;

  if v_unsited then
    perform public.hw_manifest_refuse('A container has no site assigned, so it cannot be shipped from one.');
  end if;
  if v_site_count > 1 then
    perform public.hw_manifest_refuse('Containers at different sites cannot share a manifest. Make one manifest per site.');
  end if;

  if coalesce(v_fields->>'generator_category', '') not in ('lqg', 'sqg', 'vsqg') then
    perform public.hw_manifest_refuse('Choose the generator category the site shipped under: lqg, sqg or vsqg.');
  end if;
  if v_fields ? 'waste_codes' then
    if jsonb_typeof(v_fields->'waste_codes') <> 'array' then
      perform public.hw_manifest_refuse('Waste codes must be a list.');
    end if;
    select coalesce(array_agg(code), '{}') into v_codes from jsonb_array_elements_text(v_fields->'waste_codes') code;
  end if;

  insert into public.hazardous_waste_shipments (
    tenant_id, facility_id, created_by, generator_category, jurisdiction, manifest_tracking_number,
    generator_epa_id, transporter_epa_id, tsdf_epa_id, transporter_name, tsdf_name,
    waste_codes, dot_description, electronic, notes
  ) values (
    v_tenant, v_site, v_caller, v_fields->>'generator_category', coalesce(nullif(btrim(v_fields->>'jurisdiction'), ''), 'federal'),
    nullif(btrim(v_fields->>'manifest_tracking_number'), ''),
    nullif(btrim(v_fields->>'generator_epa_id'), ''), nullif(btrim(v_fields->>'transporter_epa_id'), ''), nullif(btrim(v_fields->>'tsdf_epa_id'), ''),
    nullif(btrim(v_fields->>'transporter_name'), ''), nullif(btrim(v_fields->>'tsdf_name'), ''),
    v_codes, nullif(btrim(v_fields->>'dot_description'), ''), coalesce((v_fields->>'electronic')::boolean, false),
    nullif(btrim(v_fields->>'notes'), '')
  ) returning id into v_id;

  insert into public.hazardous_waste_shipment_containers (shipment_id, container_id, tenant_id)
  select v_id, c, v_tenant from unnest(v_ids) c;

  update public.hazardous_waste_containers set status = 'in_shipment', updated_by = v_caller where id = any (v_ids);

  return v_id;
end $$;

-- Moves a manifest one step and its containers with it.
--
--   ship            draft -> shipped.            p_on is the day the transporter accepted the waste.
--   receive         shipped -> completed.        p_on is the day the signed copy came back; containers -> disposed.
--   file_exception  shipped -> exception_reported. p_on is the day the report was filed.
--   cancel          draft or shipped -> cancelled. p_on is not used; containers -> closed again.
--
-- Doing the same thing twice is not an error: shipping a shipped manifest on the date it
-- was shipped, and so on, return without writing. A different date is refused, so a
-- double-click is harmless and a conflicting second entry is not silently accepted.
--
-- Not found covers a manifest that is not there, belongs to another account or site, or
-- is not the caller's to move (SELECT FOR UPDATE applies the update policy), so the answer
-- never confirms that a manifest exists.
create or replace function public.hw_transition_shipment(p_id uuid, p_action text, p_on date, p_note text default null)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_caller   uuid := auth.uid();
  v_ship     public.hazardous_waste_shipments%rowtype;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  -- The latest calendar date it is anywhere on Earth (UTC+14), so a site ahead of UTC is
  -- never refused for entering its own today.
  v_latest   constant date := (timezone('UTC', now()) + interval '14 hours')::date;
  v_notes    text;
  v_status   text;
  v_shipped  date;
  v_completed date;
  v_excepted date;
begin
  if v_caller is null then
    perform public.hw_manifest_refuse('Sign in to update a manifest.', '42501');
  end if;
  if p_action is null or p_action not in ('ship', 'receive', 'file_exception', 'cancel') then
    perform public.hw_manifest_refuse(format('%s is not a manifest action.', coalesce(p_action, 'No action')));
  end if;

  select * into v_ship from public.hazardous_waste_shipments where id = p_id for update;
  if not found then
    perform public.hw_manifest_refuse('manifest not found', 'P0002');
  end if;

  v_status := v_ship.status;
  v_shipped := v_ship.shipped_on;
  v_completed := v_ship.completed_on;
  v_excepted := v_ship.exception_reported_on;

  if p_action = 'ship' then
    if v_ship.status = 'shipped' and v_ship.shipped_on is not distinct from p_on then return; end if;
    if v_ship.status <> 'draft' then
      perform public.hw_manifest_refuse(format('Only a draft can be shipped (status: %s).', replace(v_ship.status, '_', ' ')));
    end if;
    if v_ship.manifest_tracking_number is null then
      perform public.hw_manifest_refuse('Add the manifest tracking number before shipping.');
    end if;
    if p_on is null then
      perform public.hw_manifest_refuse('Enter the date the transporter accepted the waste.');
    end if;
    if p_on > v_latest then
      perform public.hw_manifest_refuse('The ship date cannot be in the future.');
    end if;
    v_status := 'shipped';
    v_shipped := p_on;

  elsif p_action = 'receive' then
    if v_ship.status = 'completed' and v_ship.completed_on is not distinct from p_on then return; end if;
    if v_ship.status <> 'shipped' then
      perform public.hw_manifest_refuse(format('Only a shipped manifest can be completed (status: %s).', replace(v_ship.status, '_', ' ')));
    end if;
    if p_on is null then
      perform public.hw_manifest_refuse('Enter the date the signed copy was received.');
    end if;
    if p_on > v_latest then
      perform public.hw_manifest_refuse('The date the signed copy was received cannot be in the future.');
    end if;
    if p_on < v_ship.shipped_on then
      perform public.hw_manifest_refuse(format('The signed copy cannot come back before the waste shipped on %s.', v_ship.shipped_on));
    end if;
    v_status := 'completed';
    v_completed := p_on;

  elsif p_action = 'file_exception' then
    if v_ship.status = 'exception_reported' and v_ship.exception_reported_on is not distinct from p_on then return; end if;
    if v_ship.status <> 'shipped' then
      perform public.hw_manifest_refuse(format('An exception report applies only to a shipped manifest (status: %s).', replace(v_ship.status, '_', ' ')));
    end if;
    if p_on is null then
      perform public.hw_manifest_refuse('Enter the date the exception report was filed.');
    end if;
    if p_on > v_latest then
      perform public.hw_manifest_refuse('The exception report date cannot be in the future.');
    end if;
    if p_on < v_ship.shipped_on then
      perform public.hw_manifest_refuse(format('The exception report cannot be filed before the waste shipped on %s.', v_ship.shipped_on));
    end if;
    v_status := 'exception_reported';
    v_excepted := p_on;

  else
    if v_ship.status = 'cancelled' then return; end if;
    if v_ship.status not in ('draft', 'shipped') then
      perform public.hw_manifest_refuse(format('A manifest cannot be cancelled once it is completed or an exception has been reported (status: %s).', replace(v_ship.status, '_', ' ')));
    end if;
    v_status := 'cancelled';
  end if;

  v_notes := case when v_note is null then v_ship.notes
                  else concat_ws(E'\n', v_ship.notes, format('%s %s: %s', coalesce(p_on, timezone('UTC', now())::date), p_action, v_note)) end;
  if length(coalesce(v_notes, '')) > 2000 then
    perform public.hw_manifest_refuse('That note would take the manifest''s notes past 2000 characters.');
  end if;

  perform set_config('soteria.hw_shipment_transition', p_id::text, true);
  update public.hazardous_waste_shipments
     set status = v_status, shipped_on = v_shipped, completed_on = v_completed, exception_reported_on = v_excepted, notes = v_notes
   where id = p_id;
  perform set_config('soteria.hw_shipment_transition', '', true);

  -- Only containers still "in shipment" move: one a person changed by hand since is left as they set it.
  if p_action = 'receive' then
    update public.hazardous_waste_containers
       set status = 'disposed', archived_at = coalesce(archived_at, now()), updated_by = v_caller
     where status = 'in_shipment'
       and id in (select container_id from public.hazardous_waste_shipment_containers where shipment_id = p_id and released_at is null);
  elsif p_action = 'cancel' then
    update public.hazardous_waste_containers
       set status = 'closed', updated_by = v_caller
     where status = 'in_shipment'
       and id in (select container_id from public.hazardous_waste_shipment_containers where shipment_id = p_id and released_at is null);
    update public.hazardous_waste_shipment_containers set released_at = now() where shipment_id = p_id and released_at is null;
  end if;
end $$;

revoke all on function public.hw_manifest_refuse(text, text)                  from public, anon;
revoke all on function public.hw_create_shipment(uuid[], jsonb)               from public, anon;
revoke all on function public.hw_transition_shipment(uuid, text, date, text)  from public, anon;
grant execute on function public.hw_manifest_refuse(text, text)                 to authenticated;
grant execute on function public.hw_create_shipment(uuid[], jsonb)              to authenticated;
grant execute on function public.hw_transition_shipment(uuid, text, date, text) to authenticated;

notify pgrst, 'reload schema';

commit;
