-- Migration 094: harden chemical SECURITY DEFINER + trigger functions.
--
-- Caught by Supabase's database linter after applying 082-093:
--
--   1. function_search_path_mutable (WARN) — every trigger function we
--      shipped lacked an explicit `SET search_path`, leaving the
--      function's resolution table mutable per session role. The
--      conventional fix is `SET search_path = public, pg_temp` so
--      schema-resolution can't be hijacked by a poisoned `search_path`.
--
--   2. {anon,authenticated}_security_definer_function_executable
--      (WARN) — SECURITY DEFINER functions are exposed through
--      PostgREST as `/rest/v1/rpc/<name>` and Supabase grants
--      EXECUTE to `anon` and `authenticated` by default. Trigger-only
--      functions shouldn't be reachable that way at all, and helper
--      RPCs we call from server code (chemical_next_barcode,
--      chemical_restricted_match) only need service-role execute.
--
-- Idempotent — REVOKEs no-op when the privilege is already absent;
-- function bodies use CREATE OR REPLACE.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Re-pin search_path on every chemical-module trigger / helper.
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.chemical_location_set_path()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
declare v_parent_path text;
begin
  if new.parent_id is null then
    new.path := new.name;
  else
    select path into v_parent_path from public.chemical_locations where id = new.parent_id;
    new.path := coalesce(v_parent_path, '') || ' / ' || new.name;
  end if;
  return new;
end $$;

create or replace function public.chemical_inv_before_update()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
begin
  if new.status = 'disposed' and old.status <> 'disposed' then
    if new.disposed_at is null then new.disposed_at := now(); end if;
  end if;
  if new.status = 'in_use' and old.status = 'in_stock' and new.opened_date is null then
    new.opened_date := current_date;
  end if;
  return new;
end $$;

create or replace function public.chemical_inv_approval_stamps()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    if new.status = 'requested' then
      if new.requested_at is null then new.requested_at := now(); end if;
      if new.requested_by is null then new.requested_by := new.created_by; end if;
    end if;
    return new;
  end if;
  if old.status = 'requested' and new.status <> 'requested' then
    if new.status = 'rejected' then
      null;
    else
      if new.approved_at is null then new.approved_at := now(); end if;
      if new.approved_by is null then new.approved_by := new.updated_by; end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.chemical_products_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    perform public.fire_webhooks('chemical.product_created', to_jsonb(NEW));
  elsif TG_OP = 'UPDATE' then
    if NEW.archived_at is not null and OLD.archived_at is null then
      perform public.fire_webhooks('chemical.product_archived',  to_jsonb(NEW));
    elsif NEW.archived_at is null and OLD.archived_at is not null then
      perform public.fire_webhooks('chemical.product_unarchived', to_jsonb(NEW));
    end if;
  end if;
  return NEW;
end $$;

create or replace function public.chemical_inv_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'requested' then
      perform public.fire_webhooks('chemical.container_requested', to_jsonb(NEW));
    end if;
  elsif TG_OP = 'UPDATE' then
    if OLD.status = 'requested' and NEW.status = 'in_stock' then
      perform public.fire_webhooks('chemical.container_approved', to_jsonb(NEW));
    elsif OLD.status = 'requested' and NEW.status = 'rejected' then
      perform public.fire_webhooks('chemical.container_rejected', to_jsonb(NEW));
    end if;
    if OLD.status <> 'disposed' and NEW.status = 'disposed' then
      perform public.fire_webhooks('chemical.container_disposed', to_jsonb(NEW));
    end if;
  end if;
  return NEW;
end $$;

create or replace function public.chemical_exposure_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    perform public.fire_webhooks('chemical.exposure_logged', to_jsonb(NEW));
  end if;
  return NEW;
end $$;

create or replace function public.chemical_sds_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT'
     and NEW.source = 'ai_fetch'
     and NEW.parse_review_status = 'pending' then
    perform public.fire_webhooks('chemical.sds_revision_pending', to_jsonb(NEW));
  end if;
  return NEW;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Revoke RPC EXECUTE on chemical SECURITY DEFINER functions.
-- ──────────────────────────────────────────────────────────────────────────
--
-- Trigger-only functions are never meant to be called via PostgREST.
-- Helper RPCs (chemical_next_barcode, chemical_restricted_match) are
-- invoked by server-side code via service-role, which bypasses these
-- grants. Revoking from anon + authenticated removes the
-- /rest/v1/rpc/<name> attack surface without breaking any callers.
--
-- public is implicitly granted to PUBLIC at function-create time on
-- Supabase, so we revoke from PUBLIC too to be safe; service_role
-- retains access since it has BYPASSRLS + the default-grant from
-- supabase's role bootstrapping.

revoke execute on function public.chemical_products_emit_webhooks()  from public, anon, authenticated;
revoke execute on function public.chemical_inv_emit_webhooks()       from public, anon, authenticated;
revoke execute on function public.chemical_exposure_emit_webhooks()  from public, anon, authenticated;
revoke execute on function public.chemical_sds_emit_webhooks()       from public, anon, authenticated;
revoke execute on function public.chemical_next_barcode(uuid)        from public, anon, authenticated;
revoke execute on function public.chemical_restricted_match(uuid, text, text[]) from public, anon, authenticated;

-- The two non-DEFINER trigger functions below also lose RPC execute
-- — they are trigger-only.
revoke execute on function public.chemical_location_set_path()    from public, anon, authenticated;
revoke execute on function public.chemical_inv_before_update()    from public, anon, authenticated;
revoke execute on function public.chemical_inv_approval_stamps()  from public, anon, authenticated;

notify pgrst, 'reload schema';
