-- Migration 118: Equipment Readiness pre-use inspections.
--
-- Adds a field-first pre-use inspection module for PITs, aerial lifts,
-- pallet lifters, and configurable mobile equipment. The existing
-- loto_equipment table remains the asset identity source; these tables
-- add readiness, versioned checklist templates, inspection records,
-- evidence, defects, repair/return-to-service records, and operator
-- authorizations.

begin;

alter table public.loto_equipment
  add column if not exists equipment_family text not null default 'general'
    check (equipment_family in (
      'general',
      'forklift_electric',
      'forklift_ic_lpg',
      'reach_truck',
      'order_picker',
      'pallet_jack_powered',
      'pallet_lifter_manual',
      'aerial_lift_scissor',
      'aerial_lift_boom',
      'tow_tractor',
      'rough_terrain_forklift'
    )),
  add column if not exists readiness_status text not null default 'available'
    check (readiness_status in ('available', 'inspection_due', 'limited_use', 'out_of_service_pending_review', 'out_of_service', 'decommissioned')),
  add column if not exists last_pre_use_inspection_at timestamptz,
  add column if not exists last_pre_use_inspection_id uuid;

create index if not exists idx_loto_equipment_readiness
  on public.loto_equipment(tenant_id, readiness_status, equipment_family);

create table if not exists public.equipment_checklist_templates (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants(id) on delete cascade,
  library_scope    text not null default 'global' check (library_scope in ('global', 'tenant')),
  equipment_family text not null,
  title            text not null check (length(trim(title)) between 1 and 160),
  version_number   int not null default 1 check (version_number > 0),
  status           text not null default 'published' check (status in ('draft', 'published', 'archived', 'superseded')),
  osha_basis       text,
  effective_at     timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (
    (library_scope = 'global' and tenant_id is null)
    or (library_scope = 'tenant' and tenant_id is not null)
  )
);

create unique index if not exists ux_equipment_checklist_global_family_version
  on public.equipment_checklist_templates(equipment_family, version_number)
  where library_scope = 'global';
create unique index if not exists ux_equipment_checklist_tenant_family_version
  on public.equipment_checklist_templates(tenant_id, equipment_family, version_number)
  where library_scope = 'tenant';

