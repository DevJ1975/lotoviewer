-- Migration 239: LOTO zero-energy certifications — OSHA 29 CFR 1910.147(d)(6).
--
-- §1910.147(d)(6) requires the authorized employee to VERIFY that hazardous
-- energy has been isolated before work begins. Today the procedure documents a
-- `verify_zero_energy` step_type on loto_energy_steps (migration 140), but there
-- is no record of an actual verification EVENT — who attested, against which
-- machine, when. This table is that ledger.
--
-- It is the apply-target for the `loto_zero_energy_cert` regulated carve-out
-- (@soteria/core/operatorActions): the Operator Console's `loto` sub-agent stages
-- a certification; a tenant admin (or higher) approves it with one tap and becomes
-- the certifier of record, inserting one row here.
--
-- Reversibility is a SOFT revoke, never a hard delete: rolling back a cert stamps
-- revoked_at/revoked_by and keeps the row, so the §1910.147 audit trail of every
-- attestation (and its later withdrawal) survives intact. A partial unique index
-- enforces at most one ACTIVE (non-revoked) cert per (tenant, equipment).
--
-- Conventions follow the recent LOTO migrations (218): tenant-scoped RLS via
-- active_tenant_id() + current_user_tenant_ids() + is_superadmin(), audit trigger
-- reusing public.log_audit('id') from migration 003. Idempotent — re-runs are safe.

begin;

-- ── loto_zero_energy_certifications ──────────────────────────────────────────
create table if not exists public.loto_zero_energy_certifications (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  -- loto_equipment is keyed by its natural text equipment_id (NOT a uuid), and
  -- carries tenant_id since the multi-tenant backfill (migration 027). ON UPDATE
  -- CASCADE follows the existing FK style (migration 019); ON DELETE RESTRICT so a
  -- certified machine cannot be deleted out from under its attestation record.
  equipment_id text        not null references public.loto_equipment(equipment_id)
                             on update cascade on delete restrict,
  -- The human of record: the admin who approved the carve-out. RESTRICT so the
  -- certifier's identity can never be deleted away from the audit trail.
  certified_by uuid        not null references public.profiles(id) on delete restrict,
  certified_at timestamptz not null default now(),
  -- How zero-energy was verified (e.g. "try-start + meter on disconnect"). Free
  -- text — §147(d)(6) names no fixed method vocabulary.
  method       text,
  notes        text,
  -- Soft revoke (the rollback path). NULL = active; set = withdrawn.
  revoked_at   timestamptz,
  revoked_by   uuid        references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- revoked_at and revoked_by move together — a revocation always names its actor.
  constraint loto_zec_revoke_state_consistent
    check ((revoked_at is null) = (revoked_by is null))
);

-- At most ONE active (non-revoked) certification per machine, per tenant. A
-- revoked row drops out of the predicate, so a machine can be re-certified after
-- a revocation while the full history is retained.
create unique index if not exists uq_loto_zec_active_per_equipment
  on public.loto_zero_energy_certifications (tenant_id, equipment_id)
  where revoked_at is null;

-- "Is this machine currently certified?" + the active-inbox read, newest first.
create index if not exists idx_loto_zec_tenant_active
  on public.loto_zero_energy_certifications (tenant_id, equipment_id, certified_at desc)
  where revoked_at is null;

comment on table public.loto_zero_energy_certifications is
  'Zero-energy verification attestations per OSHA 29 CFR 1910.147(d)(6). Apply-target of the loto_zero_energy_cert carve-out. Soft-revoked, never hard-deleted — this is the attestation audit trail.';

-- ── updated_at touch ─────────────────────────────────────────────────────────
-- Reuse the shared toucher from migration 027 so updated_at is trustworthy even
-- for writes that bypass the engine service.
drop trigger if exists trg_loto_zec_touch on public.loto_zero_energy_certifications;
create trigger trg_loto_zec_touch
  before update on public.loto_zero_energy_certifications
  for each row execute function public.touch_updated_at();

-- ── RLS (tenant scope — mirrors migration 218) ───────────────────────────────
-- The engine writes via supabaseAdmin (RLS bypassed); this policy scopes any
-- client-direct read/write to the caller's active tenant, with a superadmin
-- escape hatch — the same shape every recent LOTO table uses.
alter table public.loto_zero_energy_certifications enable row level security;

drop policy if exists loto_zec_tenant_scope on public.loto_zero_energy_certifications;
create policy loto_zec_tenant_scope on public.loto_zero_energy_certifications
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ── Audit trigger (reuse log_audit, migration 003) ───────────────────────────
drop trigger if exists trg_audit_loto_zec on public.loto_zero_energy_certifications;
create trigger trg_audit_loto_zec
  after insert or update or delete on public.loto_zero_energy_certifications
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
