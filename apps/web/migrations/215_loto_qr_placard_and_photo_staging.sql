-- Migration 215: public QR placard route + reviewer photo staging/reconcile.
--
-- Two features land together because they share the LOTO review surface:
--
-- 1. PUBLIC QR PLACARD (`/qr/{qr_token}`). A worker scans the printed
--    placard QR and sees that machine's LOTO info with no login. The page
--    must NOT use the service key client-side and must NOT weaken RLS, so
--    reads flow through a single SECURITY DEFINER RPC (`get_placard_by_qr`)
--    granted to anon. It returns only display-safe columns for a
--    non-decommissioned row, plus the ordered energy steps, and logs the
--    resolved scan to `loto_placard_scan_log`.
--
--    NOTE on the audit table: the handoff named `qr_token_audit_log`, but
--    that table belongs to the incident QR-token subsystem — `token_id` is
--    a NOT NULL uuid, `tenant_id` is FK-constrained, and a CHECK pins
--    `event_type` to token-lifecycle verbs (no "scan"); it has no
--    equipment_id / ip / user_agent columns. Rather than rename/alter an
--    unrelated subsystem (forbidden by the handoff) we add a purpose-built
--    `loto_placard_scan_log` with exactly the fields the scan needs.
--
-- 2. PHOTO STAGING + RECONCILE. The existing reviewer "replace photo" flow
--    wrote straight into `loto_equipment` (the old
--    `apply_loto_review_photo_replacement` mutated the row in the same
--    call — and referenced a now-absent `signed_placard_url` column, so it
--    erred at runtime anyway). The client wants replacements *staged* and
--    *swapped at the end*: reviewers never touch `loto_equipment`. We
--    repurpose the existing `loto_review_photo_replacements` table as the
--    staging table (it already has the right shape) and add a status
--    lifecycle (pending → applied|rejected). Reconcile is idempotent and
--    runs either on sign-off or from the admin "Apply photo replacements"
--    action.
--
-- Idempotent throughout: `create table/index if not exists`, `add column
-- if not exists`, `create or replace function`. The energy-step TEXT
-- fields are read-only here — the printed packet is checksum-verified
-- against them, so nothing in this migration writes loto_energy_steps.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- Feature 1 — public QR placard
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.loto_placard_scan_log (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  equipment_id text not null,
  qr_token     text not null,
  ip           text,
  user_agent   text,
  scanned_at   timestamptz not null default now()
);

create index if not exists idx_loto_placard_scan_log_tenant_eq
  on public.loto_placard_scan_log (tenant_id, equipment_id, scanned_at desc);
create index if not exists idx_loto_placard_scan_log_token
  on public.loto_placard_scan_log (qr_token, scanned_at desc);

comment on table public.loto_placard_scan_log is
  'One row per resolved public placard QR scan (/qr/{qr_token}). Written only via get_placard_by_qr (SECURITY DEFINER); reads are tenant-scoped.';

alter table public.loto_placard_scan_log enable row level security;

-- Reads: tenant members see their own tenant's scan activity (future admin
-- view). Writes happen solely through the SECURITY DEFINER RPC below, which
-- bypasses RLS — so no INSERT policy is granted to anon/authenticated.
drop policy if exists loto_placard_scan_log_tenant_select on public.loto_placard_scan_log;
create policy loto_placard_scan_log_tenant_select on public.loto_placard_scan_log
  for select to authenticated
  using (public.active_tenant_id() is null or tenant_id = public.active_tenant_id());

