-- Migration 219: LOTO audit — snapshot tables + apply + emergency rollback.
--
-- This migration makes the audit safe to apply to production:
--
--   • capture_audit_snapshot      — immutable pre-apply save point (whole rows
--                                   as jsonb, so it survives future column
--                                   drift — exactly the signed_placard_url
--                                   problem migration 215 hit).
--   • apply_audit_change          — applies ONE approved change, transactionally,
--                                   idempotently. Mirrors apply_staged_photo_-
--                                   replacement (migration 215).
--   • apply_approved_audit_changes— applies all approved changes for a run; a
--                                   snapshot must exist first.
--   • restore_audit_snapshot      — the emergency last resort. Replays the
--                                   captured rows and nulls placard_url so the
--                                   caller can rebuild placards from restored data.
--
-- Every mutating RPC is SECURITY DEFINER (must write across tenant rows the
-- caller's RLS can't), pins search_path, and is granted to service_role only —
-- Supabase grants EXECUTE to anon+authenticated by default, so we revoke from
-- them by name (the lesson migration 215 documents).

begin;

-- ── Snapshot tables (immutable; modelled on loto_review_link_equipment) ──────
create table if not exists public.loto_audit_snapshots (
  id              uuid        primary key default gen_random_uuid(),
  run_id          uuid        not null references public.loto_audit_runs(id) on delete cascade,
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  reason          text        not null default 'pre_apply' check (reason in ('pre_apply', 'manual')),
  captured_at     timestamptz not null default now(),
  captured_by     uuid,
  equipment_count integer     not null default 0,
  step_count      integer     not null default 0
);

create index if not exists idx_loto_audit_snapshots_run
  on public.loto_audit_snapshots (run_id, captured_at desc);

create table if not exists public.loto_audit_snapshot_equipment (
  id           uuid    primary key default gen_random_uuid(),
  snapshot_id  uuid    not null references public.loto_audit_snapshots(id) on delete cascade,
  tenant_id    uuid    not null references public.tenants(id) on delete cascade,
  equipment_id text    not null,
  row          jsonb   not null,   -- to_jsonb(loto_equipment) at capture time
  unique (snapshot_id, equipment_id)
);

create table if not exists public.loto_audit_snapshot_steps (
  id           uuid    primary key default gen_random_uuid(),
  snapshot_id  uuid    not null references public.loto_audit_snapshots(id) on delete cascade,
  tenant_id    uuid    not null references public.tenants(id) on delete cascade,
  step_id      uuid    not null,
  equipment_id text    not null,
  row          jsonb   not null,   -- to_jsonb(loto_energy_steps) at capture time
  unique (snapshot_id, step_id)
);

alter table public.loto_audit_snapshots           enable row level security;
alter table public.loto_audit_snapshot_equipment  enable row level security;
alter table public.loto_audit_snapshot_steps      enable row level security;

