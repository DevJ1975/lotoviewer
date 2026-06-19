// Cross-platform constants for the hazard-communication symbol systems
// that sit alongside GHS: NFPA 704 (the fire diamond) and DOT/UN
// transport placards. The nine GHS pictograms themselves live in
// ./chemicals (GHS_PICTOGRAMS, GHS_PICTOGRAM_LABEL) — the single source
// of truth — and are NOT re-exported here to keep the barrel
// unambiguous; this module adds the two systems chemicals.ts does not
// cover, plus a11y detail for the GHS set.
//
// Everything here mirrors the seeded reference catalogs
// (migrations 232-234) so a parity test can assert the database and the
// code never drift. Stays pure TypeScript (no deps) so packages/core
// remains importable from the web app, the Expo shell, and tests.

import type { GhsPictogram, GhsSignalWord } from './chemicals'

// ── GHS a11y / catalog detail (mirrors migration 232) ─────────────────────
// The hazard-class summary, depicted symbol, and canonical artwork path
// for each pictogram. Lets a component render an honest alt/title and
// resolve the SVG without a database round-trip. `name` stays in
// GHS_PICTOGRAM_LABEL (chemicals.ts) — don't duplicate it here.

export interface GhsPictogramDetail {
  /** What the pictogram visually depicts, e.g. 'Flame'. */
  symbolDescription:  string
  /** One-line summary of the hazard classes it covers. */
  hazardClassSummary: string
  /** Typical signal word; the authoritative value is per-product. */
  defaultSignalWord:  GhsSignalWord
  /** Artwork path under apps/web/public — matches the catalog row. */
  imagePath:          string
}

export const GHS_PICTOGRAM_DETAIL: Record<GhsPictogram, GhsPictogramDetail> = {
  GHS01: { symbolDescription: 'Exploding bomb',       hazardClassSummary: 'Unstable explosives; explosives div. 1.1-1.4; self-reactive A-B; organic peroxides A-B', defaultSignalWord: 'danger',  imagePath: '/ghs/GHS01.svg' },
  GHS02: { symbolDescription: 'Flame',                hazardClassSummary: 'Flammable gases, aerosols, liquids, solids; pyrophorics; self-heating; emits flammable gas; organic peroxides', defaultSignalWord: 'danger', imagePath: '/ghs/GHS02.svg' },
  GHS03: { symbolDescription: 'Flame over circle',    hazardClassSummary: 'Oxidizing gases, liquids and solids',                                              defaultSignalWord: 'danger',  imagePath: '/ghs/GHS03.svg' },
  GHS04: { symbolDescription: 'Gas cylinder',         hazardClassSummary: 'Gases under pressure: compressed, liquefied, refrigerated-liquefied, dissolved',   defaultSignalWord: 'warning', imagePath: '/ghs/GHS04.svg' },
  GHS05: { symbolDescription: 'Corrosion',            hazardClassSummary: 'Skin corrosion cat. 1; serious eye damage cat. 1; corrosive to metals cat. 1',     defaultSignalWord: 'danger',  imagePath: '/ghs/GHS05.svg' },
  GHS06: { symbolDescription: 'Skull and crossbones', hazardClassSummary: 'Acute toxicity (oral, dermal, inhalation) cat. 1-3',                               defaultSignalWord: 'danger',  imagePath: '/ghs/GHS06.svg' },
  GHS07: { symbolDescription: 'Exclamation mark',     hazardClassSummary: 'Acute toxicity cat. 4; skin/eye irritation cat. 2; skin sensitizer; STOT-SE cat. 3; ozone', defaultSignalWord: 'warning', imagePath: '/ghs/GHS07.svg' },
  GHS08: { symbolDescription: 'Health hazard',        hazardClassSummary: 'Respiratory sensitizer; mutagen; carcinogen; reproductive toxicant; STOT cat. 1-2; aspiration', defaultSignalWord: 'danger', imagePath: '/ghs/GHS08.svg' },
  GHS09: { symbolDescription: 'Environment',          hazardClassSummary: 'Hazardous to the aquatic environment: acute cat. 1; chronic cat. 1-2',             defaultSignalWord: 'warning', imagePath: '/ghs/GHS09.svg' },
}

// ── DOT / UN transport hazard classes (mirrors migration 233) ─────────────

export const DOT_HAZARD_CLASSES = [
  '1.1', '1.2', '1.3', '1.4', '1.5', '1.6',
  '2.1', '2.2', '2.3',
  '3',
  '4.1', '4.2', '4.3',
  '5.1', '5.2',
  '6.1', '6.2',
  '7',
  '8',
  '9',
] as const
export type DotHazardClass = typeof DOT_HAZARD_CLASSES[number]

