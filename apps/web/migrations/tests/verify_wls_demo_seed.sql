-- Verification test for the WLS Demo seed (migration 199 + the
-- seed_wls_incidents_demo / seed_wls_near_miss_demo / seed_wls_bbs_demo
-- functions). Asserts that the seed reconciles with the EHS scorecard.
--
-- Usage (run AFTER the seed has been applied — migration 199 self-seeds on
-- apply, or run Reset Demo / the seed_*.sql wrappers first):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     apps/web/migrations/tests/verify_wls_demo_seed.sql
--
-- READ-ONLY: the whole script runs in a transaction that ROLLBACKs at the
-- end and performs no writes, so it is safe to run against any database,
-- including production. Each check RAISE EXCEPTIONs on mismatch (aborting
-- under ON_ERROR_STOP) and RAISE NOTICEs on success.
--
-- Hard assertions are scoped to the deterministic seed rows (by
-- report_number / id prefix) so they don't false-fail on a demo tenant
-- that also carries ad-hoc data. The tenant-wide scorecard values (TRIR,
-- ratio, etc.) are printed as NOTICEs for eyeballing — those assume a
-- freshly-reset demo tenant to match the documented targets exactly.
--
-- Expected reconciliation:
--   3 recordables (DEMO1 days_away, DEMO6 other_recordable, DEMO8 restricted)
--   10 investigations across all 4 RCA methods (2 of 3 recordables completed → RCA 67%)
--   6 near-miss incidents · 7 dedicated near-miss reports · 8 BBS observations · 4 QR locations
--   current-year 300A: 3 recordables, 96,720 hours → TRIR ≈ 6.2

begin;

do $$
declare
  v_tid    uuid;
  v_year   int := extract(year from now())::int;
  v_n      int;
  v_hours  numeric;
  v_rec    int;
  v_nm     int;
  v_trir   numeric;
  v_ratio  numeric;
