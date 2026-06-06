// SDS revision diff — compute the regulatory-critical DELTA between a
// previously-approved parsed SDS payload and a freshly-parsed one.
//
// Reviewers should not re-read a 16-section PDF to approve a revision;
// they should see "what changed". This module is the pure, deterministic
// core behind that view: no I/O, no AI, no DOM. The /diff route loads the
// two payloads from the database and calls diffSdsPayloads; the UI renders
// the SdsFieldDiff[] it returns.
//
// Scope is deliberately narrow — only the fields a safety reviewer must
// re-confirm on a revision: GHS hazard classification, NFPA ratings,
// exposure limits, and the two physical properties that drive storage and
// fire response. Everything else (first aid prose, transport codes, etc.)
// is out of scope here; it changes rarely and is lower-stakes to miss.

import type { ParsedSdsPayload } from './chemicals'

export interface SdsFieldDiff {
  /** Stable machine key, e.g. 'ghs_pictograms' or 'pel_twa_ppm'. */
  field:  string
  /** Human label for the UI, e.g. 'GHS pictograms'. */
  label:  string
  kind:   'added' | 'removed' | 'changed'
  /** Previous value rendered for display; null when nothing was there. */
  before: string | null
  /** New value rendered for display; null when it was removed. */
  after:  string | null
}

// Each entry maps a coded-list field (pictograms, H-codes, P-codes) to the
// label the UI shows and the accessor that pulls its coded items. We diff
// these by CODE: a code present in `next` but not `prev` is 'added', a code
// in `prev` but not `next` is 'removed'. We intentionally do NOT report a
// code whose TEXT changed but code stayed — the code IS the regulatory
// identity; reworded marketing text is noise for this view.

type CodedItem = { code: string }

function codeSet(items: ReadonlyArray<CodedItem> | null | undefined): Set<string> {
  const out = new Set<string>()
  // parsed_payload is jsonb the /diff route hands us straight from the DB and
  // casts to ParsedSdsPayload without proof. A coded list persisted by an
  // older parse schema (or hand-edited) could be a non-array; iterating it
  // would throw and 500 the whole diff. Treat anything non-array as empty.
  if (!Array.isArray(items)) return out
  for (const item of items) {
    if (item && typeof item.code === 'string' && item.code.trim() !== '') {
      out.add(item.code.trim())
    }
  }
  return out
}

// Coerce a possibly-malformed jsonb value to a string[] for the pictogram
// lists, which are bare codes rather than {code} objects. Same trust-boundary
// reasoning as codeSet: a non-array persisted value must not throw.
function pictogramCodes(value: readonly string[] | null | undefined): string[] {
  return Array.isArray(value) ? value : []
}

// Diff two code-sets into added/removed SdsFieldDiff rows. Codes are sorted
// so output is deterministic regardless of source array order.
function diffCodeSets(
  field: string,
  label: string,
  prev:  Set<string>,
  next:  Set<string>,
): SdsFieldDiff[] {
  const out: SdsFieldDiff[] = []
  const added   = [...next].filter(c => !prev.has(c)).sort()
  const removed = [...prev].filter(c => !next.has(c)).sort()
  for (const code of added) {
    out.push({ field, label, kind: 'added', before: null, after: code })
  }
  for (const code of removed) {
    out.push({ field, label, kind: 'removed', before: code, after: null })
  }
  return out
}

// Diff a single scalar value (string | number | null). Returns a single
// 'added' / 'removed' / 'changed' row, or null when unchanged. Rendering
// of the value is left to the caller via `render` so numerics format the
// same as the UI expects (no trailing ".0", etc).
function diffScalar(
  field:  string,
  label:  string,
  prev:   string | number | null,
  next:   string | number | null,
  render: (v: string | number) => string,
): SdsFieldDiff | null {
  const prevAbsent = prev === null
  const nextAbsent = next === null
  if (prevAbsent && nextAbsent) return null
  if (prev === next) return null
  if (prevAbsent) {
    return { field, label, kind: 'added', before: null, after: render(next as string | number) }
  }
  if (nextAbsent) {
    return { field, label, kind: 'removed', before: render(prev), after: null }
  }
  return { field, label, kind: 'changed', before: render(prev), after: render(next as string | number) }
}

const renderRaw = (v: string | number): string => String(v)

/**
 * Compute the regulatory-critical delta between the previously-approved
 * parse (`prev`) and the new parse (`next`).
 *
 * When `prev` is null (this is the first revision on record), every
 * present value in `next` is reported as 'added'.
 *
 * Output order is fixed and human-sensible: hazard classification first
 * (signal word, pictograms, H-codes, P-codes), then NFPA ratings, then
 * exposure limits, then the two physical properties. Within a coded list,
 * additions precede removals, each alphabetized by code. This ordering is
 * an invariant the tests rely on.
 */
