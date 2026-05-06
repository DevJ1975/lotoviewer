-- Migration 053: auto-cancel CS permit on a failing atmospheric test.
--
-- §1910.146(e)(5) — entry must be terminated when prohibited conditions
-- are detected. The KB at lib/support/kb/confined-spaces.md has long
-- documented this as automatic, but the cancel-on-fail logic was
-- never coded. Until today the supervisor had to spot the failed
-- reading on the live status board and click Cancel manually. That's
-- a real safety gap — a worker could enter against a fail until a
-- supervisor noticed.
--
-- This trigger fires AFTER INSERT on loto_atmospheric_tests:
--   1. Looks up the permit + space.
--   2. Resolves effective thresholds with the same priority as
--      packages/core/src/confinedSpaceThresholds.ts:
--          permit.acceptable_conditions_override
--        > space.acceptable_conditions
--        > site defaults (O2 19.5-23.5%, LEL <10%, H2S <10ppm, CO <35ppm)
--   3. Evaluates the test channels. A FAIL on ANY channel triggers
--      the auto-cancel; UNKNOWN (channel not measured) does not.
--   4. If the permit is currently active (signed AND not canceled
--      AND not expired) and any channel failed, sets:
--          canceled_at   = now()
--          cancel_reason = 'prohibited_condition'
--          cancel_notes  = '<context summary>'
--
-- SECURITY DEFINER so the trigger can update the permit row even if
-- the inserter (a tenant member without write permission on the
-- specific permit) wouldn't normally be allowed to UPDATE it.
-- search_path is locked to public, pg_temp.

begin;

create or replace function public.cs_atmospheric_auto_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_permit_canceled_at  timestamptz;
  v_permit_signed_at    timestamptz;
  v_permit_expires_at   timestamptz;
  v_permit_space_id     text;
  v_space_conditions    jsonb;
  v_permit_override     jsonb;
  v_o2_min  numeric := 19.5;
  v_o2_max  numeric := 23.5;
  v_lel_max numeric := 10;
  v_h2s_max numeric := 10;
  v_co_max  numeric := 35;
  v_fails   text[] := '{}';
  v_summary text;
begin
  select canceled_at, entry_supervisor_signature_at, expires_at, space_id, acceptable_conditions_override
    into v_permit_canceled_at, v_permit_signed_at, v_permit_expires_at, v_permit_space_id, v_permit_override
    from public.loto_confined_space_permits
   where id = new.permit_id;
  if not found then return new; end if;

  -- Skip when the permit isn't currently active.
  if v_permit_canceled_at is not null then return new; end if;
  if v_permit_signed_at  is null    then return new; end if;
  if v_permit_expires_at < now()    then return new; end if;

  -- Pull space-level defaults.
  select acceptable_conditions into v_space_conditions
    from public.loto_confined_spaces
   where space_id = v_permit_space_id;

  -- Resolve thresholds: permit override > space override > site defaults.
  v_o2_min  := coalesce(
    nullif(v_permit_override ->> 'o2_min',  '')::numeric,
    nullif(v_space_conditions ->> 'o2_min', '')::numeric,
    v_o2_min
  );
  v_o2_max  := coalesce(
    nullif(v_permit_override ->> 'o2_max',  '')::numeric,
    nullif(v_space_conditions ->> 'o2_max', '')::numeric,
    v_o2_max
  );
  v_lel_max := coalesce(
    nullif(v_permit_override ->> 'lel_max', '')::numeric,
    nullif(v_space_conditions ->> 'lel_max','')::numeric,
    v_lel_max
  );
  v_h2s_max := coalesce(
    nullif(v_permit_override ->> 'h2s_max', '')::numeric,
    nullif(v_space_conditions ->> 'h2s_max','')::numeric,
    v_h2s_max
  );
  v_co_max  := coalesce(
    nullif(v_permit_override ->> 'co_max',  '')::numeric,
    nullif(v_space_conditions ->> 'co_max', '')::numeric,
    v_co_max
  );

  -- Evaluate channels. Match the JS evaluateChannel logic exactly:
  -- a missing value (null) is unknown, never fail.
  if new.o2_pct  is not null and (new.o2_pct < v_o2_min or new.o2_pct > v_o2_max) then
    v_fails := array_append(v_fails, format('O2 %.1f%% (range %s-%s)', new.o2_pct, v_o2_min, v_o2_max));
  end if;
  if new.lel_pct is not null and new.lel_pct > v_lel_max then
    v_fails := array_append(v_fails, format('LEL %.1f%% (max %s)', new.lel_pct, v_lel_max));
  end if;
  if new.h2s_ppm is not null and new.h2s_ppm > v_h2s_max then
    v_fails := array_append(v_fails, format('H2S %s ppm (max %s)', new.h2s_ppm, v_h2s_max));
  end if;
  if new.co_ppm  is not null and new.co_ppm  > v_co_max  then
    v_fails := array_append(v_fails, format('CO %s ppm (max %s)',  new.co_ppm,  v_co_max));
  end if;

  if array_length(v_fails, 1) is null then
    return new;  -- pass — leave permit alone
  end if;

  -- FAIL: auto-cancel.
  v_summary := format(
    'Auto-canceled by %s atmospheric test at %s. Failures: %s.',
    new.kind,
    to_char(new.tested_at, 'YYYY-MM-DD HH24:MI'),
    array_to_string(v_fails, '; ')
  );

  update public.loto_confined_space_permits
     set canceled_at   = now(),
         cancel_reason = 'prohibited_condition',
         cancel_notes  = v_summary
   where id = new.permit_id
     and canceled_at is null;

  return new;
end;
$$;

revoke all on function public.cs_atmospheric_auto_cancel() from public;

drop trigger if exists trg_cs_atmospheric_auto_cancel on public.loto_atmospheric_tests;
create trigger trg_cs_atmospheric_auto_cancel
  after insert on public.loto_atmospheric_tests
  for each row execute function public.cs_atmospheric_auto_cancel();

comment on function public.cs_atmospheric_auto_cancel() is
  'AFTER INSERT trigger on loto_atmospheric_tests. If the new reading fails any channel against effective thresholds (permit override > space override > site defaults), auto-cancels the permit with reason ''prohibited_condition'' per 29 CFR 1910.146(e)(5). SECURITY DEFINER so the cancel UPDATE bypasses RLS write policy on permits.';

notify pgrst, 'reload schema';

commit;
