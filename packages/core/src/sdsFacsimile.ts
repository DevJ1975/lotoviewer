// SDS facsimile — assemble a parsed SDS payload into an ordered, labelled
// 16-section model for display and print.
//
// This is the pure, deterministic core behind the "regenerate the SDS"
// feature: no I/O, no AI, no DOM (mirrors sdsDiff.ts discipline). The
// /facsimile route loads chemical_sds_documents.parsed_payload from the
// database and calls buildSdsFacsimile; both the on-screen viewer and the
// pdf-lib generator render the SdsFacsimileModel it returns, so the two
// surfaces can never drift apart.
//
// WHY a facsimile is a DERIVED view, not the original: under OSHA HazCom
// (29 CFR 1910.1200) the manufacturer's SDS is the document of record. We
// reformat the *parsed* fields for a clean in-app read; we never claim to
// reproduce the authoritative sheet. Two honesty rules fall out of that and
// are enforced here:
//   1. Sections the parser does not populate (§10–13, §15) render an
//      explicit "not extracted — see the original" note rather than looking
//      blank, so a reader never mistakes silence for "no hazard".
//   2. Provenance (source URL, revision/parsed dates, model, confidence)
//      travels with the model so the banner can always be rendered.

import {
  firstAidEntries,
  spillCleanupEntries,
  GHS_PICTOGRAM_LABEL,
  type GhsPictogram,
  type GhsSignalWord,
  type ParseConfidence,
  type ParsedSdsPayload,
} from './chemicals'

/** A single labelled line within a section, value already display-formatted. */
export interface SdsFacsimileField {
  label: string
  value: string
}

export interface SdsFacsimileSection {
  /** 1..16, the canonical GHS section number. */
  number: number
  title:  string
  /** Empty when the parser did not populate this section; consumers render
   *  SDS_FACSIMILE_EMPTY_SECTION_NOTE in that case. */
  fields: SdsFacsimileField[]
}

/** Everything the mandatory "this is a reformatted copy" banner needs. */
export interface SdsFacsimileProvenance {
  sourceUrl:       string | null
  revisionDate:    string | null
  parsedDate:      string | null
  parseModel:      string | null
  parseConfidence: ParseConfidence | null
}

export interface SdsFacsimileModel {
  productName: string
  signalWord:  GhsSignalWord | null
  /** Valid GHS codes for the viewer to render as pictogram badges; the PDF
   *  renders their labels from the §2 "Pictograms" field instead. */
  pictograms:  GhsPictogram[]
  sections:    SdsFacsimileSection[]
  provenance:  SdsFacsimileProvenance
}

/** The banner text shown on every facsimile surface (viewer + PDF). */
export const SDS_FACSIMILE_DISCLAIMER =
  'Reformatted from the manufacturer Safety Data Sheet — not the original document of record.'

/** Shown in a section whose fields are empty. */
export const SDS_FACSIMILE_EMPTY_SECTION_NOTE =
  'Not extracted from the source SDS. Refer to the original document.'

// ─── jsonb trust-boundary coercions ──────────────────────────────────────
// parsed_payload is jsonb the /facsimile route hands us straight from the DB
// and casts to ParsedSdsPayload without proof. A field persisted by an older
// parse schema (or hand-edited) could be the wrong type; coercing defensively
// keeps a malformed row from 500-ing the whole render. Same reasoning as the
// codeSet/pictogramCodes guards in sdsDiff.ts.

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map(v => v.trim())
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function withUnit(value: unknown, unit: string): string {
  const n = num(value)
  return n === null ? '' : `${n} ${unit}`
}

/** Build a field, or null when the value is blank — callers compact() these
 *  so empty values never render a dangling label. */
function field(label: string, value: string): SdsFacsimileField | null {
  return value.trim() === '' ? null : { label, value: value.trim() }
}

function compact(fields: Array<SdsFacsimileField | null>): SdsFacsimileField[] {
  return fields.filter((f): f is SdsFacsimileField => f !== null)
}

/**
 * Assemble a parsed SDS payload into the 16-section facsimile model.
 *
 * `meta` carries the document-level provenance the payload itself does not
 * hold: the manufacturer URL it came from, when it was parsed
 * (chemical_sds_documents.created_at), and which model parsed it.
 *
 * Section order is the canonical GHS 1..16 and is an invariant the tests
 * rely on. Sections the parser populates: 1–9, 14, 16. Sections it does not
 * (10–13, 15) are emitted with empty `fields` so consumers render the
 * "not extracted" note — deliberately honest, never silently omitted.
 */