-- get_placard_by_qr — the only public read path. SECURITY DEFINER so anon
-- can resolve a token without any table grants and without RLS being
-- loosened. Returns NULL for unknown / decommissioned tokens (the page
-- renders "Placard not found"); only resolved scans are logged.
create or replace function public.get_placard_by_qr(
  p_token      text,
  p_ip         text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_eq     public.loto_equipment%rowtype;
  v_result jsonb;
begin
  -- Cheap reject: qr_token is a 16-char lowercase hex string.
  if p_token is null or p_token !~ '^[0-9a-f]{16}$' then
    return null;
  end if;

  select * into v_eq
    from public.loto_equipment
   where qr_token = p_token
     and decommissioned = false
   limit 1;

  if not found then
    return null;
  end if;

  -- Log the resolved scan. The write is intentional: each scan is an
  -- auditable event. Empty header strings collapse to NULL.
  insert into public.loto_placard_scan_log (tenant_id, equipment_id, qr_token, ip, user_agent)
  values (v_eq.tenant_id, v_eq.equipment_id, p_token, nullif(p_ip, ''), nullif(p_user_agent, ''));

  select jsonb_build_object(
    'equipment_id',    v_eq.equipment_id,
    'description',     v_eq.description,
    'department',      v_eq.department,
    'iso_photo_url',   v_eq.iso_photo_url,
    'equip_photo_url', v_eq.equip_photo_url,
    'iso_annotations', coalesce(v_eq.iso_annotations, '[]'::jsonb),
    'verified',        v_eq.verified,
    'verified_date',   v_eq.verified_date,
    'energy_steps', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'energy_type',            s.energy_type,
          'tag_description',        s.tag_description,
          'isolation_procedure',    s.isolation_procedure,
          'method_of_verification', s.method_of_verification
        )
        order by s.sequence_order nulls last, s.step_number, s.energy_type
      )
      from public.loto_energy_steps s
      where s.tenant_id = v_eq.tenant_id
        and s.equipment_id = v_eq.equipment_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_placard_by_qr(text, text, text) from public;
grant execute on function public.get_placard_by_qr(text, text, text) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Feature 2 — reviewer photo staging + reconcile
-- ─────────────────────────────────────────────────────────────────────────

-- Promote loto_review_photo_replacements from an applied-replacements log to
-- a staging table with an explicit lifecycle.
alter table public.loto_review_photo_replacements
  add column if not exists status          text not null default 'pending'
    check (status in ('pending', 'applied', 'rejected')),
  add column if not exists applied_at      timestamptz,
  add column if not exists applied_by      uuid,
  add column if not exists rejected_reason text;

-- Historic rows predate staging: the old RPC mutated loto_equipment in the
-- same call, so every existing row was already applied. Mark them so the
-- reconcile queue starts empty and the pending-unique index has nothing to
-- collide with.
update public.loto_review_photo_replacements
   set status     = 'applied',
       applied_at = coalesce(applied_at, replaced_at)
 where status = 'pending';

-- One pending replacement per (review, equipment, slot). Applied/rejected
-- rows are history and don't participate, so the index is partial.
create unique index if not exists uq_review_photo_pending_slot
  on public.loto_review_photo_replacements (review_link_id, equipment_id, slot)
  where status = 'pending';

create index if not exists idx_review_photo_pending_link
  on public.loto_review_photo_replacements (review_link_id)
  where status = 'pending';

comment on column public.loto_review_photo_replacements.status is
  'pending = staged, awaiting reconcile; applied = swapped into loto_equipment; rejected = discarded (staged file kept 30d for the cleanup cron).';

-- Retire the immediate-apply RPC. It mutated loto_equipment in the same
-- call (the exact behaviour the staging model forbids) and referenced a
-- since-removed `signed_placard_url` column, so it erred at runtime anyway.
-- The review API now calls stage_loto_review_photo_replacement instead.
drop function if exists public.apply_loto_review_photo_replacement(uuid, text, text, text, text, text, text);

-- stage_loto_review_photo_replacement — replaces the immediate-apply RPC.
-- Records a staged replacement and DOES NOT touch loto_equipment. Returns
-- the storage path of any superseded pending row so the caller can delete
-- the orphaned object. Called only via the service-role review API.
create or replace function public.stage_loto_review_photo_replacement(
  p_review_link_id   uuid,
  p_equipment_id     text,
  p_slot             text,
  p_new_photo_url    text,
  p_storage_path     text,
  p_replaced_by_name text default null,
  p_ip               text default null,
  p_user_agent       text default null
)
returns table (superseded_storage_path text)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_link      public.loto_review_links%rowtype;
  v_equipment public.loto_equipment%rowtype;
  v_old_url   text;
  v_superseded text;