drop policy if exists loto_audit_snapshots_tenant_scope on public.loto_audit_snapshots;
create policy loto_audit_snapshots_tenant_scope on public.loto_audit_snapshots
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists loto_audit_snapshot_equipment_tenant_scope on public.loto_audit_snapshot_equipment;
create policy loto_audit_snapshot_equipment_tenant_scope on public.loto_audit_snapshot_equipment
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists loto_audit_snapshot_steps_tenant_scope on public.loto_audit_snapshot_steps;
create policy loto_audit_snapshot_steps_tenant_scope on public.loto_audit_snapshot_steps
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ── capture_audit_snapshot ──────────────────────────────────────────────────
-- Copies every equipment the run proposes to touch (and all of that
-- equipment's steps) as whole-row jsonb. Returns the snapshot id. Called by the
-- apply path BEFORE the first mutation.
create or replace function public.capture_audit_snapshot(
  p_run_id      uuid,
  p_captured_by uuid default null,
  p_reason      text default 'pre_apply'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_tenant uuid;
  v_snap   uuid;
begin
  select tenant_id into v_tenant from public.loto_audit_runs where id = p_run_id;
  if v_tenant is null then raise exception 'audit run not found'; end if;

  insert into public.loto_audit_snapshots (run_id, tenant_id, reason, captured_by)
  values (p_run_id, v_tenant, coalesce(p_reason, 'pre_apply'), p_captured_by)
  returning id into v_snap;

  insert into public.loto_audit_snapshot_equipment (snapshot_id, tenant_id, equipment_id, row)
  select v_snap, e.tenant_id, e.equipment_id, to_jsonb(e.*)
    from public.loto_equipment e
   where e.tenant_id = v_tenant
     and e.equipment_id in (
       select distinct c.equipment_id from public.loto_audit_changes c where c.run_id = p_run_id
     );

  insert into public.loto_audit_snapshot_steps (snapshot_id, tenant_id, step_id, equipment_id, row)
  select v_snap, s.tenant_id, s.id, s.equipment_id, to_jsonb(s.*)
    from public.loto_energy_steps s
   where s.tenant_id = v_tenant
     and s.equipment_id in (
       select distinct c.equipment_id from public.loto_audit_changes c where c.run_id = p_run_id
     );

  update public.loto_audit_snapshots
     set equipment_count = (select count(*) from public.loto_audit_snapshot_equipment where snapshot_id = v_snap),
         step_count      = (select count(*) from public.loto_audit_snapshot_steps     where snapshot_id = v_snap)
   where id = v_snap;

  return v_snap;
end;
$$;

-- ── apply_audit_change ──────────────────────────────────────────────────────
-- Applies one APPROVED change. Idempotent: any non-'approved' status returns
-- unchanged (so a double-apply is a no-op). Returns the resulting status.
create or replace function public.apply_audit_change(
  p_change_id  uuid,
  p_applied_by uuid default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v   public.loto_audit_changes%rowtype;
begin
  select * into v from public.loto_audit_changes where id = p_change_id for update;
  if not found then raise exception 'audit change not found'; end if;
  if v.status <> 'approved' then
    return v.status;  -- idempotent no-op
  end if;

  if v.change_kind = 'step_field_edit' then
    if v.target_column not in (
      'tag_description', 'isolation_procedure', 'method_of_verification',
      'tag_description_es', 'isolation_procedure_es', 'method_of_verification_es'
    ) then
      raise exception 'illegal step column %', v.target_column;
    end if;
    execute format(
      'update public.loto_energy_steps set %I = $1 where id = $2 and tenant_id = $3', v.target_column
    ) using (v.new_value #>> '{}'), v.target_row_pk::uuid, v.tenant_id;

  elsif v.change_kind = 'step_confidence' then
    update public.loto_energy_steps
       set confidence        = (v.new_value #>> '{}'),
           confidence_source = 'audit:' || v.run_id::text
     where id = v.target_row_pk::uuid and tenant_id = v.tenant_id;

  elsif v.change_kind = 'equipment_field_edit' then
    if v.target_column not in (
      'description', 'notes', 'notes_es', 'internal_notes', 'manufacturer', 'model', 'department'
    ) then
      raise exception 'illegal equipment column %', v.target_column;
    end if;
    -- Null placard_url so the placard re-renders from the corrected text.
    execute format(
      'update public.loto_equipment set %I = $1, placard_url = null, updated_at = now() where equipment_id = $2 and tenant_id = $3',
      v.target_column
    ) using (v.new_value #>> '{}'), v.equipment_id, v.tenant_id;

  elsif v.change_kind = 'photo_provenance' then
    -- new_value: {provenance, is_placeholder, source_url?}. ISO slot only —
    -- the safety-critical isolation photo. The 217 trigger then clears
    -- verified / complete when is_placeholder is true.
    update public.loto_equipment
       set iso_photo_provenance         = coalesce(v.new_value ->> 'provenance', iso_photo_provenance),
           iso_photo_is_placeholder     = coalesce((v.new_value ->> 'is_placeholder')::boolean, iso_photo_is_placeholder),
           iso_photo_placeholder_source_url = v.new_value ->> 'source_url',
           updated_at                   = now()
     where equipment_id = v.equipment_id and tenant_id = v.tenant_id;

  elsif v.change_kind = 'placeholder_photo' then
    -- Attach the staged watermarked reference image to the ISO slot. Forces
    -- placard re-render; the 217 trigger guarantees this can never be verified.
    update public.loto_equipment
       set iso_photo_url                   = coalesce(v.staged_photo_url, v.new_value ->> 'photo_url'),
           has_iso_photo                   = true,
           iso_photo_provenance            = 'reference_placeholder',
           iso_photo_is_placeholder        = true,
           iso_photo_placeholder_source_url = v.new_value ->> 'source_url',
           placard_url                     = null,
           updated_at                      = now()
     where equipment_id = v.equipment_id and tenant_id = v.tenant_id;

  elsif v.change_kind = 'ehs_finding' then
    -- Non-mutating: the finding row IS the record. Nothing to apply.
    null;

  else
    raise exception 'unknown change_kind %', v.change_kind;
  end if;

  update public.loto_audit_changes
     set status = 'applied', applied_at = now(), apply_error = null
   where id = p_change_id;

  insert into public.loto_hygiene_log (tenant_id, equipment_id, action, section, reason, detail)
  values (
    v.tenant_id, v.equipment_id, 'audit_change_applied', 'audit',
    'Audit change applied: ' || v.change_kind,
    jsonb_build_object(
      'change_id',    v.id,
      'run_id',       v.run_id,
      'change_kind',  v.change_kind,
      'target_table', v.target_table,
      'target_column', v.target_column,
      'agent',        v.agent,
      'applied_by',   p_applied_by
    )
  );

  return 'applied';
end;
$$;

-- ── apply_approved_audit_changes ────────────────────────────────────────────
-- "Apply all approved" for a run. Requires a snapshot to already exist (the
-- rollback save point). Per-change errors are caught and recorded in
-- apply_error so one bad change can't abort the rest; the run lands
-- 'applied' (all done) or 'partially_applied' (some still approved+errored).
create or replace function public.apply_approved_audit_changes(
  p_run_id     uuid,
  p_applied_by uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_id      uuid;
  v_applied integer := 0;
begin
  if not exists (select 1 from public.loto_audit_snapshots where run_id = p_run_id) then
    raise exception 'no snapshot for run % — call capture_audit_snapshot first', p_run_id;
  end if;

  for v_id in
    select id from public.loto_audit_changes
     where run_id = p_run_id and status = 'approved'
     order by created_at
     for update
  loop
    begin
      if public.apply_audit_change(v_id, p_applied_by) = 'applied' then
        v_applied := v_applied + 1;
      end if;
    exception when others then
      -- Savepoint rollback for this change only; record why and continue.
      update public.loto_audit_changes set apply_error = left(sqlerrm, 500) where id = v_id;
    end;
  end loop;

  if exists (select 1 from public.loto_audit_changes where run_id = p_run_id and status = 'approved') then
    update public.loto_audit_runs set status = 'partially_applied', finished_at = now() where id = p_run_id;
  else
    update public.loto_audit_runs set status = 'applied', finished_at = now() where id = p_run_id;
  end if;

  return v_applied;
end;
$$;

-- ── restore_audit_snapshot (emergency rollback) ─────────────────────────────
-- Replays the captured rows. Restores only the audit-mutable columns (never
-- qr_token / created_at / ids). Nulls placard_url so the caller rebuilds the
-- placard from restored data. Idempotent: replaying yields the same state.
create or replace function public.restore_audit_snapshot(
  p_snapshot_id uuid,
  p_restored_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_tenant   uuid;
  v_eq_count integer := 0;
  v_st_count integer := 0;
  r          record;
begin
  select tenant_id into v_tenant from public.loto_audit_snapshots where id = p_snapshot_id;
  if v_tenant is null then raise exception 'snapshot not found'; end if;

  for r in
    select equipment_id, row from public.loto_audit_snapshot_equipment where snapshot_id = p_snapshot_id
  loop
    update public.loto_equipment e
       set description                      = r.row ->> 'description',
           notes                            = r.row ->> 'notes',
           notes_es                         = r.row ->> 'notes_es',
           internal_notes                   = r.row ->> 'internal_notes',
           manufacturer                     = r.row ->> 'manufacturer',
           model                            = r.row ->> 'model',
           department                       = r.row ->> 'department',
           equip_photo_url                  = r.row ->> 'equip_photo_url',
           iso_photo_url                    = r.row ->> 'iso_photo_url',
           has_equip_photo                  = coalesce((r.row ->> 'has_equip_photo')::boolean, false),
           has_iso_photo                    = coalesce((r.row ->> 'has_iso_photo')::boolean, false),
           photo_status                     = r.row ->> 'photo_status',
           equip_photo_provenance           = coalesce(r.row ->> 'equip_photo_provenance', 'field'),
           iso_photo_provenance             = coalesce(r.row ->> 'iso_photo_provenance', 'field'),
           iso_photo_is_placeholder         = coalesce((r.row ->> 'iso_photo_is_placeholder')::boolean, false),
           iso_photo_placeholder_source_url = r.row ->> 'iso_photo_placeholder_source_url',
           verified                         = coalesce((r.row ->> 'verified')::boolean, false),
           verified_date                    = (r.row ->> 'verified_date')::timestamptz,
           verified_by                      = r.row ->> 'verified_by',
           annotations                      = coalesce(r.row -> 'annotations', '[]'::jsonb),
           iso_annotations                  = coalesce(r.row -> 'iso_annotations', '[]'::jsonb),
           placard_url                      = null,
           updated_at                       = now()
     where e.equipment_id = r.equipment_id and e.tenant_id = v_tenant;
    v_eq_count := v_eq_count + 1;
  end loop;

  for r in
    select step_id, row from public.loto_audit_snapshot_steps where snapshot_id = p_snapshot_id
  loop
    update public.loto_energy_steps s
       set tag_description           = r.row ->> 'tag_description',
           isolation_procedure       = r.row ->> 'isolation_procedure',
           method_of_verification    = r.row ->> 'method_of_verification',
           tag_description_es        = r.row ->> 'tag_description_es',
           isolation_procedure_es    = r.row ->> 'isolation_procedure_es',
           method_of_verification_es = r.row ->> 'method_of_verification_es',
           energy_type               = r.row ->> 'energy_type',
           step_type                 = r.row ->> 'step_type',
           sequence_order            = coalesce((r.row ->> 'sequence_order')::integer, sequence_order),
           tryout_required           = coalesce((r.row ->> 'tryout_required')::boolean, tryout_required),
           confidence                = r.row ->> 'confidence',
           confidence_source         = r.row ->> 'confidence_source'
     where s.id = (r.step_id) and s.tenant_id = v_tenant;
    v_st_count := v_st_count + 1;
  end loop;

  insert into public.loto_hygiene_log (tenant_id, equipment_id, action, section, reason, detail)
  values (
    v_tenant, null, 'snapshot', 'audit',
    'Emergency rollback: restored audit snapshot',
    jsonb_build_object('snapshot_id', p_snapshot_id, 'restored_by', p_restored_by,
                       'equipment_restored', v_eq_count, 'steps_restored', v_st_count)
  );

  return jsonb_build_object('equipment_restored', v_eq_count, 'steps_restored', v_st_count);
end;
$$;

-- ── Grants: service_role only (revoke the Supabase default anon+authenticated) ─
revoke all on function public.capture_audit_snapshot(uuid, uuid, text)        from public, anon, authenticated;
revoke all on function public.apply_audit_change(uuid, uuid)                   from public, anon, authenticated;
revoke all on function public.apply_approved_audit_changes(uuid, uuid)        from public, anon, authenticated;
revoke all on function public.restore_audit_snapshot(uuid, uuid)              from public, anon, authenticated;
grant execute on function public.capture_audit_snapshot(uuid, uuid, text)     to service_role;
grant execute on function public.apply_audit_change(uuid, uuid)               to service_role;
grant execute on function public.apply_approved_audit_changes(uuid, uuid)     to service_role;
grant execute on function public.restore_audit_snapshot(uuid, uuid)           to service_role;

notify pgrst, 'reload schema';

commit;
