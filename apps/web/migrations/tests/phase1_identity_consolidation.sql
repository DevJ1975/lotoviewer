-- Phase 1 identity consolidation — SQL tests.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     apps/web/migrations/tests/phase1_identity_consolidation.sql
--
-- The script wraps every test in a SAVEPOINT and ROLLBACKs to the
-- savepoint after each assertion so the database state is unchanged on
-- exit. Each test raises NOTICE on success and RAISE EXCEPTION on
-- failure (which aborts the whole script under ON_ERROR_STOP).
--
-- Requires migrations 180-185 to have been applied.

begin;

do $$
declare
  v_tenant_id  uuid := gen_random_uuid();
  v_member_id  uuid;
  v_worker_id  uuid;
  v_count      int;
begin
  -- Seed: tenant for the test run. Roll back at the end via the
  -- outer ROLLBACK so the row never persists.
  insert into public.tenants (id, slug, name)
  values (v_tenant_id, 'test-' || substr(replace(v_tenant_id::text, '-', ''), 1, 12), 'Phase1 Test Tenant');

  -- ────────────────────────────────────────────────────────────────
  -- TEST 1: loto_workers INSERT triggers a members row.
  -- ────────────────────────────────────────────────────────────────
  savepoint t1;
  insert into public.loto_workers (tenant_id, full_name, employee_id, active)
  values (v_tenant_id, 'Alice Test', 'EMP-001', true)
  returning id into v_worker_id;

  select count(*) into v_count
    from public.members
   where tenant_id = v_tenant_id
     and source = 'loto_worker'
     and source_id = v_worker_id;
  if v_count <> 1 then
    raise exception 'TEST 1 failed: expected 1 members row, got %', v_count;
  end if;
  raise notice 'TEST 1 ok: loto_workers INSERT synced to members';

  -- ────────────────────────────────────────────────────────────────
  -- TEST 2: loto_workers UPDATE propagates to members.legal_name.
  -- ────────────────────────────────────────────────────────────────
  update public.loto_workers set full_name = 'Alice Renamed' where id = v_worker_id;

  select id into v_member_id
    from public.members
   where source = 'loto_worker' and source_id = v_worker_id;

  perform 1
    from public.members
   where id = v_member_id and legal_name = 'Alice Renamed';
  if not found then
    raise exception 'TEST 2 failed: members.legal_name did not pick up the rename';
  end if;
  raise notice 'TEST 2 ok: loto_workers UPDATE synced to members';

  -- ────────────────────────────────────────────────────────────────
  -- TEST 3: members UPDATE does NOT recurse through the sync trigger.
  -- pg_trigger_depth() guard means the back-write produces depth=2
  -- on the loto_workers trigger and is skipped.
  -- ────────────────────────────────────────────────────────────────
  update public.members set notes = 'admin annotation' where id = v_member_id;
  -- If recursion happened we'd see exception or infinite loop;
  -- reaching here is the assertion.
  raise notice 'TEST 3 ok: members write did not loop through sync triggers';

  rollback to savepoint t1;

  -- ────────────────────────────────────────────────────────────────
  -- TEST 4: reconcile_members_backfill is idempotent.
  -- Second call returns inserted_count = 0.
  -- ────────────────────────────────────────────────────────────────
  savepoint t4;
  insert into public.loto_workers (tenant_id, full_name, active)
  values (v_tenant_id, 'Carol Test', true);

  -- Drop the synced members row to simulate drift, then reconcile.
  delete from public.members
   where tenant_id = v_tenant_id
     and source = 'loto_worker';

  select inserted_count into v_count
    from public.reconcile_members_backfill(v_tenant_id);
  if v_count < 1 then
    raise exception 'TEST 4a failed: first reconcile should insert >= 1, got %', v_count;
  end if;

  select inserted_count into v_count
    from public.reconcile_members_backfill(v_tenant_id);
  if v_count <> 0 then
    raise exception 'TEST 4b failed: second reconcile should insert 0, got %', v_count;
  end if;
  raise notice 'TEST 4 ok: reconcile_members_backfill is idempotent';
  rollback to savepoint t4;

  -- ────────────────────────────────────────────────────────────────
  -- TEST 5: audit_member_drift detects a manually-inserted
  -- loto_worker with no members row and clears on reconcile.
  -- ────────────────────────────────────────────────────────────────
  savepoint t5;
  insert into public.loto_workers (id, tenant_id, full_name, active)
  values (gen_random_uuid(), v_tenant_id, 'Drifty McDrift', true)
  returning id into v_worker_id;

  delete from public.members
   where tenant_id = v_tenant_id
     and source = 'loto_worker'
     and source_id = v_worker_id;

  perform public.audit_member_drift();

  select count(*) into v_count
    from public.member_drift_findings
   where tenant_id = v_tenant_id
     and surface = 'loto_workers'
     and surface_row_pk = v_worker_id
     and reconciled_at is null;
  if v_count <> 1 then
    raise exception 'TEST 5a failed: expected 1 open finding, got %', v_count;
  end if;

  perform public.reconcile_members_backfill(v_tenant_id);
  perform public.audit_member_drift();

  select count(*) into v_count
    from public.member_drift_findings
   where tenant_id = v_tenant_id
     and surface = 'loto_workers'
     and surface_row_pk = v_worker_id
     and reconciled_at is null;
  if v_count <> 0 then
    raise exception 'TEST 5b failed: finding should be reconciled, still % open', v_count;
  end if;
  raise notice 'TEST 5 ok: drift finding raised then reconciled';
  rollback to savepoint t5;

  -- ────────────────────────────────────────────────────────────────
  -- TEST 6: merge_members re-points supervisor_member_id and marks
  -- source as merged. Re-merging the same source raises.
  -- ────────────────────────────────────────────────────────────────
  savepoint t6;
  declare
    v_src uuid;
    v_tgt uuid;
    v_sup uuid;
  begin
    insert into public.members (tenant_id, source, display_name)
    values (v_tenant_id, 'manual', 'Source A') returning id into v_src;
    insert into public.members (tenant_id, source, display_name)
    values (v_tenant_id, 'manual', 'Target A') returning id into v_tgt;
    insert into public.members (tenant_id, source, display_name, supervisor_member_id)
    values (v_tenant_id, 'manual', 'Reports To Src', v_src) returning id into v_sup;

    perform public.merge_members(v_src, v_tgt, null, 'unit test');

    -- supervisor re-pointed
    perform 1 from public.members where id = v_sup and supervisor_member_id = v_tgt;
    if not found then
      raise exception 'TEST 6a failed: supervisor_member_id not re-pointed';
    end if;
    -- source marked merged
    perform 1 from public.members where id = v_src and status = 'merged' and merged_into_member_id = v_tgt;
    if not found then
      raise exception 'TEST 6b failed: source not marked merged';
    end if;
    -- member_merges row written
    perform 1 from public.member_merges where source_member_id = v_src and target_member_id = v_tgt;
    if not found then
      raise exception 'TEST 6c failed: member_merges audit row missing';
    end if;
    -- member_status_events 'merged' captured
    perform 1 from public.member_status_events
      where member_id = v_tgt and event_type = 'merged';
    if not found then
      raise exception 'TEST 6d failed: merged event not emitted';
    end if;

    -- Re-merging the already-merged source must raise.
    begin
      perform public.merge_members(v_src, v_tgt, null, 'retry');
      raise exception 'TEST 6e failed: re-merge should have raised';
    exception when others then
      if sqlerrm not ilike '%already merged%' then
        raise exception 'TEST 6e failed: expected "already merged" error, got: %', sqlerrm;
      end if;
    end;
    raise notice 'TEST 6 ok: merge_members re-points + locks + re-merge guarded';
  end;
  rollback to savepoint t6;

  -- ────────────────────────────────────────────────────────────────
  -- TEST 7: merge_members refuses when both sides have profile_id.
  -- ────────────────────────────────────────────────────────────────
  savepoint t7;
  declare
    v_src uuid;
    v_tgt uuid;
    v_u1  uuid := gen_random_uuid();
    v_u2  uuid := gen_random_uuid();
  begin
    -- Create two synthetic auth.users rows + profiles to satisfy the
    -- members.profile_id FK. auth.users insert requires the SECURITY
    -- DEFINER admin path normally, but in a SQL script we can insert
    -- directly because the test runs as the migration user.
    insert into auth.users (id, email) values (v_u1, 't1@test'), (v_u2, 't2@test')
      on conflict (id) do nothing;
    insert into public.profiles (id, email) values (v_u1, 't1@test'), (v_u2, 't2@test')
      on conflict (id) do nothing;

    insert into public.members (tenant_id, source, profile_id, display_name)
    values (v_tenant_id, 'profile', v_u1, 'Dup A') returning id into v_src;
    insert into public.members (tenant_id, source, profile_id, display_name)
    values (v_tenant_id, 'profile', v_u2, 'Dup B') returning id into v_tgt;

    begin
      perform public.merge_members(v_src, v_tgt, null, 'unit test');
      raise exception 'TEST 7 failed: merge should have refused (both have profile_id)';
    exception when others then
      if sqlerrm not ilike '%both members have login%' then
        raise exception 'TEST 7 failed: expected both-have-login error, got: %', sqlerrm;
      end if;
    end;
    raise notice 'TEST 7 ok: dual-profile merge refused';
  end;
  rollback to savepoint t7;
end $$;

rollback;

\echo 'All Phase 1 SQL tests passed.'
