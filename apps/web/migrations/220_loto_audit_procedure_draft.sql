-- Migration 220: LOTO audit — Procedure Author ("procedure_draft" change kind).
--
-- The Author agent drafts a CORRECTED energy-control procedure for a machine
-- that failed the EHS gate. The draft is staged as a single loto_audit_changes
-- row (change_kind='procedure_draft') whose new_value carries the full
-- replacement step set + a reviewer summary. Like every other audit change it is
-- NEVER auto-applied: a qualified safety professional reviews/edits/approves it
-- through the audit review link, and only then does apply_audit_change touch the
-- live loto_energy_steps. The human review gate remains the only path to a live
-- write.
--
-- This migration:
--   1. Extends the loto_audit_changes.change_kind CHECK to allow
--      'procedure_draft' (drop the inline-named constraint, re-add by name).
--   2. Re-emits apply_audit_change with a new 'procedure_draft' branch that
--      REPLACES the machine's steps from new_value->'steps'. All pre-existing
--      branches are copied byte-for-byte from migration 219.
--   3. Re-emits restore_audit_snapshot with a GENERALIZED step restore
--      (delete-then-reinsert preserving the original id) so a procedure
--      replacement — which inserts/deletes rows, not just edits them — is fully
--      reversible. The equipment-restore half is copied byte-for-byte from 219.
--
-- Idempotent: re-running yields the same schema + function bodies.

begin;

