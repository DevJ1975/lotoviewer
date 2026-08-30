-- Migration 266: GHS hazard-pictogram reference catalog.
--
-- The nine GHS (Globally Harmonized System of Classification and
-- Labelling of Chemicals) hazard pictograms used by OSHA HazCom 2012
-- (29 CFR 1910.1200) and the UN GHS "purple book". Until now these
-- lived only as code constants (GHS_PICTOGRAMS in packages/core/
-- src/chemicals.ts) plus static SVGs under apps/web/public/ghs/.
--
-- This table makes the catalog a SYSTEM-WIDE database record (no
-- tenant_id — every tenant resolves the same nine pictograms) so
-- reporting and labeling can JOIN against it for human-readable
-- hazard-class names and the canonical artwork path. The row's
-- image_path is the SAME path PictogramBadges already renders
-- (/ghs/<code>.svg), so upgrading the public SVG upgrades the UI and
-- the catalog together.
--
-- Signal word note: a pictogram does NOT determine the signal word —
-- that follows the hazard CATEGORY of the specific substance. The
-- default_signal_word column is a TYPICAL hint for label drafting,
-- not a classification. The authoritative value lives per-product in
-- chemical_products.ghs_signal_word.
--
-- Mirrors the system-wide reference pattern of 170_prop65_chemicals.sql
-- (read-all / write-superadmin RLS, touch + audit triggers, idempotent
-- seed). Additive and re-runnable.

begin;

create table if not exists public.ghs_pictogram_catalog (
  -- GHS01..GHS09 — the published UN pictogram codes.
  code                  text        primary key
                          check (code ~ '^GHS0[1-9]$'),
  -- Short hazard label, e.g. 'Flammable'. Kept byte-for-byte in sync
  -- with GHS_PICTOGRAM_LABEL in packages/core/src/chemicals.ts.
  name                  text        not null
                          check (length(btrim(name)) > 0),
  -- One-line description of the hazard classes the pictogram covers.
  hazard_class_summary  text,
  -- Typical signal word for products bearing this pictogram. NULL when
  -- it is genuinely category-dependent with no dominant default.
  default_signal_word   text        check (default_signal_word in ('danger', 'warning')),
  -- The visual the pictogram depicts (a11y / alt long-form), e.g.
  -- 'Flame', 'Skull and crossbones'.
  symbol_description    text        not null
                          check (length(btrim(symbol_description)) > 0),
  -- Canonical artwork path served from apps/web/public. The same path
  -- PictogramBadges reads, so the catalog and UI never diverge.
  image_path            text        not null
                          check (image_path ~ '^/ghs/GHS0[1-9]\.svg$'),
  -- Display order (matches the published GHS numbering).
  sort_order            smallint    not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.ghs_pictogram_catalog is
  'UN/OSHA GHS hazard pictograms (GHS01..GHS09). System-wide reference; products reference codes via chemical_products.ghs_pictograms and hazardous_waste_streams.ghs_pictograms.';

drop trigger if exists trg_ghs_pictogram_catalog_touch on public.ghs_pictogram_catalog;
create trigger trg_ghs_pictogram_catalog_touch
  before update on public.ghs_pictogram_catalog
  for each row execute function public.touch_updated_at();

alter table public.ghs_pictogram_catalog enable row level security;

drop policy if exists "ghs_pictogram_catalog_read_all" on public.ghs_pictogram_catalog;
create policy "ghs_pictogram_catalog_read_all"
  on public.ghs_pictogram_catalog
  for select to authenticated
  using (true);

drop policy if exists "ghs_pictogram_catalog_write_superadmin" on public.ghs_pictogram_catalog;
create policy "ghs_pictogram_catalog_write_superadmin"
  on public.ghs_pictogram_catalog
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

drop trigger if exists trg_audit_ghs_pictogram_catalog on public.ghs_pictogram_catalog;
create trigger trg_audit_ghs_pictogram_catalog
  after insert or update or delete on public.ghs_pictogram_catalog
  for each row execute function public.log_audit('code');

-- Seed — the nine canonical pictograms. Names match
-- GHS_PICTOGRAM_LABEL exactly; summaries follow the GHS Annex 1
-- hazard-class assignments.
insert into public.ghs_pictogram_catalog
  (code, name, hazard_class_summary, default_signal_word, symbol_description, image_path, sort_order)
values
  ('GHS01', 'Explosive',             'Unstable explosives; explosives div. 1.1-1.4; self-reactive A-B; organic peroxides A-B',         'danger',  'Exploding bomb',       '/ghs/GHS01.svg', 1),
  ('GHS02', 'Flammable',             'Flammable gases, aerosols, liquids, solids; pyrophorics; self-heating; emits flammable gas; organic peroxides', 'danger', 'Flame', '/ghs/GHS02.svg', 2),
  ('GHS03', 'Oxidizing',             'Oxidizing gases, liquids and solids',                                                              'danger',  'Flame over circle',    '/ghs/GHS03.svg', 3),
  ('GHS04', 'Compressed gas',        'Gases under pressure: compressed, liquefied, refrigerated-liquefied, dissolved',                   'warning', 'Gas cylinder',         '/ghs/GHS04.svg', 4),
  ('GHS05', 'Corrosive',             'Skin corrosion cat. 1; serious eye damage cat. 1; corrosive to metals cat. 1',                     'danger',  'Corrosion',            '/ghs/GHS05.svg', 5),
  ('GHS06', 'Acute toxicity',        'Acute toxicity (oral, dermal, inhalation) cat. 1-3',                                               'danger',  'Skull and crossbones', '/ghs/GHS06.svg', 6),
  ('GHS07', 'Irritant / harmful',    'Acute toxicity cat. 4; skin/eye irritation cat. 2; skin sensitizer; STOT-SE cat. 3; ozone',        'warning', 'Exclamation mark',     '/ghs/GHS07.svg', 7),
  ('GHS08', 'Health hazard',         'Respiratory sensitizer; mutagen; carcinogen; reproductive toxicant; STOT cat. 1-2; aspiration',    'danger',  'Health hazard',        '/ghs/GHS08.svg', 8),
  ('GHS09', 'Environmental hazard',  'Hazardous to the aquatic environment: acute cat. 1; chronic cat. 1-2',                             'warning', 'Environment',          '/ghs/GHS09.svg', 9)
on conflict (code) do nothing;

notify pgrst, 'reload schema';

commit;
