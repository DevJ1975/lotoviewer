-- Migration 222: LOTO audit — enforce "no approval ⇒ no write" IN THE DATABASE.
--
-- A Fable 5 security audit of the audit system found the safety contract was
-- enforced in comments and client-side buttons, not the database:
--
--   • (B-C1) Every audit/staging/snapshot policy was `for all to authenticated`
--     with only a tenant predicate, and no migration revoked PostgREST's default
--     write grants — so ANY tenant member (even a viewer) could
--     `update loto_audit_changes set status='approved'` and forge an approval,
--     or tamper with snapshots unlogged.
--   • (B-C2) apply_approved_audit_changes never checked the run's status nor
--     that the bound review link was actually signed off — the only "gate" was
--     a client-side button.
--   • (B-C3) restore_audit_snapshot scoped its step DELETE to machines that HAD
--     snapshot step rows — a procedure_draft applied to a zero-step machine
--     survived "rollback".
--
-- This migration closes all three:
--   1. Audit tables become SELECT-only for authenticated (service_role bypasses
--      RLS and role grants; it remains the only writer — which is already how
--      every legitimate write flows: the engine, the admin API, and the
--      token-validated reviewer routes all use the service-role client).
--   2. log_audit triggers on the snapshot tables (218 covered runs + changes).
--   3. apply_approved_audit_changes PROVES, inside the transaction: run status
--      ∈ (awaiting_review, partially_applied); the bound review link exists, is
--      not revoked, and was signed off WITH approval; and each change's
--      approval predates the sign-off (an approval the reviewer never attested
--      is skipped and marked, not silently applied).
--   4. restore_audit_snapshot deletes steps for EVERY captured machine (driven
--      by snapshot_equipment, not snapshot_steps) and reports per-table
--      restored/missed counts so a partial restore is visible, not assumed.

begin;

-- ── 1. SELECT-only RLS + write revokes on all six audit tables ───────────────
-- The tenant-scope predicate is unchanged (mirrors migration 134); only the
-- verb narrows: `for all` → `for select`. Belt and braces: RLS narrows the
-- policy, REVOKE removes PostgREST's default table grants — either alone
-- blocks the write, together they survive a future policy or grant slip.

drop policy if exists loto_audit_runs_tenant_scope on public.loto_audit_runs;
create policy loto_audit_runs_tenant_scope on public.loto_audit_runs
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists loto_audit_results_tenant_scope on public.loto_audit_equipment_results;
create policy loto_audit_results_tenant_scope on public.loto_audit_equipment_results
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists loto_audit_changes_tenant_scope on public.loto_audit_changes;
create policy loto_audit_changes_tenant_scope on public.loto_audit_changes
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists loto_audit_snapshots_tenant_scope on public.loto_audit_snapshots;
create policy loto_audit_snapshots_tenant_scope on public.loto_audit_snapshots
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists loto_audit_snapshot_equipment_tenant_scope on public.loto_audit_snapshot_equipment;
create policy loto_audit_snapshot_equipment_tenant_scope on public.loto_audit_snapshot_equipment
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists loto_audit_snapshot_steps_tenant_scope on public.loto_audit_snapshot_steps;
create policy loto_audit_snapshot_steps_tenant_scope on public.loto_audit_snapshot_steps
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

revoke insert, update, delete on public.loto_audit_runs               from anon, authenticated;
revoke insert, update, delete on public.loto_audit_equipment_results  from anon, authenticated;
revoke insert, update, delete on public.loto_audit_changes            from anon, authenticated;
revoke insert, update, delete on public.loto_audit_snapshots          from anon, authenticated;
revoke insert, update, delete on public.loto_audit_snapshot_equipment from anon, authenticated;
revoke insert, update, delete on public.loto_audit_snapshot_steps     from anon, authenticated;

-- ── 2. Audit-log the snapshot tables (the rollback save points) ──────────────
drop trigger if exists trg_audit_loto_audit_snapshots on public.loto_audit_snapshots;
create trigger trg_audit_loto_audit_snapshots
  after insert or update or delete on public.loto_audit_snapshots
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_loto_audit_snapshot_equipment on public.loto_audit_snapshot_equipment;
create trigger trg_audit_loto_audit_snapshot_equipment
  after insert or update or delete on public.loto_audit_snapshot_equipment
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_loto_audit_snapshot_steps on public.loto_audit_snapshot_steps;
create trigger trg_audit_loto_audit_snapshot_steps
  after insert or update or delete on public.loto_audit_snapshot_steps
  for each row execute function public.log_audit('id');