export interface DotHazardClassMeta {
  classNumber:      number
  division:         string | null
  labelName:        string
  /** Dominant background color (hex) for the UI fallback chip. */
  placardColor:     string
  /** Descriptor of the full background scheme (split/striped placards). */
  placardBackground: string
  symbolLegend:     string
  imagePath:        string
}

export const DOT_HAZARD_CLASS_META: Record<DotHazardClass, DotHazardClassMeta> = {
  '1.1': { classNumber: 1, division: '1.1', labelName: 'Explosives 1.1',            placardColor: '#FF9900', placardBackground: 'orange',              symbolLegend: 'Exploding bomb',       imagePath: '/dot/1.1.svg' },
  '1.2': { classNumber: 1, division: '1.2', labelName: 'Explosives 1.2',            placardColor: '#FF9900', placardBackground: 'orange',              symbolLegend: 'Exploding bomb',       imagePath: '/dot/1.2.svg' },
  '1.3': { classNumber: 1, division: '1.3', labelName: 'Explosives 1.3',            placardColor: '#FF9900', placardBackground: 'orange',              symbolLegend: 'Exploding bomb',       imagePath: '/dot/1.3.svg' },
  '1.4': { classNumber: 1, division: '1.4', labelName: 'Explosives 1.4',            placardColor: '#FF9900', placardBackground: 'orange',              symbolLegend: 'Numerals 1.4',         imagePath: '/dot/1.4.svg' },
  '1.5': { classNumber: 1, division: '1.5', labelName: 'Blasting Agents 1.5',       placardColor: '#FF9900', placardBackground: 'orange',              symbolLegend: 'Numerals 1.5',         imagePath: '/dot/1.5.svg' },
  '1.6': { classNumber: 1, division: '1.6', labelName: 'Explosives 1.6',            placardColor: '#FF9900', placardBackground: 'orange',              symbolLegend: 'Numerals 1.6',         imagePath: '/dot/1.6.svg' },
  '2.1': { classNumber: 2, division: '2.1', labelName: 'Flammable Gas',             placardColor: '#ED1C24', placardBackground: 'red',                 symbolLegend: 'Flame',                imagePath: '/dot/2.1.svg' },
  '2.2': { classNumber: 2, division: '2.2', labelName: 'Non-Flammable Gas',         placardColor: '#00A651', placardBackground: 'green',               symbolLegend: 'Gas cylinder',         imagePath: '/dot/2.2.svg' },
  '2.3': { classNumber: 2, division: '2.3', labelName: 'Toxic Gas',                 placardColor: '#FFFFFF', placardBackground: 'white',               symbolLegend: 'Skull and crossbones', imagePath: '/dot/2.3.svg' },
  '3':   { classNumber: 3, division: null,  labelName: 'Flammable Liquid',          placardColor: '#ED1C24', placardBackground: 'red',                 symbolLegend: 'Flame',                imagePath: '/dot/3.svg' },
  '4.1': { classNumber: 4, division: '4.1', labelName: 'Flammable Solid',           placardColor: '#FFFFFF', placardBackground: 'white-red-stripes',   symbolLegend: 'Flame',                imagePath: '/dot/4.1.svg' },
  '4.2': { classNumber: 4, division: '4.2', labelName: 'Spontaneously Combustible', placardColor: '#FFFFFF', placardBackground: 'white-over-red',      symbolLegend: 'Flame',                imagePath: '/dot/4.2.svg' },
  '4.3': { classNumber: 4, division: '4.3', labelName: 'Dangerous When Wet',        placardColor: '#0072BC', placardBackground: 'blue',                symbolLegend: 'Flame',                imagePath: '/dot/4.3.svg' },
  '5.1': { classNumber: 5, division: '5.1', labelName: 'Oxidizer',                  placardColor: '#FFD200', placardBackground: 'yellow',              symbolLegend: 'Flame over circle',    imagePath: '/dot/5.1.svg' },
  '5.2': { classNumber: 5, division: '5.2', labelName: 'Organic Peroxide',          placardColor: '#ED1C24', placardBackground: 'red-over-yellow',     symbolLegend: 'Flame',                imagePath: '/dot/5.2.svg' },
  '6.1': { classNumber: 6, division: '6.1', labelName: 'Toxic (Poison)',            placardColor: '#FFFFFF', placardBackground: 'white',               symbolLegend: 'Skull and crossbones', imagePath: '/dot/6.1.svg' },
  '6.2': { classNumber: 6, division: '6.2', labelName: 'Infectious Substance',      placardColor: '#FFFFFF', placardBackground: 'white',               symbolLegend: 'Biohazard symbol',     imagePath: '/dot/6.2.svg' },
  '7':   { classNumber: 7, division: null,  labelName: 'Radioactive',               placardColor: '#FFD200', placardBackground: 'yellow-over-white',   symbolLegend: 'Trefoil',              imagePath: '/dot/7.svg' },
  '8':   { classNumber: 8, division: null,  labelName: 'Corrosive',                 placardColor: '#FFFFFF', placardBackground: 'white-over-black',    symbolLegend: 'Liquids dripping onto a hand and metal', imagePath: '/dot/8.svg' },
  '9':   { classNumber: 9, division: null,  labelName: 'Miscellaneous',             placardColor: '#FFFFFF', placardBackground: 'white-black-stripes', symbolLegend: 'Vertical stripes (upper half)', imagePath: '/dot/9.svg' },
}