export function buildSdsFacsimile(
  parsed: ParsedSdsPayload,
  meta: { sourceUrl: string | null; parsedDate: string | null; parseModel: string | null },
): SdsFacsimileModel {
  // Tolerate a null/garbage payload rather than throw — the route should
  // only call us on an approved parse, but defense in depth is cheap.
  const p = (parsed ?? {}) as Partial<ParsedSdsPayload>

  const pictograms = list(p.ghs_pictograms)
    .filter((c): c is GhsPictogram => c in GHS_PICTOGRAM_LABEL)
  const signalWord = (p.ghs_signal_word === 'danger' || p.ghs_signal_word === 'warning')
    ? p.ghs_signal_word
    : null

  const sections: SdsFacsimileSection[] = []
  const section = (number: number, title: string, fields: Array<SdsFacsimileField | null>) =>
    sections.push({ number, title, fields: compact(fields) })
  const placeholder = (number: number, title: string) =>
    sections.push({ number, title, fields: [] })

  // §1 Identification
  section(1, 'Identification', [
    field('Product name',    text(p.product_name)),
    field('Manufacturer',    text(p.manufacturer)),
    field('Product code',    text(p.product_code)),
    field('Recommended use', text(p.recommended_use)),
    field('Emergency phone', text(p.emergency_phone)),
  ])

  // §2 Hazard(s) Identification — signal word, pictograms, then H/P codes.
  section(2, 'Hazard(s) Identification', [
    field('Signal word', signalWord ? signalWord.toUpperCase() : ''),
    field('Pictograms', pictograms.map(c => GHS_PICTOGRAM_LABEL[c]).join(', ')),
    ...statementFields(p.hazard_statements),
    ...statementFields(p.precautionary_statements),
  ])

  // §3 Composition / Information on Ingredients
  section(3, 'Composition / Information on Ingredients', [
    field('CAS number(s)', list(p.cas_numbers).join(', ')),
    field('Synonyms',      list(p.synonyms).join(', ')),
  ])

  // §4 First-Aid Measures
  section(4, 'First-Aid Measures',
    firstAidEntries(p.first_aid ?? null).map(e => field(e.label, e.text)))

  // §5 Fire-Fighting Measures
  const ff = (p.firefighting ?? {}) as NonNullable<ParsedSdsPayload['firefighting']>
  section(5, 'Fire-Fighting Measures', [
    field('Suitable extinguishing media',   list(ff.suitable_extinguishers).join(', ')),
    field('Unsuitable extinguishing media', list(ff.unsuitable_extinguishers).join(', ')),
    field('Special hazards',                text(ff.special_hazards)),
    field('Protective equipment',           text(ff.protective_equipment)),
  ])

  // §6 Accidental Release Measures
  section(6, 'Accidental Release Measures',
    spillCleanupEntries(p.spill_cleanup ?? null).map(e => field(e.label, e.text)))

  // §7 Handling and Storage — incompatibilities live here per the parser's
  // grouping (canonical SDS also references them under §10).
  section(7, 'Handling and Storage', [
    field('Storage class',   text(p.storage_class)),
    field('Incompatible with', list(p.incompatibilities).join(', ')),
  ])

  // §8 Exposure Controls / Personal Protection
  section(8, 'Exposure Controls / Personal Protection', [
    field('OSHA PEL (TWA)', withUnit(p.pel_twa_ppm, 'ppm')),
    field('STEL',           withUnit(p.stel_ppm, 'ppm')),
    field('IDLH',           withUnit(p.idlh_ppm, 'ppm')),
    field('PPE required',   list(p.ppe_required).join(', ')),
  ])

  // §9 Physical and Chemical Properties
  section(9, 'Physical and Chemical Properties', [
    field('Physical state', text(p.physical_state)),
    field('Appearance',     text(p.appearance)),
    field('Flash point',    withUnit(p.flash_point_c, '°C')),
    field('Boiling point',  withUnit(p.boiling_point_c, '°C')),
    field('Vapor pressure', withUnit(p.vapor_pressure_kpa, 'kPa')),
  ])

  // §10–13 + §15 — the parser does not populate these. Emit them empty so
  // consumers render the "not extracted" note rather than dropping the
  // section, which would read as "no hazard / no requirement".
  placeholder(10, 'Stability and Reactivity')
  placeholder(11, 'Toxicological Information')
  placeholder(12, 'Ecological Information')
  placeholder(13, 'Disposal Considerations')

  // §14 Transport Information (DOT)
  section(14, 'Transport Information', [
    field('UN number',     text(p.dot_un_number)),
    field('Hazard class',  text(p.dot_hazard_class)),
    field('Packing group', text(p.dot_packing_group)),
  ])

  placeholder(15, 'Regulatory Information')

  // §16 Other Information — SDS metadata + the parser's own caveats.
  section(16, 'Other Information', [
    field('SDS revision date', text(p.sds_revision_date)),
    field('Language',          text(p.sds_language).toUpperCase()),
    field('Extraction notes',  text(p.parser_notes)),
  ])

  return {
    productName: text(p.product_name),
    signalWord,
    pictograms,
    sections,
    provenance: {
      sourceUrl:       meta.sourceUrl,
      revisionDate:    text(p.sds_revision_date) || null,
      parsedDate:      meta.parsedDate,
      parseModel:      meta.parseModel,
      parseConfidence: confidenceOf(p),
    },
  }
}

// H/P statements render as "<code> — <text>" rows. The code is the
// regulatory identity; we lead with it so the facsimile reads like an SDS.
function statementFields(
  value: unknown,
): SdsFacsimileField[] {
  if (!Array.isArray(value)) return []
  const out: SdsFacsimileField[] = []
  for (const s of value) {
    if (!s || typeof s !== 'object') continue
    const code = text((s as { code?: unknown }).code)
    const body = text((s as { text?: unknown }).text)
    if (code === '' && body === '') continue
    out.push({ label: code || '—', value: body || code })
  }
  return out
}

function confidenceOf(p: Partial<ParsedSdsPayload>): ParseConfidence | null {
  const overall = (p.confidence as { overall?: unknown } | undefined)?.overall
  return overall === 'high' || overall === 'medium' || overall === 'low' ? overall : null
}