-- ── 3. apply_approved_audit_changes — prove the sign-off, in-transaction ─────
-- Re-emit of migration 219's function. The per-change loop and the run-status
-- bookkeeping are unchanged; what's new is the gate at the top (run status,
-- review link signed off + approved + not revoked) and the attestation window
-- on each change (decided_at must exist and predate the sign-off — the
-- reviewer can only have attested decisions that existed when they signed).
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
  v_run     public.loto_audit_runs%rowtype;
  v_link    public.loto_review_links%rowtype;
  v_id      uuid;
  v_applied integer := 0;
begin
  select * into v_run from public.loto_audit_runs where id = p_run_id for update;
  if not found then raise exception 'audit run not found'; end if;
  if v_run.status not in ('awaiting_review', 'partially_applied') then
    raise exception 'audit run is ''%'' — only awaiting_review / partially_applied runs can be applied', v_run.status;
  end if;
  if v_run.review_link_id is null then
    raise exception 'audit run has no review link — no approval, no write';
  end if;

  select * into v_link from public.loto_review_links where id = v_run.review_link_id;
  if not found then raise exception 'review link for audit run not found'; end if;
  if v_link.revoked_at is not null then
    raise exception 'review link was revoked — re-mint and re-review before applying';
  end if;
  if v_link.signed_off_at is null or v_link.signoff_approved is distinct from true then
    raise exception 'review link is not signed off with approval — no approval, no write';
  end if;

  if not exists (select 1 from public.loto_audit_snapshots where run_id = p_run_id) then
    raise exception 'no snapshot for run % — call capture_audit_snapshot first', p_run_id;
  end if;

  for v_id in
    select id from public.loto_audit_changes
     where run_id = p_run_id and status = 'approved'
       and decided_at is not null
       and decided_at <= v_link.signed_off_at
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

  -- An approval outside the attestation window (decided after — or without —
  -- the reviewer's sign-off) is left unapplied and labelled, never silent.
  update public.loto_audit_changes
     set apply_error = 'not applied: approval is not covered by the reviewer sign-off'
   where run_id = p_run_id and status = 'approved'
     and (decided_at is null or decided_at > v_link.signed_off_at);

  if exists (select 1 from public.loto_audit_changes where run_id = p_run_id and status = 'approved') then
    update public.loto_audit_runs set status = 'partially_applied', finished_at = now() where id = p_run_id;
  else
    update public.loto_audit_runs set status = 'applied', finished_at = now() where id = p_run_id;
  end if;

  return v_applied;
end;
$$;

-- ── 4. restore_audit_snapshot — provably total ────────────────────────────────
-- Re-emit of migration 220's function with two fixes:
--   • The step DELETE is driven by loto_audit_snapshot_EQUIPMENT — every machine
--     the apply could have touched — not snapshot_steps. 220's scope skipped
--     machines that had ZERO steps at capture, so a procedure_draft applied to
--     one of those survived "rollback".
--   • Per-table missed counts: an equipment row that no longer exists can't be
--     UPDATE-restored; report it instead of counting it restored.
-- The equipment-restore column list and the jsonb_populate_record re-insert are
-- unchanged from 220 (the populated record carries the table's own row type, so
-- the insert is type-aligned by construction).
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
  v_tenant    uuid;
  v_eq_count  integer := 0;
  v_eq_missed integer := 0;
  v_st_count  integer := 0;
  v_rows      integer;
  r           record;
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
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_eq_count := v_eq_count + 1; else v_eq_missed := v_eq_missed + 1; end if;
  end loop;

  -- Total step restore: clear steps for EVERY captured machine (including
  -- machines that had zero steps at capture — a procedure_draft may have
  -- inserted rows there), then re-insert every captured row verbatim
  -- (preserving id, created_at, etc. via jsonb_populate_record).
  delete from public.loto_energy_steps s
   where s.tenant_id = v_tenant
     and s.equipment_id in (
       select equipment_id from public.loto_audit_snapshot_equipment where snapshot_id = p_snapshot_id
       union
       select equipment_id from public.loto_audit_snapshot_steps     where snapshot_id = p_snapshot_id
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
                       'equipment_restored', v_eq_count, 'equipment_missed', v_eq_missed,
                       'steps_restored', v_st_count)
  );

  return jsonb_build_object(
    'equipment_restored', v_eq_count,
    'equipment_missed',   v_eq_missed,
    'steps_restored',     v_st_count
  );
end;
$$;

-- ── Grants: service_role only (re-assert; self-contained, as 219/220 do) ─────
revoke all on function public.apply_approved_audit_changes(uuid, uuid) from public, anon, authenticated;
revoke all on function public.restore_audit_snapshot(uuid, uuid)       from public, anon, authenticated;
grant execute on function public.apply_approved_audit_changes(uuid, uuid) to service_role;
grant execute on function public.restore_audit_snapshot(uuid, uuid)       to service_role;

notify pgrst, 'reload schema';

commit;
