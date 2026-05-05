// Risk register CSV bulk import — pure parsing + validation. Mirrors
// the equipment importer pattern (lib/csvImport.ts). The /risk/import
// page calls these helpers, then POSTs valid rows individually to
// /api/risk so the existing PPE-alone trigger + audit log fire per row.
//
// Required columns (case-insensitive, normalized via normalizeHeader):
//   title
//   description
//   hazard_category
//   source
//   activity_type
//   exposure_frequency
//   inherent_severity   1..5
//   inherent_likelihood 1..5
//
// Optional:
//   location, process, residual_severity, residual_likelihood,
//   ppe_only_justification, next_review_date (YYYY-MM-DD)

import { parseCsv, normalizeHeader, cell } from './csvImport'

export const RISK_CSV_REQUIRED = [
  'title', 'description', 'hazard_category', 'source',
  'activity_type', 'exposure_frequency',
  'inherent_severity', 'inherent_likelihood',
] as const

const VALID_CATS     = ['physical','chemical','biological','mechanical','electrical','ergonomic','psychosocial','environmental','radiological']
const VALID_SOURCES  = ['inspection','jsa','incident','worker_report','audit','moc','other']
const VALID_ACTIVITY = ['routine','non_routine','emergency']
const VALID_FREQ     = ['continuous','daily','weekly','monthly','rare']

export interface ParsedRiskRow {
  /** 1-indexed source-row number for error display. */
  rowNumber:           number
  title:               string
  description:         string
  hazard_category:     string
  source:              string
  activity_type:       string
  exposure_frequency:  string
  inherent_severity:   number
  inherent_likelihood: number
  location?:               string | null
  process?:                string | null
  residual_severity?:      number | null
  residual_likelihood?:    number | null
  ppe_only_justification?: string | null
  next_review_date?:       string | null
  status:              'valid' | 'invalid'
  error?:              string
}

export interface RiskCsvParseResult {
  rows:    ParsedRiskRow[]
  /** Header validation error, e.g. "Missing required column: title". */
  headerError: string | null
}

interface HeaderIndex {
  title:               number
  description:         number
  hazard_category:     number
  source:              number
  activity_type:       number
  exposure_frequency:  number
  inherent_severity:   number
  inherent_likelihood: number
  location?:               number
  process?:                number
  residual_severity?:      number
  residual_likelihood?:    number
  ppe_only_justification?: number
  next_review_date?:       number
}

function buildHeaderIndex(headerRow: string[]): { ok: true; idx: HeaderIndex } | { ok: false; error: string } {
  const seen = new Map<string, number>()
  headerRow.forEach((h, i) => seen.set(normalizeHeader(h), i))
  const idx: Partial<HeaderIndex> = {}
  for (const k of RISK_CSV_REQUIRED) {
    const at = seen.get(k.replace(/_/g, ''))
    if (at === undefined) return { ok: false, error: `Missing required column: ${k}` }
    ;(idx as Record<string, number>)[k] = at
  }
  for (const k of ['location','process','residual_severity','residual_likelihood','ppe_only_justification','next_review_date'] as const) {
    const at = seen.get(k.replace(/_/g, ''))
    if (at !== undefined) (idx as Record<string, number>)[k] = at
  }
  return { ok: true, idx: idx as HeaderIndex }
}

function int1to5(raw: string): number | null {
  const n = parseInt(raw.trim(), 10)
  if (Number.isNaN(n) || n < 1 || n > 5) return null
  return n
}

