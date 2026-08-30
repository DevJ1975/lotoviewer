-- Migration 268: NFPA 704 fire-diamond legend.
--
-- NFPA 704 ("the fire diamond") is the placarding standard fire
-- responders read at a glance: a square-on-point split into four
-- color-coded quadrants — blue (health), red (flammability), yellow
-- (instability), and white (special). The three colored quadrants
-- carry a 0-4 rating; the white quadrant carries special symbols
-- (W = unusual reactivity with water, OX = oxidizer, SA = simple
-- asphyxiant).
--
-- The diamond itself is RENDERED procedurally (see apps/web/lib/
-- nfpa704.ts and the Nfpa704Diamond React component) from the
-- per-product ratings on chemical_products / hazardous_waste_streams
-- (nfpa_health, nfpa_flammability, nfpa_instability, nfpa_special).
-- This SYSTEM-WIDE table is the human-readable LEGEND those surfaces
-- join against so a report or tooltip can explain what "Health 3"
-- means without hard-coding the prose in the UI.
--
-- Mirrors 170_prop65_chemicals.sql (read-all / write-superadmin RLS,
-- touch + audit, idempotent seed). Additive and re-runnable.

begin;

create table if not exists public.nfpa704_legend (
  category        text        not null
                    check (category in ('health', 'flammability', 'instability', 'special')),
  -- 0-4 for the three colored quadrants; NULL for the white quadrant.
  rating          smallint    check (rating between 0 and 4),
  -- 'W' | 'OX' | 'SA' for the white quadrant; NULL otherwise.
  special_symbol  text        check (special_symbol in ('W', 'OX', 'SA')),
  meaning         text        not null check (length(btrim(meaning)) > 0),
  -- Quadrant color name (blue / red / yellow / white). Exact render
  -- hexes live in packages/core/src/hazardSymbols.ts (NFPA_QUADRANT_HEX).
  quadrant_color  text        not null
                    check (quadrant_color in ('blue', 'red', 'yellow', 'white')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A colored quadrant carries a rating; the white quadrant carries a
  -- symbol. Exactly one of (rating, special_symbol) is populated.
  check ((rating is null) <> (special_symbol is null))
);

-- Natural key as a unique INDEX — a PRIMARY KEY cannot use expressions, and
-- rating/special_symbol are intentionally nullable (exactly one is set per
-- row). The coalesce sentinels keep each (category, rating | special_symbol)
-- row unique and give the ON CONFLICT below an index to target.
create unique index if not exists nfpa704_legend_key
  on public.nfpa704_legend (category, coalesce(rating, -1), coalesce(special_symbol, ''));

comment on table public.nfpa704_legend is
  'NFPA 704 fire-diamond legend (quadrant x rating / special symbol -> meaning). System-wide reference for tooltips and reports.';

drop trigger if exists trg_nfpa704_legend_touch on public.nfpa704_legend;
create trigger trg_nfpa704_legend_touch
  before update on public.nfpa704_legend
  for each row execute function public.touch_updated_at();

alter table public.nfpa704_legend enable row level security;

drop policy if exists "nfpa704_legend_read_all" on public.nfpa704_legend;
create policy "nfpa704_legend_read_all"
  on public.nfpa704_legend
  for select to authenticated
  using (true);

drop policy if exists "nfpa704_legend_write_superadmin" on public.nfpa704_legend;
create policy "nfpa704_legend_write_superadmin"
  on public.nfpa704_legend
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- Seed — the published NFPA 704 rating scale + special symbols.
insert into public.nfpa704_legend
  (category, rating, special_symbol, meaning, quadrant_color)
values
  ('health',       0, null, 'No hazard beyond that of ordinary combustibles',                     'blue'),
  ('health',       1, null, 'Slightly hazardous; minor residual injury possible',                 'blue'),
  ('health',       2, null, 'Hazardous; temporary incapacitation or residual injury possible',    'blue'),
  ('health',       3, null, 'Serious; serious or permanent injury on short exposure',              'blue'),
  ('health',       4, null, 'Severe; very short exposure can cause death or major injury',         'blue'),
  ('flammability', 0, null, 'Will not burn',                                                       'red'),
  ('flammability', 1, null, 'Must be preheated to burn (flash point above 200 deg F)',             'red'),
  ('flammability', 2, null, 'Must be moderately heated to ignite (flash point 100-200 deg F)',     'red'),
  ('flammability', 3, null, 'Ignites at most ambient temperatures (flash point below 100 deg F)',  'red'),
  ('flammability', 4, null, 'Rapidly vaporizes and burns (flash point below 73 deg F)',            'red'),
  ('instability',  0, null, 'Stable; normally stable even under fire conditions',                  'yellow'),
  ('instability',  1, null, 'Unstable if heated; becomes unstable at elevated temperature',        'yellow'),
  ('instability',  2, null, 'Violent chemical change at elevated temperature or pressure',         'yellow'),
  ('instability',  3, null, 'Shock and heat may detonate; reacts explosively with water',          'yellow'),
  ('instability',  4, null, 'May detonate; readily capable of detonation at normal conditions',    'yellow'),
  ('special', null, 'W',  'Unusual reactivity with water; do not use water',                       'white'),
  ('special', null, 'OX', 'Oxidizer',                                                              'white'),
  ('special', null, 'SA', 'Simple asphyxiant gas',                                                 'white')
on conflict (category, coalesce(rating, -1), coalesce(special_symbol, '')) do nothing;

notify pgrst, 'reload schema';

commit;