begin
  select * into v_link from public.loto_review_links where id = p_review_link_id for update;
  if not found then raise exception 'review link not found'; end if;
  if v_link.signed_off_at is not null then raise exception 'review already signed off'; end if;
  if p_slot not in ('EQUIP', 'ISO') then raise exception 'invalid photo slot'; end if;

  -- Batch membership: per-reviewer links pin a snapshot; public floor-walk
  -- links cover every active equipment row in the tenant.
  if v_link.is_public then
    select * into v_equipment from public.loto_equipment
      where tenant_id = v_link.tenant_id and equipment_id = p_equipment_id and decommissioned = false
      for update;
    if not found then raise exception 'equipment not found'; end if;
  else
    if not exists (
      select 1 from public.loto_review_link_equipment
       where review_link_id = p_review_link_id and equipment_id = p_equipment_id
    ) then
      raise exception 'equipment not in this review batch';
    end if;
    select * into v_equipment from public.loto_equipment
      where tenant_id = v_link.tenant_id and equipment_id = p_equipment_id
      for update;
    if not found then raise exception 'equipment not found'; end if;
  end if;

  v_old_url := case when p_slot = 'EQUIP' then v_equipment.equip_photo_url else v_equipment.iso_photo_url end;

  -- One pending row per slot: supersede the prior pending row (if any) and
  -- hand its storage path back for object cleanup.
  select storage_path into v_superseded
    from public.loto_review_photo_replacements
   where review_link_id = p_review_link_id and equipment_id = p_equipment_id
     and slot = p_slot and status = 'pending'
   limit 1;

  delete from public.loto_review_photo_replacements
   where review_link_id = p_review_link_id and equipment_id = p_equipment_id
     and slot = p_slot and status = 'pending';

  insert into public.loto_review_photo_replacements (
    review_link_id, tenant_id, equipment_id, slot,
    old_photo_url, new_photo_url, old_placard_url, storage_path,
    replaced_by_name, replaced_ip, replaced_user_agent, status
  ) values (
    p_review_link_id, v_link.tenant_id, p_equipment_id, p_slot,
    v_old_url, p_new_photo_url, v_equipment.placard_url, p_storage_path,
    nullif(btrim(coalesce(p_replaced_by_name, '')), ''), p_ip, p_user_agent, 'pending'
  );

  superseded_storage_path := v_superseded;
  return next;
end;
$$;

-- apply_staged_photo_replacement — swaps one staged photo into
-- loto_equipment. Idempotent: only 'pending' rows transition, so a sign-off
-- hook + a manual reconcile can't double-apply. audit_log is written
-- automatically by trg_audit_loto_equipment on the UPDATE; we add the
-- hygiene-log entry the spec calls for.
create or replace function public.apply_staged_photo_replacement(
  p_replacement_id uuid,
  p_applied_by     uuid default null
)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_rep           public.loto_review_photo_replacements%rowtype;
  v_eq            public.loto_equipment%rowtype;
  v_new_equip_url text;
  v_new_iso_url   text;
  v_photo_status  text;
