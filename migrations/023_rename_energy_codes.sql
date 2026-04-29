-- Migration 023: Rename legacy energy codes to match the canonical
-- Snak King palette adopted in lib/energyCodes.ts.
--
-- Legacy → canonical:
--   'O'  → 'M'   (Mechanical)
--   'OG' → 'CG'  (Compressed Gas)
--
-- Why: the placard layout was reconciled with the Snak King canonical
-- spreadsheet which uses 'M' and 'CG' (12 codes total — see
-- lib/energyCodes.ts for the full list). The pre-Snak-King codes 'O'
-- and 'OG' were Soteria-specific shorthand. Migrating now means new
-- placards use the canonical codes; old placards re-render correctly
-- the next time they're saved.
--
-- The lib has temporary in-memory aliases (ALIASES map in
-- energyCodes.ts) so any rows missed by this migration still resolve
-- correctly until the table is updated. Aliases will be removed in a
-- later cleanup.
--
-- Idempotent: re-running matches no rows on the second pass because
-- the WHERE clauses target only the legacy values.

update public.loto_energy_steps
   set energy_code = 'M'
 where energy_code = 'O';

update public.loto_energy_steps
   set energy_code = 'CG'
 where energy_code = 'OG';

comment on column public.loto_energy_steps.energy_code is
  'Canonical energy-source code from the Snak King palette (lib/energyCodes.ts). 12 codes: E, G, H, P, M, T, W, S, V, CG, CP, GR, plus the N sentinel for "none". Legacy O/OG values are migrated to M/CG by migration 023.';