export const DOT_PACKING_GROUPS = ['I', 'II', 'III'] as const
export type DotPackingGroup = typeof DOT_PACKING_GROUPS[number]

// ── NFPA 704 fire diamond (mirrors migration 234) ─────────────────────────

export const NFPA_CATEGORIES = ['health', 'flammability', 'instability', 'special'] as const
export type NfpaCategory = typeof NFPA_CATEGORIES[number]

/** The three numeric quadrants (the white quadrant carries symbols). */
export const NFPA_RATING_CATEGORIES = ['health', 'flammability', 'instability'] as const
export type NfpaRatingCategory = typeof NFPA_RATING_CATEGORIES[number]

export type NfpaRating = 0 | 1 | 2 | 3 | 4

export const NFPA_RATING_MEANINGS: Record<NfpaRatingCategory, Record<NfpaRating, string>> = {
  health: {
    0: 'No hazard beyond that of ordinary combustibles',
    1: 'Slightly hazardous; minor residual injury possible',
    2: 'Hazardous; temporary incapacitation or residual injury possible',
    3: 'Serious; serious or permanent injury on short exposure',
    4: 'Severe; very short exposure can cause death or major injury',
  },
  flammability: {
    0: 'Will not burn',
    1: 'Must be preheated to burn (flash point above 200 deg F)',
    2: 'Must be moderately heated to ignite (flash point 100-200 deg F)',
    3: 'Ignites at most ambient temperatures (flash point below 100 deg F)',
    4: 'Rapidly vaporizes and burns (flash point below 73 deg F)',
  },
  instability: {
    0: 'Stable; normally stable even under fire conditions',
    1: 'Unstable if heated; becomes unstable at elevated temperature',
    2: 'Violent chemical change at elevated temperature or pressure',
    3: 'Shock and heat may detonate; reacts explosively with water',
    4: 'May detonate; readily capable of detonation at normal conditions',
  },
}

export const NFPA_SPECIAL_SYMBOLS = ['W', 'OX', 'SA'] as const
export type NfpaSpecialSymbol = typeof NFPA_SPECIAL_SYMBOLS[number]

export const NFPA_SPECIAL_SYMBOL_MEANING: Record<NfpaSpecialSymbol, string> = {
  W:  'Unusual reactivity with water; do not use water',
  OX: 'Oxidizer',
  SA: 'Simple asphyxiant gas',
}

// Exact render colors for the four quadrants. NFPA 704 specifies the
// hue family (blue/red/yellow/white); these are the conventional web
// hexes used by both the React component and the PDF renderer so the
// fire diamond looks identical on screen and in print.
export const NFPA_QUADRANT_HEX: Record<NfpaCategory, string> = {
  health:       '#0066CC',
  flammability: '#FF0000',
  instability:  '#FFCC00',
  special:      '#FFFFFF',
} as const

// ── Validators (boundaries validate; internals trust) ─────────────────────

const DOT_HAZARD_CLASS_SET: ReadonlySet<string> = new Set(DOT_HAZARD_CLASSES)

/** True when `value` is one of the 20 catalogued DOT class/division ids. */
export function isValidDotHazardClass(value: string): boolean {
  return DOT_HAZARD_CLASS_SET.has(value)
}

/** True when `value` is an integer NFPA rating in the 0-4 range. */
export function isValidNfpaRating(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 4
}

const NFPA_SPECIAL_SET: ReadonlySet<string> = new Set(NFPA_SPECIAL_SYMBOLS)

/** True when `value` is one of the NFPA 704 white-quadrant symbols. */
export function isValidNfpaSpecialSymbol(value: string): boolean {
  return NFPA_SPECIAL_SET.has(value)
}