export function diffSdsPayloads(
  prev: ParsedSdsPayload | null,
  next: ParsedSdsPayload,
): SdsFieldDiff[] {
  const out: SdsFieldDiff[] = []

  // 1. Signal word (scalar enum).
  const signalWord = diffScalar(
    'ghs_signal_word', 'GHS signal word',
    prev?.ghs_signal_word ?? null,
    next.ghs_signal_word ?? null,
    renderRaw,
  )
  if (signalWord) out.push(signalWord)

  // 2. GHS pictograms — pictograms aren't {code,text}; map to that shape.
  out.push(...diffCodeSets(
    'ghs_pictograms', 'GHS pictograms',
    codeSet(pictogramCodes(prev?.ghs_pictograms).map(code => ({ code }))),
    codeSet(pictogramCodes(next.ghs_pictograms).map(code => ({ code }))),
  ))

  // 3. Hazard statements (H-codes), then 4. Precautionary statements (P-codes).
  out.push(...diffCodeSets(
    'hazard_statements', 'Hazard statements (H-codes)',
    codeSet(prev?.hazard_statements), codeSet(next.hazard_statements),
  ))
  out.push(...diffCodeSets(
    'precautionary_statements', 'Precautionary statements (P-codes)',
    codeSet(prev?.precautionary_statements), codeSet(next.precautionary_statements),
  ))

  // 5. NFPA ratings.
  for (const [field, label, get] of [
    ['nfpa_health',       'NFPA Health',       (p: ParsedSdsPayload) => p.nfpa_health],
    ['nfpa_flammability', 'NFPA Flammability', (p: ParsedSdsPayload) => p.nfpa_flammability],
    ['nfpa_instability',  'NFPA Instability',  (p: ParsedSdsPayload) => p.nfpa_instability],
  ] as const) {
    const row = diffScalar(field, label, prev ? get(prev) : null, get(next), renderRaw)
    if (row) out.push(row)
  }

  // 6. Exposure limits (ppm).
  for (const [field, label, get] of [
    ['pel_twa_ppm', 'PEL TWA (ppm)', (p: ParsedSdsPayload) => p.pel_twa_ppm],
    ['stel_ppm',    'STEL (ppm)',    (p: ParsedSdsPayload) => p.stel_ppm],
    ['idlh_ppm',    'IDLH (ppm)',    (p: ParsedSdsPayload) => p.idlh_ppm],
  ] as const) {
    const row = diffScalar(field, label, prev ? get(prev) : null, get(next), renderRaw)
    if (row) out.push(row)
  }

  // 7. Physical properties that drive storage + fire response.
  const physicalState = diffScalar(
    'physical_state', 'Physical state',
    prev?.physical_state ?? null, next.physical_state ?? null, renderRaw,
  )
  if (physicalState) out.push(physicalState)

  const flashPoint = diffScalar(
    'flash_point_c', 'Flash point (°C)',
    prev?.flash_point_c ?? null, next.flash_point_c ?? null, renderRaw,
  )
  if (flashPoint) out.push(flashPoint)

  return out
}

// One-line human summary for notifications / digest rows, e.g.
//   "GHS09 added; PEL 100→50 ppm; +2 H-codes"
//
// Coded-list adds/removes collapse into a count ("+2 H-codes") unless a
// single code changed, in which case we name it ("GHS09 added") — the
// common drift case where naming the code is more useful than a count.
// Scalars render "before→after". Returns '' for an empty diff.
export function summarizeDiff(diffs: SdsFieldDiff[]): string {
  if (diffs.length === 0) return ''

  const CODED_FIELDS: Record<string, string> = {
    ghs_pictograms:           'pictogram',
    hazard_statements:        'H-code',
    precautionary_statements: 'P-code',
  }

  const parts: string[] = []
  const handledCodedFields = new Set<string>()

  for (const d of diffs) {
    const codedNoun = CODED_FIELDS[d.field]
    if (codedNoun) {
      if (handledCodedFields.has(d.field)) continue
      handledCodedFields.add(d.field)

      const rows  = diffs.filter(x => x.field === d.field)
      const added = rows.filter(x => x.kind === 'added')
      const removed = rows.filter(x => x.kind === 'removed')

      // A single coded change reads better named than counted.
      if (rows.length === 1) {
        const only = rows[0]
        const code = (only.after ?? only.before) as string
        parts.push(`${code} ${only.kind === 'added' ? 'added' : 'removed'}`)
        continue
      }
      if (added.length > 0)   parts.push(`+${added.length} ${codedNoun}${added.length === 1 ? '' : 's'}`)
      if (removed.length > 0) parts.push(`-${removed.length} ${codedNoun}${removed.length === 1 ? '' : 's'}`)
      continue
    }

    // Scalars: signal word, NFPA, exposure limits, physical props.
    if (d.field === 'pel_twa_ppm') {
      parts.push(`PEL ${scalarPhrase(d)} ppm`)
    } else if (d.field === 'stel_ppm') {
      parts.push(`STEL ${scalarPhrase(d)} ppm`)
    } else if (d.field === 'idlh_ppm') {
      parts.push(`IDLH ${scalarPhrase(d)} ppm`)
    } else if (d.field === 'ghs_signal_word') {
      parts.push(`signal word ${scalarPhrase(d)}`)
    } else {
      parts.push(`${d.label} ${scalarPhrase(d)}`)
    }
  }

  return parts.join('; ')
}

// Render a scalar diff's transition: "100→50" for a change, "→50" for an
// addition, "100→∅" for a removal.
function scalarPhrase(d: SdsFieldDiff): string {
  if (d.kind === 'added')   return `→${d.after}`
  if (d.kind === 'removed') return `${d.before}→∅`
  return `${d.before}→${d.after}`
}
