-- Migration 228: DOT / UN transport hazard-class placard catalog.
--
-- The U.S. DOT hazardous-materials placarding system (49 CFR 172
-- Subpart F) and the UN model regulations classify dangerous goods
-- into nine classes, several with numbered divisions. Each class/
-- division has a prescribed placard: an on-point square (diamond)
-- with a fixed background color, a symbol, and the class/division
-- number. Shippers — including hazardous-waste generators preparing
-- a uniform hazardous-waste manifest (40 CFR 262) — must apply the
-- correct placard.
--
-- This SYSTEM-WIDE catalog (no tenant_id) lets the app render the
-- right placard and resolve human-readable class names for shipping
-- papers, container labels, and reports. Artwork is served from
-- apps/web/public/dot/<id>.svg.
--
-- Mirrors 170_prop65_chemicals.sql (read-all / write-superadmin RLS,
-- touch + audit, idempotent seed). Additive and re-runnable.

begin;

create table if not exists public.dot_hazard_class_catalog (
  -- Class or class.division, e.g. '1.1', '3', '5.1', '9'.
  id                text        primary key
                      check (id ~ '^[1-9](\.[1-6])?$'),
  class_number      smallint    not null check (class_number between 1 and 9),
  -- NULL for classes carried without a division (3, 7, 8, 9).
  division          text,
  -- Proper placard name per 49 CFR 172.504 Table, e.g. 'Flammable Liquid'.
  label_name        text        not null check (length(btrim(label_name)) > 0),
  -- Dominant background color as a hex for the UI fallback chip.
  placard_color     text        not null check (placard_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Human descriptor of the full background scheme (some placards are
  -- split or striped), e.g. 'white-over-black', 'red-over-yellow'.
  placard_background text       not null,
  -- The symbol the placard depicts (a11y / alt long-form).
  symbol_legend     text        not null check (length(btrim(symbol_legend)) > 0),
  -- Canonical artwork path served from apps/web/public.
  image_path        text        not null
                      check (image_path ~ '^/dot/[1-9](\.[1-6])?\.svg$'),
  -- Regulatory reference for traceability.
  un_class_text     text,
  sort_order        smallint    not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.dot_hazard_class_catalog is
  'DOT/UN transport hazard classes and divisions (49 CFR 172 Subpart F). System-wide reference for placards, shipping papers, and hazardous-waste manifests.';

drop trigger if exists trg_dot_hazard_class_catalog_touch on public.dot_hazard_class_catalog;
create trigger trg_dot_hazard_class_catalog_touch
  before update on public.dot_hazard_class_catalog
  for each row execute function public.touch_updated_at();

alter table public.dot_hazard_class_catalog enable row level security;

drop policy if exists "dot_hazard_class_catalog_read_all" on public.dot_hazard_class_catalog;
create policy "dot_hazard_class_catalog_read_all"
  on public.dot_hazard_class_catalog
  for select to authenticated
  using (true);

drop policy if exists "dot_hazard_class_catalog_write_superadmin" on public.dot_hazard_class_catalog;
create policy "dot_hazard_class_catalog_write_superadmin"
  on public.dot_hazard_class_catalog
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

drop trigger if exists trg_audit_dot_hazard_class_catalog on public.dot_hazard_class_catalog;
create trigger trg_audit_dot_hazard_class_catalog
  after insert or update or delete on public.dot_hazard_class_catalog
  for each row execute function public.log_audit('id');

-- Seed — the canonical classes/divisions and their placard schemes.
-- Colors are the conventional DOT placard hexes; tighten to the exact
-- regulatory spec per print run if a tenant requires CMYK match.
insert into public.dot_hazard_class_catalog
  (id, class_number, division, label_name, placard_color, placard_background, symbol_legend, image_path, un_class_text, sort_order)
values
  ('1.1', 1, '1.1', 'Explosives 1.1',            '#FF9900', 'orange',            'Exploding bomb',          '/dot/1.1.svg', 'Class 1 — Explosives, division 1.1 (mass explosion hazard)',       1),
  ('1.2', 1, '1.2', 'Explosives 1.2',            '#FF9900', 'orange',            'Exploding bomb',          '/dot/1.2.svg', 'Class 1 — Explosives, division 1.2 (projection hazard)',           2),
  ('1.3', 1, '1.3', 'Explosives 1.3',            '#FF9900', 'orange',            'Exploding bomb',          '/dot/1.3.svg', 'Class 1 — Explosives, division 1.3 (fire / minor blast hazard)',   3),
  ('1.4', 1, '1.4', 'Explosives 1.4',            '#FF9900', 'orange',            'Numerals 1.4',            '/dot/1.4.svg', 'Class 1 — Explosives, division 1.4 (minor explosion hazard)',      4),
  ('1.5', 1, '1.5', 'Blasting Agents 1.5',       '#FF9900', 'orange',            'Numerals 1.5',            '/dot/1.5.svg', 'Class 1 — Explosives, division 1.5 (very insensitive)',            5),
  ('1.6', 1, '1.6', 'Explosives 1.6',            '#FF9900', 'orange',            'Numerals 1.6',            '/dot/1.6.svg', 'Class 1 — Explosives, division 1.6 (extremely insensitive)',       6),
  ('2.1', 2, '2.1', 'Flammable Gas',             '#ED1C24', 'red',               'Flame',                   '/dot/2.1.svg', 'Class 2 — Gases, division 2.1 (flammable gas)',                    7),
  ('2.2', 2, '2.2', 'Non-Flammable Gas',         '#00A651', 'green',             'Gas cylinder',            '/dot/2.2.svg', 'Class 2 — Gases, division 2.2 (non-flammable, non-toxic gas)',      8),
  ('2.3', 2, '2.3', 'Toxic Gas',                 '#FFFFFF', 'white',             'Skull and crossbones',    '/dot/2.3.svg', 'Class 2 — Gases, division 2.3 (toxic gas)',                        9),
  ('3',   3, null,  'Flammable Liquid',          '#ED1C24', 'red',               'Flame',                   '/dot/3.svg',   'Class 3 — Flammable liquids',                                     10),
  ('4.1', 4, '4.1', 'Flammable Solid',           '#FFFFFF', 'white-red-stripes', 'Flame',                   '/dot/4.1.svg', 'Class 4 — Flammable solids, division 4.1',                         11),
  ('4.2', 4, '4.2', 'Spontaneously Combustible', '#FFFFFF', 'white-over-red',    'Flame',                   '/dot/4.2.svg', 'Class 4 — division 4.2 (spontaneously combustible)',               12),
  ('4.3', 4, '4.3', 'Dangerous When Wet',        '#0072BC', 'blue',              'Flame',                   '/dot/4.3.svg', 'Class 4 — division 4.3 (dangerous when wet)',                      13),
  ('5.1', 5, '5.1', 'Oxidizer',                  '#FFD200', 'yellow',            'Flame over circle',       '/dot/5.1.svg', 'Class 5 — Oxidizing substances, division 5.1',                     14),
  ('5.2', 5, '5.2', 'Organic Peroxide',          '#ED1C24', 'red-over-yellow',   'Flame',                   '/dot/5.2.svg', 'Class 5 — division 5.2 (organic peroxide)',                        15),
  ('6.1', 6, '6.1', 'Toxic (Poison)',            '#FFFFFF', 'white',             'Skull and crossbones',    '/dot/6.1.svg', 'Class 6 — division 6.1 (toxic substances)',                        16),
  ('6.2', 6, '6.2', 'Infectious Substance',      '#FFFFFF', 'white',             'Biohazard symbol',        '/dot/6.2.svg', 'Class 6 — division 6.2 (infectious substances)',                   17),
  ('7',   7, null,  'Radioactive',               '#FFD200', 'yellow-over-white', 'Trefoil',                 '/dot/7.svg',   'Class 7 — Radioactive material',                                  18),
  ('8',   8, null,  'Corrosive',                 '#FFFFFF', 'white-over-black',  'Liquids dripping onto a hand and metal', '/dot/8.svg', 'Class 8 — Corrosive substances',                     19),
  ('9',   9, null,  'Miscellaneous',             '#FFFFFF', 'white-black-stripes', 'Vertical stripes (upper half)', '/dot/9.svg', 'Class 9 — Miscellaneous dangerous goods',                  20)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

commit;
