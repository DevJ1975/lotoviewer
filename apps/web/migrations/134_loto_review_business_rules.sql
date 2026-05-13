-- Migration 134: Harden LOTO public review business rules.
--
-- Adds:
--   - per-link equipment snapshots so review scope is stable after invite
--   - photo replacement audit records
--   - RPC helpers that serialize note saves, photo replacement, and signoff
--     on the review_link row to prevent post-signoff mutation races

begin;

create table if not exists public.loto_review_link_equipment (
  id                     uuid        primary key default gen_random_uuid(),
  review_link_id         uuid        not null references public.loto_review_links(id) on delete cascade,
  tenant_id              uuid        not null references public.tenants(id) on delete cascade,
  equipment_id           text        not null,
  equipment_description  text,
  department             text        not null,
  sort_order             integer     not null default 0,
  created_at             timestamptz not null default now(),
  unique (review_link_id, equipment_id)
);

create index if not exists idx_loto_review_link_equipment_link
  on public.loto_review_link_equipment(review_link_id, sort_order, equipment_id);

create table if not exists public.loto_review_photo_replacements (
  id                       uuid        primary key default gen_random_uuid(),
  review_link_id           uuid        not null references public.loto_review_links(id) on delete cascade,
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  equipment_id             text        not null,
  slot                     text        not null check (slot in ('EQUIP', 'ISO')),
  old_photo_url            text,
  new_photo_url            text        not null,
  old_placard_url          text,
  old_signed_placard_url   text,
  storage_path             text        not null,
  replaced_at              timestamptz not null default now(),
  replaced_ip              text,
  replaced_user_agent      text
);

create index if not exists idx_loto_review_photo_replacements_link
  on public.loto_review_photo_replacements(review_link_id, replaced_at desc);

-- Backfill existing links to preserve current behavior for already-sent
-- review links. New links are snapshotted by the admin API at creation.
insert into public.loto_review_link_equipment (
  review_link_id,
  tenant_id,
  equipment_id,
  equipment_description,
  department,
  sort_order
)
select
  l.id,
  l.tenant_id,
  e.equipment_id,
  e.description,
  e.department,
  (row_number() over (partition by l.id order by e.equipment_id))::integer
from public.loto_review_links l
join public.loto_equipment e
  on e.tenant_id = l.tenant_id
 and e.department = l.department
 and coalesce(e.decommissioned, false) = false
on conflict (review_link_id, equipment_id) do nothing;

alter table public.loto_review_link_equipment enable row level security;
alter table public.loto_review_photo_replacements enable row level security;

drop policy if exists loto_review_link_equipment_tenant_scope on public.loto_review_link_equipment;
create policy loto_review_link_equipment_tenant_scope on public.loto_review_link_equipment
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

drop policy if exists loto_review_photo_replacements_tenant_scope on public.loto_review_photo_replacements;
create policy loto_review_photo_replacements_tenant_scope on public.loto_review_photo_replacements
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

create or replace function public.upsert_loto_placard_review(
  p_review_link_id uuid,
  p_equipment_id text,
  p_status text,
  p_notes text
)
returns void
language plpgsql
set search_path = pg_catalog, public, extensions
as $$
declare
  v_link public.loto_review_links%rowtype;