create table if not exists public.equipment_checklist_items (
  id                 uuid primary key default gen_random_uuid(),
  template_id        uuid not null references public.equipment_checklist_templates(id) on delete cascade,
  section            text not null check (length(trim(section)) between 1 and 80),
  prompt             text not null check (length(trim(prompt)) between 1 and 400),
  response_type      text not null default 'pass_fail_na' check (response_type in ('pass_fail_na', 'number', 'text', 'photo_ack')),
  required           boolean not null default true,
  critical           boolean not null default false,
  photo_required     boolean not null default false,
  sort_order         int not null default 0,
  help_text          text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_equipment_checklist_items_order
  on public.equipment_checklist_items(template_id, sort_order, id);

create table if not exists public.equipment_inspections (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  equipment_record_id   uuid not null references public.loto_equipment(id) on delete cascade,
  equipment_id          text not null,
  checklist_template_id uuid not null references public.equipment_checklist_templates(id),
  operator_id           uuid not null references auth.users(id),
  started_at            timestamptz not null default now(),
  submitted_at          timestamptz not null default now(),
  duration_seconds      int check (duration_seconds is null or duration_seconds >= 0),
  shift_label           text,
  hour_meter            numeric,
  location_label        text,
  readiness_result      text not null default 'ready' check (readiness_result in ('ready', 'limited_use', 'blocked')),
  failed_critical_count int not null default 0 check (failed_critical_count >= 0),
  failed_item_count     int not null default 0 check (failed_item_count >= 0),
  operator_attestation  boolean not null default false,
  signature_name        text,
  client_context        jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists idx_equipment_inspections_tenant_recent
  on public.equipment_inspections(tenant_id, submitted_at desc);
create index if not exists idx_equipment_inspections_equipment_recent
  on public.equipment_inspections(tenant_id, equipment_record_id, submitted_at desc);

create table if not exists public.equipment_inspection_responses (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  inspection_id  uuid not null references public.equipment_inspections(id) on delete cascade,
  item_id        uuid not null references public.equipment_checklist_items(id),
  response       text not null check (response in ('pass', 'fail', 'na', 'text', 'number', 'photo_ack')),
  numeric_value  numeric,
  notes          text,
  severity       text check (severity is null or severity in ('monitor', 'repair_soon', 'critical')),
  action_decision text check (action_decision is null or action_decision in ('continue', 'limited_use', 'remove_from_service')),
  created_at     timestamptz not null default now()
);

create index if not exists idx_equipment_responses_inspection
  on public.equipment_inspection_responses(inspection_id);

create table if not exists public.equipment_evidence (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  source_type   text not null check (source_type in ('inspection', 'defect', 'repair')),
  source_id     uuid not null,
  equipment_record_id uuid references public.loto_equipment(id) on delete cascade,
  storage_path  text not null,
  media_kind    text not null default 'photo' check (media_kind in ('photo')),
  evidence_kind text not null default 'general' check (evidence_kind in ('equipment_full_view', 'hour_meter', 'damage', 'defect', 'repair', 'general')),
  caption       text,
  component     text,
  ai_review_status text not null default 'not_reviewed' check (ai_review_status in ('not_reviewed', 'flagged', 'cleared')),
  uploaded_by   uuid references auth.users(id),
  captured_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_equipment_evidence_source
  on public.equipment_evidence(tenant_id, source_type, source_id);
create index if not exists idx_equipment_evidence_equipment
  on public.equipment_evidence(tenant_id, equipment_record_id, created_at desc);

create table if not exists public.equipment_defects (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  equipment_record_id uuid not null references public.loto_equipment(id) on delete cascade,
  inspection_id       uuid references public.equipment_inspections(id) on delete set null,
  item_id             uuid references public.equipment_checklist_items(id) on delete set null,
  component           text,
  severity            text not null default 'repair_soon' check (severity in ('monitor', 'repair_soon', 'critical')),
  status              text not null default 'open' check (status in ('open', 'acknowledged', 'in_repair', 'resolved', 'cancelled')),
  out_of_service      boolean not null default false,
  description         text not null check (length(trim(description)) between 1 and 2000),
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  assigned_to         uuid references auth.users(id),
  due_at              timestamptz,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_equipment_defects_open
  on public.equipment_defects(tenant_id, status, severity, last_seen_at desc)
  where status in ('open', 'acknowledged', 'in_repair');
create index if not exists idx_equipment_defects_equipment
  on public.equipment_defects(tenant_id, equipment_record_id, last_seen_at desc);

create table if not exists public.equipment_repairs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  defect_id           uuid not null references public.equipment_defects(id) on delete cascade,
  status              text not null default 'in_repair' check (status in ('in_repair', 'completed', 'returned_to_service')),
  repair_notes        text,
  mechanic_id         uuid references auth.users(id),
  completed_at        timestamptz,
  return_to_service_by uuid references auth.users(id),
  return_to_service_at timestamptz,
  return_to_service_notes text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.equipment_operator_authorizations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  equipment_family   text not null,
  site_label         text,
  authorization_source text,
  trainer_name       text,
  evaluator_name     text,
  issued_at          date not null default current_date,
  evaluation_due_at  date,
  expires_at         date,
  status             text not null default 'active' check (status in ('active', 'expired', 'suspended', 'revoked')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists ux_equipment_authorizations_user_family_site
  on public.equipment_operator_authorizations(tenant_id, user_id, equipment_family, coalesce(site_label, ''));
create index if not exists idx_equipment_authorizations_user
  on public.equipment_operator_authorizations(tenant_id, user_id, status, equipment_family);
create index if not exists idx_equipment_authorizations_due
  on public.equipment_operator_authorizations(tenant_id, evaluation_due_at)
  where evaluation_due_at is not null;

alter table public.equipment_checklist_templates      enable row level security;
alter table public.equipment_checklist_items          enable row level security;
alter table public.equipment_inspections              enable row level security;
alter table public.equipment_inspection_responses     enable row level security;
alter table public.equipment_evidence                 enable row level security;
alter table public.equipment_defects                  enable row level security;
alter table public.equipment_repairs                  enable row level security;
alter table public.equipment_operator_authorizations  enable row level security;

create policy equipment_templates_read on public.equipment_checklist_templates
  for select to authenticated
  using (
    library_scope = 'global'
    or (
      tenant_id in (select public.current_user_tenant_ids())
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    )
    or public.is_superadmin()
  );
create policy equipment_templates_write on public.equipment_checklist_templates
  for all to authenticated
  using (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and tenant_id in (select public.current_user_admin_tenant_ids())
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    )
  )
  with check (
    (library_scope = 'global' and public.is_superadmin())
    or (
      library_scope = 'tenant'
      and tenant_id in (select public.current_user_admin_tenant_ids())
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    )
  );

create policy equipment_items_read on public.equipment_checklist_items
  for select to authenticated
  using (
    exists (
      select 1 from public.equipment_checklist_templates t
       where t.id = equipment_checklist_items.template_id
         and (
           t.library_scope = 'global'
           or t.tenant_id in (select public.current_user_tenant_ids())
           or public.is_superadmin()
         )
    )
  );
create policy equipment_items_write on public.equipment_checklist_items
  for all to authenticated
  using (
    exists (
      select 1 from public.equipment_checklist_templates t
       where t.id = equipment_checklist_items.template_id
         and (
           (t.library_scope = 'global' and public.is_superadmin())
           or (t.library_scope = 'tenant' and t.tenant_id in (select public.current_user_admin_tenant_ids()))
         )
    )
  )
  with check (
    exists (
      select 1 from public.equipment_checklist_templates t
       where t.id = equipment_checklist_items.template_id
         and (
           (t.library_scope = 'global' and public.is_superadmin())
           or (t.library_scope = 'tenant' and t.tenant_id in (select public.current_user_admin_tenant_ids()))
         )
    )
  );

create policy equipment_inspections_read on public.equipment_inspections
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
create policy equipment_inspections_insert on public.equipment_inspections
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (operator_id = auth.uid() or tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

create policy equipment_responses_read on public.equipment_inspection_responses
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
create policy equipment_responses_insert on public.equipment_inspection_responses
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy equipment_evidence_read on public.equipment_evidence
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
create policy equipment_evidence_insert on public.equipment_evidence
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy equipment_defects_read on public.equipment_defects
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
create policy equipment_defects_write on public.equipment_defects
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy equipment_repairs_read on public.equipment_repairs
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
create policy equipment_repairs_write on public.equipment_repairs
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

create policy equipment_authorizations_read on public.equipment_operator_authorizations
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      user_id = auth.uid()
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );
create policy equipment_authorizations_write on public.equipment_operator_authorizations
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

insert into storage.buckets (id, name, public)
values ('equipment-evidence', 'equipment-evidence', false)
on conflict (id) do nothing;

create policy equipment_evidence_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'equipment-evidence'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and ((split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
create policy equipment_evidence_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'equipment-evidence'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and ((split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- Global starter templates. Tenants can copy/version these later.
with templates as (
  insert into public.equipment_checklist_templates
    (library_scope, equipment_family, title, version_number, osha_basis)
  values
    ('global', 'forklift_electric', 'Electric forklift pre-use inspection', 1, 'OSHA 29 CFR 1910.178(q), 1910.178(l), OSHA PIT pre-operation guidance'),
    ('global', 'forklift_ic_lpg', 'Internal combustion/LPG forklift pre-use inspection', 1, 'OSHA 29 CFR 1910.178(q), 1910.178(l), OSHA PIT pre-operation guidance'),
    ('global', 'pallet_jack_powered', 'Powered pallet jack/lifter pre-use inspection', 1, 'OSHA PIT pre-operation guidance and NIOSH daily inspection checklist'),
    ('global', 'aerial_lift_scissor', 'Aerial lift pre-start inspection', 1, 'OSHA aerial lift pre-start inspection and work-area hazard guidance'),
    ('global', 'aerial_lift_boom', 'Boom lift pre-start inspection', 1, 'OSHA aerial lift pre-start inspection and work-area hazard guidance'),
    ('global', 'general', 'General mobile equipment pre-use inspection', 1, 'Employer pre-use readiness checklist')
  on conflict do nothing
  returning id, equipment_family
)
insert into public.equipment_checklist_items
  (template_id, section, prompt, response_type, required, critical, photo_required, sort_order, help_text)
select t.id, item.section, item.prompt, item.response_type, item.required, item.critical, item.photo_required, item.sort_order, item.help_text
from public.equipment_checklist_templates t
join (
  values
    ('all', 'Evidence', 'Capture a current full-view photo of this equipment.', 'photo_ack', true, false, true, 10, 'Use the equipment photo upload before submitting.'),
    ('all', 'Evidence', 'Record hour meter, odometer, or battery reading where available.', 'number', false, false, false, 20, null),
    ('all', 'Visual', 'No obvious leaks, cracked components, loose parts, or unsafe damage.', 'pass_fail_na', true, true, true, 30, 'Failing this item removes the equipment from service pending review.'),
    ('all', 'Visual', 'Tires/wheels, forks/platform, guards, labels, and data plate are present and serviceable.', 'pass_fail_na', true, true, true, 40, null),
    ('all', 'Controls', 'Horn, lights/alarms, steering, brakes, and emergency controls function as expected.', 'pass_fail_na', true, true, false, 50, null),
    ('forklift_electric', 'Power source', 'Battery, cables, connectors, restraint, and charging area are safe.', 'pass_fail_na', true, true, true, 60, null),
    ('forklift_ic_lpg', 'Power source', 'Fuel tank/cylinder, hoses, fittings, valve orientation, and leaks are safe.', 'pass_fail_na', true, true, true, 60, null),
    ('pallet_jack_powered', 'Lift system', 'Lift/lower controls, tiller, belly button, wheels, and battery are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('aerial_lift_scissor', 'Lift system', 'Platform, gates/guardrails, emergency lowering, pothole protection, and safety devices are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('aerial_lift_boom', 'Lift system', 'Boom, platform, gate, controls, emergency lowering, and anchor points are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('aerial_lift_scissor', 'Work area', 'Work area is checked for holes, slopes, overhead hazards, traffic, floor capacity, and weather/wind.', 'pass_fail_na', true, true, false, 70, null),
    ('aerial_lift_boom', 'Work area', 'Work area is checked for holes, slopes, overhead hazards, power lines, traffic, ground conditions, and wind.', 'pass_fail_na', true, true, false, 70, null)
) as item(family, section, prompt, response_type, required, critical, photo_required, sort_order, help_text)
  on item.family = 'all' or item.family = t.equipment_family
where t.library_scope = 'global'
  and not exists (
    select 1 from public.equipment_checklist_items i
     where i.template_id = t.id
       and i.prompt = item.prompt
  );

update public.tenants
   set modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object('equipment-readiness', true),
       updated_at = now()
 where modules is null or not (modules ? 'equipment-readiness');

notify pgrst, 'reload schema';

commit;