-- ── 1. Extend the change_kind CHECK ──────────────────────────────────────────
-- Migration 218 declares change_kind with an INLINE check, so Postgres named it
-- loto_audit_changes_change_kind_check. Drop whatever check currently governs
-- change_kind (resolved from the catalog, so we don't hard-depend on the name),
-- then re-add it by an explicit name including 'procedure_draft'.
do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
    from pg_constraint con
    join pg_class      rel on rel.oid = con.conrelid
    join pg_namespace  nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'loto_audit_changes'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%change_kind%'
   limit 1;

  if v_conname is not null then
    execute format('alter table public.loto_audit_changes drop constraint %I', v_conname);
  end if;
end$$;

alter table public.loto_audit_changes
  drop constraint if exists loto_audit_changes_change_kind_check;

alter table public.loto_audit_changes
  add constraint loto_audit_changes_change_kind_check check (change_kind in (
    'step_field_edit',      -- a loto_energy_steps text field
    'step_confidence',      -- write confidence onto a step
    'equipment_field_edit', -- a loto_equipment scalar
    'photo_provenance',     -- mark a photo placeholder/provenance
    'placeholder_photo',    -- attach a watermarked reference image
    'ehs_finding',          -- non-mutating citation record
    'procedure_draft'       -- full corrected procedure (replaces the step set)
  ));

-- ── 2. apply_audit_change (re-emit; adds the procedure_draft branch) ─────────
-- Every pre-existing branch below is copied verbatim from migration 219. The
-- only addition is the 'procedure_draft' branch.
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
    -- Attach the staged ISO image. Two sources land here: the watermarked web
    -- reference (defaults: reference_placeholder + is_placeholder=true, which
    -- the 217 trigger guarantees can never read as verified) AND a vision-
    -- verified match from the tenant's OWN storage, which carries
    -- provenance='field'/is_placeholder=false in new_value so it applies as a
    -- real field photo. Defaults preserve the original web-placeholder behavior.
    update public.loto_equipment
       set iso_photo_url                   = coalesce(v.staged_photo_url, v.new_value ->> 'photo_url'),
           has_iso_photo                   = true,
           iso_photo_provenance            = coalesce(v.new_value ->> 'provenance', 'reference_placeholder'),
           iso_photo_is_placeholder        = coalesce((v.new_value ->> 'is_placeholder')::boolean, true),
           iso_photo_placeholder_source_url = v.new_value ->> 'source_url',
           placard_url                     = null,
           updated_at                      = now()
     where equipment_id = v.equipment_id and tenant_id = v.tenant_id;

  elsif v.change_kind = 'procedure_draft' then
    -- Replace the machine's ENTIRE step set with the Author agent's corrected
    -- procedure. Approved + applied here = the safety professional signed off.
    -- step_number / sequence_order follow the array order in new_value->'steps';
    -- tryout_required is true only for the verify_zero_energy phase. Null
    -- placard_url so the placard re-renders from the corrected steps. The
    -- pre-apply snapshot (capture_audit_snapshot) saved the prior rows, and the
    -- generalized restore_audit_snapshot below makes this delete+insert
    -- reversible.
    delete from public.loto_energy_steps
     where tenant_id = v.tenant_id and equipment_id = v.equipment_id;

    insert into public.loto_energy_steps
      (tenant_id, equipment_id, energy_type, step_number, step_type, sequence_order,
       tryout_required, tag_description, isolation_procedure, method_of_verification,
       tag_description_es, isolation_procedure_es, method_of_verification_es)
    select
      v.tenant_id,
      v.equipment_id,
      coalesce(s.value ->> 'energy_type', 'N'),
      s.ord::integer,
      s.value ->> 'step_type',
      s.ord::integer,
      (s.value ->> 'step_type') = 'verify_zero_energy',
      s.value ->> 'tag_description',
      s.value ->> 'isolation_procedure',
      s.value ->> 'method_of_verification',
      -- Spanish parity: the placard renders bilingually, so the corrected draft
      -- carries the matching es-MX text the Author produced. Without these the
      -- ES half of every regenerated placard would blank out.
      s.value ->> 'tag_description_es',
      s.value ->> 'isolation_procedure_es',
      s.value ->> 'method_of_verification_es'
      from jsonb_array_elements(v.new_value -> 'steps') with ordinality as s(value, ord);

    update public.loto_equipment
       set placard_url = null, updated_at = now()
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

  -- facility_id is set explicitly (null) so its DEFAULT active_facility_id()
  -- does not fire: that helper parses request.headers, which only exists in a
  -- PostgREST request — naming the column keeps this RPC context-independent.
  insert into public.loto_hygiene_log (tenant_id, facility_id, equipment_id, action, section, reason, detail)
  values (
    v.tenant_id, null, v.equipment_id, 'audit_change_applied', 'audit',
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

-- ── 3. restore_audit_snapshot (re-emit; generalized step restore) ────────────
-- The equipment-restore loop is copied verbatim from migration 219. The step
-- restore is GENERALIZED: 219 restored steps with UPDATE-by-id, which cannot
-- undo a procedure_draft apply (that deletes the old rows and inserts new ones,
-- so the old ids no longer exist to UPDATE and the new ids aren't in the
-- snapshot). Instead, for each equipment in the snapshot we DELETE its current
-- steps and RE-INSERT every snapshot step row, preserving the original id — so
-- inserts, deletes, and edits all roll back. Idempotent: replaying yields the
-- same state.
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

  -- Generalized step restore. Delete the current steps for every equipment the
  -- snapshot covers, then re-insert every captured row verbatim (preserving id,
  -- created_at, etc. via jsonb_populate_record). This reverses procedure_draft
  -- inserts/deletes as well as in-place field edits.
  delete from public.loto_energy_steps s
   where s.tenant_id = v_tenant
     and s.equipment_id in (
       select distinct equipment_id from public.loto_audit_snapshot_steps where snapshot_id = p_snapshot_id
     );

  for r in
    select row from public.loto_audit_snapshot_steps where snapshot_id = p_snapshot_id
  loop
    insert into public.loto_energy_steps
    select * from jsonb_populate_record(null::public.loto_energy_steps, r.row);
    v_st_count := v_st_count + 1;
  end loop;

  -- facility_id set explicitly (null) — see note in apply_audit_change.
  insert into public.loto_hygiene_log (tenant_id, facility_id, equipment_id, action, section, reason, detail)
  values (
    v_tenant, null, null, 'snapshot', 'audit',
    'Emergency rollback: restored audit snapshot',
    jsonb_build_object('snapshot_id', p_snapshot_id, 'restored_by', p_restored_by,
                       'equipment_restored', v_eq_count, 'steps_restored', v_st_count)
  );

  return jsonb_build_object('equipment_restored', v_eq_count, 'steps_restored', v_st_count);
end;
$$;

-- ── Grants: service_role only (re-assert; the create-or-replace keeps prior
-- grants, but we re-state them so this migration is self-contained) ──────────
revoke all on function public.apply_audit_change(uuid, uuid)        from public, anon, authenticated;
revoke all on function public.restore_audit_snapshot(uuid, uuid)    from public, anon, authenticated;
grant execute on function public.apply_audit_change(uuid, uuid)     to service_role;
grant execute on function public.restore_audit_snapshot(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