export function parseRiskCsv(text: string): RiskCsvParseResult {
  const grid = parseCsv(text).filter(r => r.some(c => c.trim() !== ''))
  if (grid.length === 0) return { rows: [], headerError: 'CSV is empty' }

  const headerCheck = buildHeaderIndex(grid[0])
  if (!headerCheck.ok) return { rows: [], headerError: headerCheck.error }
  const idx = headerCheck.idx

  const out: ParsedRiskRow[] = []
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i]
    const title       = cell(r, idx.title).trim()
    const description = cell(r, idx.description).trim()
    const cat         = cell(r, idx.hazard_category).trim().toLowerCase()
    const source      = cell(r, idx.source).trim().toLowerCase()
    const activity    = cell(r, idx.activity_type).trim().toLowerCase()
    const freq        = cell(r, idx.exposure_frequency).trim().toLowerCase()
    const sevRaw      = cell(r, idx.inherent_severity)
    const likRaw      = cell(r, idx.inherent_likelihood)

    const inh_sev = int1to5(sevRaw)
    const inh_lik = int1to5(likRaw)

    const partial: ParsedRiskRow = {
      rowNumber:           i + 1,
      title, description,
      hazard_category:     cat,
      source, activity_type: activity, exposure_frequency: freq,
      inherent_severity:   inh_sev ?? 0,
      inherent_likelihood: inh_lik ?? 0,
      status:              'valid',
    }

    // Optional fields
    if (idx.location               !== undefined) partial.location               = cell(r, idx.location).trim() || null
    if (idx.process                !== undefined) partial.process                = cell(r, idx.process).trim() || null
    if (idx.residual_severity      !== undefined) {
      const rs = cell(r, idx.residual_severity).trim()
      partial.residual_severity = rs === '' ? null : int1to5(rs)
    }
    if (idx.residual_likelihood    !== undefined) {
      const rl = cell(r, idx.residual_likelihood).trim()
      partial.residual_likelihood = rl === '' ? null : int1to5(rl)
    }
    if (idx.ppe_only_justification !== undefined) partial.ppe_only_justification = cell(r, idx.ppe_only_justification).trim() || null
    if (idx.next_review_date       !== undefined) {
      const nrd = cell(r, idx.next_review_date).trim()
      if (nrd && !/^\d{4}-\d{2}-\d{2}$/.test(nrd)) {
        partial.status = 'invalid'
        partial.error  = `next_review_date must be YYYY-MM-DD (got: ${nrd})`
      } else {
        partial.next_review_date = nrd || null
      }
    }

    // Validation
    if (!partial.error) {
      if (!title)       partial.error = 'title required'
      else if (!description) partial.error = 'description required'
      else if (!VALID_CATS.includes(cat))     partial.error = `hazard_category must be one of: ${VALID_CATS.join(', ')}`
      else if (!VALID_SOURCES.includes(source))   partial.error = `source must be one of: ${VALID_SOURCES.join(', ')}`
      else if (!VALID_ACTIVITY.includes(activity)) partial.error = `activity_type must be one of: ${VALID_ACTIVITY.join(', ')}`
      else if (!VALID_FREQ.includes(freq))         partial.error = `exposure_frequency must be one of: ${VALID_FREQ.join(', ')}`
      else if (inh_sev === null) partial.error = 'inherent_severity must be 1..5'
      else if (inh_lik === null) partial.error = 'inherent_likelihood must be 1..5'
      else if (
        partial.residual_severity   != null &&
        partial.residual_likelihood == null
      ) partial.error = 'residual_likelihood is required when residual_severity is set'
      else if (
        partial.residual_severity   == null &&
        partial.residual_likelihood != null
      ) partial.error = 'residual_severity is required when residual_likelihood is set'
    }

    if (partial.error) partial.status = 'invalid'
    out.push(partial)
  }

  return { rows: out, headerError: null }
}

// Build the POST body shape /api/risk expects from a validated row.
export function toApiPayload(row: ParsedRiskRow): Record<string, unknown> {
  const risk: Record<string, unknown> = {
    title:               row.title,
    description:         row.description,
    hazard_category:     row.hazard_category,
    source:              row.source,
    activity_type:       row.activity_type,
    exposure_frequency:  row.exposure_frequency,
    inherent_severity:   row.inherent_severity,
    inherent_likelihood: row.inherent_likelihood,
  }
  if (row.location               != null) risk.location = row.location
  if (row.process                != null) risk.process = row.process
  if (row.residual_severity      != null) risk.residual_severity   = row.residual_severity
  if (row.residual_likelihood    != null) risk.residual_likelihood = row.residual_likelihood
  if (row.ppe_only_justification != null) risk.ppe_only_justification = row.ppe_only_justification
  if (row.next_review_date       != null) risk.next_review_date = row.next_review_date
  return { risk, controls: [] }
}
