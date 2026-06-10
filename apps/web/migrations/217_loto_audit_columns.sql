-- Migration 217: LOTO multi-agent audit — confidence + photo-provenance columns.
--
-- The audit pipeline (Food-Production-Engineer / Data-Scientist / EHS agents)
-- needs two things the LOTO schema never had:
--
--   1. A per-isolation-step CONFIDENCE grade, written by the Data-Scientist
--      agent. Until now LOTO modelled uncertainty only as a "flagged for
--      review" queue (migration 189). The audit needs a graded signal so the
--      EHS gate and the placeholder-photo flow can act on low-confidence rows.
--      We reuse the ParseConfidence union the chemicals module already uses
--      (packages/core/src/chemicals.ts): a TEXT CHECK of 'high'|'medium'|'low',
--      NOT a Postgres enum — the app models confidence as a string union, and a
--      CHECK keeps the DB in lockstep without an enum-alter dance later.
--
--   2. Photo PROVENANCE on equipment. When the audit can't confirm a real
--      isolation point it attaches a watermarked manufacturer/reference image
--      as a PLACEHOLDER. A placeholder is, by definition, an *unverified*
--      isolation point — so it must never read as verified or count toward a
--      "complete" photo set. We make that a DB-level guarantee with a BEFORE
--      trigger, not an app convention that a future code path could forget.
--
-- Idempotent throughout (add column if not exists, create or replace function).

begin;

-- ── 1. Per-step confidence ────────────────────────────────────────────────
-- NULL = never audited. confidence_source records which run last set it
-- (e.g. 'audit:<run_id>') so a value's provenance is traceable.
alter table public.loto_energy_steps
  add column if not exists confidence text
    check (confidence is null or confidence in ('high', 'medium', 'low')),
  add column if not exists confidence_source text;

comment on column public.loto_energy_steps.confidence is
  'Audit Data-Scientist confidence in this isolation step (high|medium|low). NULL = never audited.';

-- ── 2. Photo provenance on equipment ──────────────────────────────────────
-- 'field'                 = a real photo captured at the machine.
-- 'reference_placeholder' = a watermarked manufacturer/reference stand-in
--                           attached because the real isolation point could
--                           not be confirmed during the audit.
alter table public.loto_equipment
  add column if not exists equip_photo_provenance text not null default 'field'
    check (equip_photo_provenance in ('field', 'reference_placeholder')),
  add column if not exists iso_photo_provenance text not null default 'field'
    check (iso_photo_provenance in ('field', 'reference_placeholder')),
  -- The hard gate flag. When true the ISO photo is a reference placeholder and
  -- the row can never be verified / complete (enforced by the trigger below).
  add column if not exists iso_photo_is_placeholder boolean not null default false,
  add column if not exists iso_photo_placeholder_source_url text,
  -- Denormalised "last audit result" for the admin equipment list. Nullable.
  add column if not exists last_audit_run_id uuid,
  add column if not exists last_audit_verdict text,
  add column if not exists last_audit_at timestamptz;

comment on column public.loto_equipment.iso_photo_is_placeholder is
  'True when iso_photo_url is a watermarked reference placeholder, not a verified isolation point. Forces verified=false and blocks photo_status=complete.';

-- ── 3. Invariant: a placeholder can never pass as verified ─────────────────
-- BEFORE INSERT/UPDATE so the rule holds for every write path — the audit
-- apply RPC, the admin edit sheet, a CSV import, anything. It is a no-op for
-- the overwhelming majority of rows where iso_photo_is_placeholder is false.
-- We downgrade rather than RAISE so a legitimate batch write that happens to
-- carry a placeholder row doesn't hard-fail the whole statement.
create or replace function public.enforce_placeholder_blocks_verified()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(new.iso_photo_is_placeholder, false) then
    new.verified := false;
    if new.photo_status = 'complete' then
      new.photo_status := 'partial';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_placeholder_blocks_verified on public.loto_equipment;
create trigger trg_enforce_placeholder_blocks_verified
  before insert or update on public.loto_equipment
  for each row execute function public.enforce_placeholder_blocks_verified();

notify pgrst, 'reload schema';

commit;
