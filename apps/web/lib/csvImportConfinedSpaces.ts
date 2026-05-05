import {
  parseCsv,
  decodeFile,
  normalizeHeader,
  cell,
} from '@/lib/csvImport'
import type {
  ConfinedSpaceClassification,
  ConfinedSpaceType,
} from '@soteria/core/types'

// CSV bulk-seed for confined spaces. Mirrors the LOTO equipment importer
// shape (parse → preview → batch insert) but with the columns the
// inventory needs. RFC 4180 parsing is reused from csvImport.ts so
// quoted fields, embedded commas, and CRLF endings all work without
// re-implementing the parser here.
//
// Required columns (case-insensitive, spaces and underscores ignored):
//   space_id, description, department
//
// Optional columns:
//   space_type           — one of: tank, silo, vault, pit, hopper,
//                          vessel, sump, plenum, manhole, other
//                          Defaults to 'other'.
//   classification       — one of: permit_required, non_permit, reclassified
//                          Defaults to 'permit_required' (the conservative
//                          choice; supervisors can reclassify after review).
//   entry_dimensions     — free text (e.g. "24-inch top manway")
//   known_hazards        — semicolon-separated list (e.g.
//                          "Engulfment;CIP residue;Limited egress")
//   isolation_required   — free text reference to LOTO procedure

const VALID_TYPES = new Set<ConfinedSpaceType>([
  'tank', 'silo', 'vault', 'pit', 'hopper',
  'vessel', 'sump', 'plenum', 'manhole', 'other',
])
const VALID_CLASSIFICATIONS = new Set<ConfinedSpaceClassification>([
  'permit_required', 'non_permit', 'reclassified',
])

export interface ParsedSpaceRow {
  space_id:           string
  description:        string
  department:         string
  space_type:         ConfinedSpaceType
  classification:     ConfinedSpaceClassification
  entry_dimensions:   string | null
  known_hazards:      string[]
  isolation_required: string | null
  status: 'new' | 'existing' | 'invalid'
  error?: string
}

export interface NewConfinedSpaceRow {
  space_id:           string
  description:        string
  department:         string
  space_type:         ConfinedSpaceType
  classification:     ConfinedSpaceClassification
  entry_dimensions:   string | null
  known_hazards:      string[]
  isolation_required: string | null
}

interface SpaceHeaderMap {
  spaceid:           number
  description:       number
  department:        number
  spacetype?:        number
  classification?:   number
  entrydimensions?:  number
  knownhazards?:     number
  isolationrequired?: number
}

export async function parseConfinedSpaceCsv(file: File): Promise<{
  rows:    ParsedSpaceRow[]
  errors:  string[]
}> {
  const text = await decodeFile(file)
  const matrix = parseCsv(text)
  if (matrix.length === 0) {
    return { rows: [], errors: ['CSV is empty.'] }
  }
  const headerRow = matrix[0]
  const headerOrError = buildSpaceHeaderMap(headerRow)
  if ('error' in headerOrError) {
    return { rows: [], errors: [headerOrError.error] }
  }
  const headers = headerOrError
  return processSpaceRows(matrix.slice(1), headers)
}

function buildSpaceHeaderMap(headerRow: string[]): SpaceHeaderMap | { error: string } {
  const idx: Record<string, number> = {}
  for (let i = 0; i < headerRow.length; i++) {
    const key = normalizeHeader(headerRow[i])
    if (key) idx[key] = i
  }
  const missing: string[] = []
  if (!('spaceid'     in idx)) missing.push('space_id')
  if (!('description' in idx)) missing.push('description')
  if (!('department'  in idx)) missing.push('department')
  if (missing.length > 0) {
    return { error: `Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}` }
  }
  return {
    spaceid:           idx.spaceid,
    description:       idx.description,
    department:        idx.department,
    spacetype:         idx.spacetype,
    classification:    idx.classification,
    entrydimensions:   idx.entrydimensions,
    knownhazards:      idx.knownhazards,
    isolationrequired: idx.isolationrequired,
  }
}

function processSpaceRows(rows: string[][], h: SpaceHeaderMap): {
  rows:   ParsedSpaceRow[]
  errors: string[]
} {
  const errors: string[] = []
  const out:    ParsedSpaceRow[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const lineNo = i + 2  // human-readable line number including header

    const spaceId        = cell(row, h.spaceid)
    const description    = cell(row, h.description)
    const department     = cell(row, h.department)
    const rawType        = cell(row, h.spacetype).toLowerCase()
    const rawClass       = cell(row, h.classification).toLowerCase()
    const entryDim       = cell(row, h.entrydimensions)
    const rawHazards     = cell(row, h.knownhazards)
    const isolation      = cell(row, h.isolationrequired)

    const rowErrors: string[] = []

    if (!spaceId)     rowErrors.push('space_id is required')
    if (!description) rowErrors.push('description is required')
    if (!department)  rowErrors.push('department is required')
    if (spaceId && seenIds.has(spaceId)) rowErrors.push(`duplicate space_id "${spaceId}" earlier in file`)

    const space_type: ConfinedSpaceType =
      rawType === '' ? 'other'
    : VALID_TYPES.has(rawType as ConfinedSpaceType) ? (rawType as ConfinedSpaceType)
    : (rowErrors.push(`unknown space_type "${rawType}"`), 'other')

    const classification: ConfinedSpaceClassification =
      rawClass === '' ? 'permit_required'
    : VALID_CLASSIFICATIONS.has(rawClass as ConfinedSpaceClassification) ? (rawClass as ConfinedSpaceClassification)
    : (rowErrors.push(`unknown classification "${rawClass}"`), 'permit_required')

    // Hazards: semicolon-separated; trim each; drop empties.
    const known_hazards = rawHazards
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    seenIds.add(spaceId)

    if (rowErrors.length > 0) {
      errors.push(`Line ${lineNo}: ${rowErrors.join('; ')}`)
      out.push({
        space_id: spaceId, description, department,
        space_type, classification,
        entry_dimensions: entryDim || null,
        known_hazards,
        isolation_required: isolation || null,
        status: 'invalid',
        error: rowErrors.join('; '),
      })
      continue
    }

    out.push({
      space_id: spaceId, description, department,
      space_type, classification,
      entry_dimensions: entryDim || null,
      known_hazards,
      isolation_required: isolation || null,
      status: 'new',
    })
  }

  return { rows: out, errors }
}

// Convert a validated ParsedSpaceRow into the insert payload shape.
// Caller is responsible for batching + the actual supabase insert call.
export function toInsertPayload(row: ParsedSpaceRow): NewConfinedSpaceRow {
  return {
    space_id:           row.space_id,
    description:        row.description,
    department:         row.department,
    space_type:         row.space_type,
    classification:     row.classification,
    entry_dimensions:   row.entry_dimensions,
    known_hazards:      row.known_hazards,
    isolation_required: row.isolation_required,
  }
}