begin
  select *
    into v_link
    from public.loto_review_links
   where id = p_review_link_id
   for update;

  if not found then
    raise exception 'review link not found';
  end if;
  if v_link.signed_off_at is not null then
    raise exception 'review already signed off';
  end if;
  if p_status not in ('approved', 'needs_changes') then
    raise exception 'invalid review status';
  end if;
  if not exists (
    select 1
      from public.loto_review_link_equipment
     where review_link_id = p_review_link_id
       and equipment_id = p_equipment_id
  ) then
    raise exception 'equipment not in this review batch';
  end if;

  insert into public.loto_placard_reviews (
    review_link_id,
    equipment_id,
    status,
    notes
  )
  values (
    p_review_link_id,
    p_equipment_id,
    p_status,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  on conflict (review_link_id, equipment_id) do update
    set status = excluded.status,
        notes = excluded.notes;
end;
$$;

create or replace function public.apply_loto_review_photo_replacement(
  p_review_link_id uuid,
  p_equipment_id text,
  p_slot text,
  p_new_photo_url text,
  p_storage_path text,
  p_ip text default null,
  p_user_agent text default null
)
returns table(photo_status text)
language plpgsql
set search_path = pg_catalog, public, extensions
as $$
declare
  v_link public.loto_review_links%rowtype;
  v_equipment public.loto_equipment%rowtype;
  v_old_photo_url text;
  v_new_equip_url text;
  v_new_iso_url text;
  v_photo_status text;
begin
  select *
    into v_link
    from public.loto_review_links
   where id = p_review_link_id
   for update;

  if not found then
    raise exception 'review link not found';
  end if;
  if v_link.signed_off_at is not null then
    raise exception 'review already signed off';
  end if;
  if p_slot not in ('EQUIP', 'ISO') then
    raise exception 'invalid photo slot';
  end if;
  if not exists (
    select 1
      from public.loto_review_link_equipment
     where review_link_id = p_review_link_id
       and equipment_id = p_equipment_id
  ) then
    raise exception 'equipment not in this review batch';
  end if;

  select *
    into v_equipment
    from public.loto_equipment
   where tenant_id = v_link.tenant_id
     and equipment_id = p_equipment_id
   for update;

  if not found then
    raise exception 'equipment not found';
  end if;

  v_old_photo_url := case
    when p_slot = 'EQUIP' then v_equipment.equip_photo_url
    else v_equipment.iso_photo_url
  end;
  v_new_equip_url := case
    when p_slot = 'EQUIP' then p_new_photo_url
    else v_equipment.equip_photo_url
  end;
  v_new_iso_url := case
    when p_slot = 'ISO' then p_new_photo_url
    else v_equipment.iso_photo_url
  end;
  v_photo_status := case
    when (not coalesce(v_equipment.needs_equip_photo, true) or nullif(v_new_equip_url, '') is not null)
     and (not coalesce(v_equipment.needs_iso_photo, true) or nullif(v_new_iso_url, '') is not null)
      then 'complete'
    when nullif(v_new_equip_url, '') is not null or nullif(v_new_iso_url, '') is not null
      then 'partial'
    else 'missing'
  end;

  if p_slot = 'EQUIP' then
    update public.loto_equipment
       set equip_photo_url = p_new_photo_url,
           has_equip_photo = true,
           photo_status = v_photo_status,
           placard_url = null,
           signed_placard_url = null,
           updated_at = now()
     where tenant_id = v_link.tenant_id
       and equipment_id = p_equipment_id;
  else
    update public.loto_equipment
       set iso_photo_url = p_new_photo_url,
           has_iso_photo = true,
           photo_status = v_photo_status,
           placard_url = null,
           signed_placard_url = null,
           updated_at = now()
     where tenant_id = v_link.tenant_id
       and equipment_id = p_equipment_id;
  end if;

  insert into public.loto_review_photo_replacements (
    review_link_id,
    tenant_id,
    equipment_id,
    slot,
    old_photo_url,
    new_photo_url,
    old_placard_url,
    old_signed_placard_url,
    storage_path,
    replaced_ip,
    replaced_user_agent
  )
  values (
    p_review_link_id,
    v_link.tenant_id,
    p_equipment_id,
    p_slot,
    v_old_photo_url,
    p_new_photo_url,
    v_equipment.placard_url,
    v_equipment.signed_placard_url,
    p_storage_path,
    p_ip,
    p_user_agent
  );

  return query select v_photo_status;
end;
$$;

create or replace function public.signoff_loto_review_link(
  p_review_link_id uuid,
  p_approved boolean,
  p_typed_name text,
  p_signature text,
  p_notes text,
  p_ip text default null,
  p_user_agent text default null
)
returns table(review_link_id uuid)
language plpgsql
set search_path = pg_catalog, public, extensions
as $$
declare
  v_link public.loto_review_links%rowtype;
  v_snapshot_count integer;
  v_reviewed_count integer;
  v_not_ready_count integer;
begin
  select *
    into v_link
    from public.loto_review_links
   where id = p_review_link_id
   for update;

  if not found then
    raise exception 'review link not found';
  end if;
  if v_link.signed_off_at is not null then
    raise exception 'review already signed off';
  end if;

  select count(*)
    into v_snapshot_count
    from public.loto_review_link_equipment
   where review_link_id = p_review_link_id;

  if v_snapshot_count = 0 then
    raise exception 'review batch has no equipment';
  end if;

  select count(distinct r.equipment_id)
    into v_reviewed_count
    from public.loto_placard_reviews r
    join public.loto_review_link_equipment e
      on e.review_link_id = r.review_link_id
     and e.equipment_id = r.equipment_id
   where r.review_link_id = p_review_link_id;

  if v_reviewed_count < v_snapshot_count then
    raise exception 'all placards must be reviewed before signoff';
  end if;

  select count(*)
    into v_not_ready_count
    from public.loto_review_link_equipment snapshot
    left join public.loto_equipment equipment
      on equipment.tenant_id = v_link.tenant_id
     and equipment.equipment_id = snapshot.equipment_id
   where snapshot.review_link_id = p_review_link_id
     and (
       equipment.equipment_id is null
       or equipment.photo_status is distinct from 'complete'
       or equipment.placard_url is null
     );

  if v_not_ready_count > 0 then
    raise exception 'all equipment must have complete photos and generated placards before signoff';
  end if;

  update public.loto_review_links
     set signed_off_at = now(),
         signoff_approved = p_approved,
         signoff_signature = p_signature,
         signoff_typed_name = btrim(p_typed_name),
         signoff_notes = nullif(btrim(coalesce(p_notes, '')), ''),
         signoff_ip = p_ip,
         signoff_user_agent = p_user_agent
   where public.loto_review_links.id = p_review_link_id
   returning public.loto_review_links.id into review_link_id;

  return next;
end;
$$;

notify pgrst, 'reload schema';

commit;