begin
  -- Resolve the demo tenant exactly as the seed functions do.
  select id into v_tid
    from public.tenants
   where coalesce(is_demo, false) = true
   order by created_at asc
   limit 1;
  if v_tid is null then
    raise exception 'verify: no is_demo=true tenant found — seed has not been applied';
  end if;
  raise notice 'verify: demo tenant = %', v_tid;

  -- ── 1. Three recordable incidents, correctly classified ──────────────
  select count(*) into v_n
    from public.incidents i
    join public.incident_classifications c on c.incident_id = i.id
   where i.tenant_id = v_tid
     and c.meets_recording_criteria = true
     and i.report_number = any (array['INC-2026-DEMO1','INC-2025-DEMO6','INC-2026-DEMO8']);
  if v_n <> 3 then
    raise exception 'CHECK 1 failed: expected 3 seeded recordables, got %', v_n;
  end if;

  perform 1 from public.incidents i join public.incident_classifications c on c.incident_id = i.id
   where i.tenant_id = v_tid and i.report_number = 'INC-2026-DEMO1' and c.classification = 'days_away';
  if not found then raise exception 'CHECK 1 failed: DEMO1 not classified days_away'; end if;
  perform 1 from public.incidents i join public.incident_classifications c on c.incident_id = i.id
   where i.tenant_id = v_tid and i.report_number = 'INC-2026-DEMO8' and c.classification = 'restricted';
  if not found then raise exception 'CHECK 1 failed: DEMO8 not classified restricted'; end if;
  raise notice 'CHECK 1 ok: 3 recordables (days_away + other_recordable + restricted)';

  -- ── 2. Ten investigations on the seeded incidents ────────────────────
  select count(*) into v_n
    from public.incident_investigations iv
    join public.incidents i on i.id = iv.incident_id
   where i.tenant_id = v_tid and i.report_number like 'INC-%DEMO%';
  if v_n <> 10 then
    raise exception 'CHECK 2 failed: expected 10 investigations, got %', v_n;
  end if;
  raise notice 'CHECK 2 ok: 10 investigations';

  -- ── 3. All four RCA methods exercised ────────────────────────────────
  select count(distinct iv.rca_method) into v_n
    from public.incident_investigations iv
    join public.incidents i on i.id = iv.incident_id
   where i.tenant_id = v_tid and i.report_number like 'INC-%DEMO%'
     and iv.rca_method in ('5_whys','fishbone','taproot','icam');
  if v_n <> 4 then
    raise exception 'CHECK 3 failed: expected all 4 RCA methods, got %', v_n;
  end if;
  raise notice 'CHECK 3 ok: all 4 RCA methods (5_whys/fishbone/taproot/icam)';

  -- ── 4. RCA completion on recordables = 2 of 3 (DEMO1 left open) ───────
  select count(*) into v_n
    from public.incident_investigations iv
    join public.incidents i on i.id = iv.incident_id
    join public.incident_classifications c on c.incident_id = i.id
   where i.tenant_id = v_tid
     and c.meets_recording_criteria = true
     and iv.completed_at is not null
     and i.report_number = any (array['INC-2026-DEMO1','INC-2025-DEMO6','INC-2026-DEMO8']);
  if v_n <> 2 then
    raise exception 'CHECK 4 failed: expected 2 completed RCAs on recordables, got %', v_n;
  end if;
  raise notice 'CHECK 4 ok: RCA completion 2/3 ≈ 67%%';

  -- ── 5. Six near-miss incidents ───────────────────────────────────────
  select count(*) into v_n
    from public.incidents
   where tenant_id = v_tid and incident_type = 'near_miss' and report_number like 'INC-%DEMO%';
  if v_n <> 6 then
    raise exception 'CHECK 5 failed: expected 6 near-miss incidents, got %', v_n;
  end if;
  raise notice 'CHECK 5 ok: 6 near-miss incidents';

  -- ── 6. Seven dedicated near-miss reports ─────────────────────────────
  select count(*) into v_n
    from public.near_misses
   where tenant_id = v_tid and report_number like 'NM-2026-DEMO%';
  if v_n <> 7 then
    raise exception 'CHECK 6 failed: expected 7 near-miss reports, got %', v_n;
  end if;
  raise notice 'CHECK 6 ok: 7 dedicated near-miss reports';

  -- ── 7. BBS: 8 observations + 4 QR locations ──────────────────────────
  select count(*) into v_n from public.bbs_observations
   where tenant_id = v_tid and id::text like '22222222-bbbb-cccc-eeee-%';
  if v_n <> 8 then
    raise exception 'CHECK 7 failed: expected 8 BBS observations, got %', v_n;
  end if;
  select count(*) into v_n from public.bbs_qr_locations
   where tenant_id = v_tid and id::text like '22222222-bbbb-cccc-dddd-%';
  if v_n <> 4 then
    raise exception 'CHECK 7 failed: expected 4 BBS QR locations, got %', v_n;
  end if;
  raise notice 'CHECK 7 ok: 8 BBS observations + 4 QR locations';

  -- ── 8. Current-year 300A summary = 3 recordables, 96,720 hours ───────
  select coalesce(sum(
           (totals_json->>'total_days_away')::int
         + (totals_json->>'total_restricted')::int
         + (totals_json->>'total_other_recordable')::int), 0),
         coalesce(sum(total_hours_worked), 0)
    into v_n, v_hours
    from public.osha_annual_summaries
   where tenant_id = v_tid and year = v_year;
  if v_n <> 3 then
    raise exception 'CHECK 8 failed: 300A recordables for % = %, expected 3', v_year, v_n;
  end if;
  if v_hours <> 96720 then
    raise exception 'CHECK 8 failed: 300A hours = %, expected 96720', v_hours;
  end if;
  raise notice 'CHECK 8 ok: 300A summary = 3 recordables, 96720 hours';

  -- ── Informational: tenant-wide scorecard values (eyeball vs targets) ──
  select count(*) into v_rec
    from public.incidents i join public.incident_classifications c on c.incident_id = i.id
   where i.tenant_id = v_tid and c.meets_recording_criteria = true
     and i.occurred_at >= now() - interval '365 days';
  select count(*) into v_nm
    from public.incidents
   where tenant_id = v_tid and incident_type = 'near_miss'
     and occurred_at >= now() - interval '365 days';
  select coalesce(sum((hours_employees_by_year->v_year::text->>'hours')::numeric), 0) into v_hours
    from public.osha_establishments where tenant_id = v_tid;
  v_trir  := round(v_rec * 200000.0 / nullif(v_hours, 0), 2);
  v_ratio := round(v_nm::numeric / nullif(v_rec, 0), 2);
  raise notice 'scorecard (tenant-wide, 365d): recordables=% near_miss=% hours=% → TRIR=% near-miss:recordable=%',
    v_rec, v_nm, v_hours, v_trir, v_ratio;
  raise notice 'targets on a freshly-reset demo: recordables=3 TRIR≈6.20 ratio≈2.00';

  raise notice 'verify: ALL CHECKS PASSED';
end $$;

rollback;