begin
  select * into v_rep from public.loto_review_photo_replacements
    where id = p_replacement_id for update;
  if not found then raise exception 'replacement not found'; end if;

  if v_rep.status <> 'pending' then
    return v_rep.status;  -- idempotent no-op
  end if;

  select * into v_eq from public.loto_equipment
    where tenant_id = v_rep.tenant_id and equipment_id = v_rep.equipment_id for update;
  if not found then raise exception 'equipment not found'; end if;

  v_new_equip_url := case when v_rep.slot = 'EQUIP' then v_rep.new_photo_url else v_eq.equip_photo_url end;
  v_new_iso_url   := case when v_rep.slot = 'ISO'   then v_rep.new_photo_url else v_eq.iso_photo_url end;
  v_photo_status := case
    when (not coalesce(v_eq.needs_equip_photo, true) or nullif(v_new_equip_url, '') is not null)
     and (not coalesce(v_eq.needs_iso_photo,   true) or nullif(v_new_iso_url,   '') is not null)
      then 'complete'
    when nullif(v_new_equip_url, '') is not null or nullif(v_new_iso_url, '') is not null
      then 'partial'
    else 'missing'
  end;

  if v_rep.slot = 'EQUIP' then
    update public.loto_equipment
       set equip_photo_url = v_rep.new_photo_url,
           has_equip_photo = true,
           photo_status    = v_photo_status,
           placard_url     = null,  -- stale; must be re-rendered from the new photo
           updated_at      = now()
     where tenant_id = v_rep.tenant_id and equipment_id = v_rep.equipment_id;
  else
    update public.loto_equipment
       set iso_photo_url = v_rep.new_photo_url,
           has_iso_photo = true,
           photo_status  = v_photo_status,
           placard_url   = null,
           updated_at    = now()
     where tenant_id = v_rep.tenant_id and equipment_id = v_rep.equipment_id;
  end if;

  update public.loto_review_photo_replacements
     set status = 'applied', applied_at = now(), applied_by = p_applied_by
   where id = p_replacement_id;

  insert into public.loto_hygiene_log (tenant_id, equipment_id, action, section, reason, detail)
  values (
    v_rep.tenant_id, v_rep.equipment_id,
    'photo_replacement_applied', 'review-portal',
    'Reviewer ' || v_rep.slot || ' photo replacement reconciled',
    jsonb_build_object(
      'slot',            v_rep.slot,
      'review_link_id',  v_rep.review_link_id,
      'replacement_id',  v_rep.id,
      'old_photo_url',   v_rep.old_photo_url,
      'new_photo_url',   v_rep.new_photo_url,
      'old_placard_url', v_rep.old_placard_url,
      'applied_by',      p_applied_by
    )
  );

  return 'applied';
end;
$$;

-- reject_staged_photo_replacement — discards one staged photo without
-- touching loto_equipment. Idempotent. The staged object is intentionally
-- kept (the 30-day cleanup cron removes orphans).
create or replace function public.reject_staged_photo_replacement(
  p_replacement_id uuid,
  p_applied_by     uuid default null,
  p_reason         text default null
)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_rep public.loto_review_photo_replacements%rowtype;
begin
  select * into v_rep from public.loto_review_photo_replacements
    where id = p_replacement_id for update;
  if not found then raise exception 'replacement not found'; end if;

  if v_rep.status <> 'pending' then
    return v_rep.status;  -- idempotent no-op
  end if;

  update public.loto_review_photo_replacements
     set status          = 'rejected',
         applied_at      = now(),
         applied_by      = p_applied_by,
         rejected_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_replacement_id;

  return 'rejected';
end;
$$;

-- reconcile_review_link_photos — "apply all" for a link. Loops over pending
-- rows, applying each via the per-item function (so the idempotency guard is
-- shared). Returns the count actually applied this run. Safe to re-run; the
-- sign-off hook calls this.
create or replace function public.reconcile_review_link_photos(
  p_review_link_id uuid,
  p_applied_by     uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_id      uuid;
  v_applied integer := 0;
begin
  for v_id in
    select id from public.loto_review_photo_replacements
     where review_link_id = p_review_link_id and status = 'pending'
     order by replaced_at
     for update
  loop
    if public.apply_staged_photo_replacement(v_id, p_applied_by) = 'applied' then
      v_applied := v_applied + 1;
    end if;
  end loop;
  return v_applied;
end;
$$;

-- The staging + reconcile RPCs mutate equipment, so anon/authenticated must
-- NOT call them directly — every call flows through a service-role API route
-- that has already validated the review-link token (stage) or the tenant
-- admin session (apply/reject/reconcile).
revoke all on function public.stage_loto_review_photo_replacement(uuid, text, text, text, text, text, text, text) from public;
revoke all on function public.apply_staged_photo_replacement(uuid, uuid) from public;
revoke all on function public.reject_staged_photo_replacement(uuid, uuid, text) from public;
revoke all on function public.reconcile_review_link_photos(uuid, uuid) from public;
grant execute on function public.stage_loto_review_photo_replacement(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.apply_staged_photo_replacement(uuid, uuid) to service_role;
grant execute on function public.reject_staged_photo_replacement(uuid, uuid, text) to service_role;
grant execute on function public.reconcile_review_link_photos(uuid, uuid) to service_role;

commit;
