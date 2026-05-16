-- Migration 170: California Proposition 65 chemical list (OEHHA).
--
-- The Safe Drinking Water and Toxic Enforcement Act of 1986
-- (California Health & Safety Code §25249.5 et seq.) — "Prop 65" —
-- requires businesses with 10+ employees to warn before knowingly
-- exposing anyone to a chemical OEHHA has listed as causing cancer
-- or reproductive harm. OEHHA publishes safe-harbor levels:
--   • NSRL — No Significant Risk Level (cancer endpoint, mg/day)
--   • MADL — Maximum Allowable Dose Level (repro endpoint, mg/day)
-- An exposure below the safe-harbor level is the documented legal
-- defense against the act's private bounty-hunter enforcement.
--
-- This table mirrors the OEHHA list and is SYSTEM-WIDE (no tenant_id):
-- every tenant resolves the same list of chemicals. Tenant-specific
-- linkage between this list and the tenant's own chemical inventory
-- lives in prop65_chemical_links (migration 171).
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'prop65_harm_endpoint') then
    create type public.prop65_harm_endpoint as enum ('cancer', 'reproductive', 'both');
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────
-- 2. Table — the OEHHA list
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.prop65_chemicals (
  id                  uuid        primary key default gen_random_uuid(),
  -- CAS Registry Number — globally unique chemical identifier. Some
  -- OEHHA entries are mixtures with no CAS; we still require a unique
  -- handle, so for those rows the slug is stored here (e.g. 'asbestos').
  cas_number          text        not null unique
                        check (length(btrim(cas_number)) > 0),
  chemical_name       text        not null
                        check (length(btrim(chemical_name)) > 0),
  harm_endpoint       public.prop65_harm_endpoint not null,
  -- Date OEHHA added the chemical to the §25249.8(a) list.
  listing_date        date,
  -- Safe-harbor levels in milligrams per day. NULL = OEHHA has not
  -- published one; consumers MUST fail safe and treat the exposure
  -- as unknown rather than below-safe-harbor.
  nsrl_mg_day         numeric     check (nsrl_mg_day is null or nsrl_mg_day >= 0),
  madl_mg_day         numeric     check (madl_mg_day is null or madl_mg_day >= 0),
  source_publication  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Endpoint-consistency invariant. Stored values must align with the
  -- declared endpoint so a downstream "unknown" doesn't leak from a
  -- mis-typed row. 'both' may have one or both populated; we don't
  -- require both because OEHHA sometimes lists only one number.
  check (
    case harm_endpoint
      when 'cancer'       then madl_mg_day is null
      when 'reproductive' then nsrl_mg_day is null
      else true
    end
  )
);

create index if not exists idx_prop65_chemicals_name_lower
  on public.prop65_chemicals (lower(chemical_name));

comment on table public.prop65_chemicals is
  'OEHHA-published Proposition 65 chemical list (Cal. Health & Safety Code §25249.8). System-wide; tenants link via prop65_chemical_links.';

-- ────────────────────────────────────────────────────────────────────
-- 3. updated_at touch
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_prop65_chemicals_touch on public.prop65_chemicals;
create trigger trg_prop65_chemicals_touch
  before update on public.prop65_chemicals
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- 4. RLS — read-everyone, write-superadmin-only
-- ────────────────────────────────────────────────────────────────────
alter table public.prop65_chemicals enable row level security;

drop policy if exists "prop65_chemicals_read_all" on public.prop65_chemicals;
create policy "prop65_chemicals_read_all"
  on public.prop65_chemicals
  for select to authenticated
  using (true);

drop policy if exists "prop65_chemicals_write_superadmin" on public.prop65_chemicals;
create policy "prop65_chemicals_write_superadmin"
  on public.prop65_chemicals
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- ────────────────────────────────────────────────────────────────────
-- 5. Audit trigger
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_prop65_chemicals on public.prop65_chemicals;
create trigger trg_audit_prop65_chemicals
  after insert or update or delete on public.prop65_chemicals
  for each row execute function public.log_audit('id');

-- ────────────────────────────────────────────────────────────────────
-- 6. Seed — 20 highest-frequency industrial entries
-- ────────────────────────────────────────────────────────────────────
-- Values are from the OEHHA Safe Harbor Levels publication
-- (https://oehha.ca.gov/proposition-65/general-info/current-proposition-
--  65-no-significant-risk-levels-nsrls-maximum). Where OEHHA has not
-- published a number we leave NULL — see fail-safe rule in §170 docs.
insert into public.prop65_chemicals
  (cas_number, chemical_name, harm_endpoint, listing_date, nsrl_mg_day, madl_mg_day, source_publication)
values
  ('7439-92-1',  'Lead',                              'both',         '1987-10-01', 0.015,  0.0005,  'OEHHA Safe Harbor Levels'),
  ('71-43-2',    'Benzene',                           'both',         '1987-02-27', 0.007,  0.024,   'OEHHA Safe Harbor Levels'),
  ('7440-43-9',  'Cadmium',                           'both',         '1987-10-01', 0.05,   0.0041,  'OEHHA Safe Harbor Levels'),
  ('18540-29-9', 'Chromium (hexavalent compounds)',   'both',         '1987-02-27', 0.0002, 0.0085,  'OEHHA Safe Harbor Levels'),
  ('50-00-0',    'Formaldehyde (gas)',                'cancer',       '1988-01-01', 0.04,   null,    'OEHHA Safe Harbor Levels'),
  ('75-09-2',    'Methylene chloride',                'cancer',       '1988-04-01', 0.20,   null,    'OEHHA Safe Harbor Levels'),
  ('127-18-4',   'Tetrachloroethylene (PCE/perc)',    'cancer',       '1988-04-01', 0.014,  null,    'OEHHA Safe Harbor Levels'),
  ('79-01-6',    'Trichloroethylene (TCE)',           'both',         '1988-04-01', 0.05,   0.014,   'OEHHA Safe Harbor Levels'),
  ('75-01-4',    'Vinyl chloride',                    'cancer',       '1987-02-27', 0.0003, null,    'OEHHA Safe Harbor Levels'),
  ('1332-21-4',  'Asbestos',                          'cancer',       '1987-02-27', null,   null,    'OEHHA Safe Harbor Levels'),
  ('7440-38-2',  'Arsenic (inorganic, oxide)',        'both',         '1987-02-27', 0.00010, 0.0001, 'OEHHA Safe Harbor Levels'),
  ('7440-41-7',  'Beryllium',                         'cancer',       '1987-10-01', 0.0001, null,    'OEHHA Safe Harbor Levels'),
  ('7440-02-0',  'Nickel (refinery dust)',            'cancer',       '1987-10-01', 0.02,   null,    'OEHHA Safe Harbor Levels'),
  ('75-21-8',    'Ethylene oxide',                    'both',         '1987-07-01', 0.002,  0.020,   'OEHHA Safe Harbor Levels'),
  ('117-81-7',   'Di(2-ethylhexyl)phthalate (DEHP)',  'both',         '1987-01-01', 0.31,   0.41,    'OEHHA Safe Harbor Levels'),
  ('80-05-7',    'Bisphenol A (BPA)',                 'reproductive', '2015-05-11', null,   0.003,   'OEHHA Safe Harbor Levels'),
  ('1336-36-3',  'Polychlorinated biphenyls (PCBs)',  'cancer',       '1987-10-01', 0.09,   null,    'OEHHA Safe Harbor Levels'),
  ('140-88-5',   'Ethyl acrylate',                    'cancer',       '1989-07-01', 0.022,  null,    'OEHHA Safe Harbor Levels'),
  ('91-20-3',    'Naphthalene',                       'cancer',       '2002-04-19', 0.0058, null,    'OEHHA Safe Harbor Levels'),
  ('100-42-5',   'Styrene',                           'cancer',       '2016-04-22', 0.027,  null,    'OEHHA Safe Harbor Levels')
on conflict (cas_number) do nothing;

notify pgrst, 'reload schema';

commit;
