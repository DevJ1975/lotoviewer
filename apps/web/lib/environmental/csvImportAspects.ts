// Aspects register CSV import: pure parsing and validation, following the
// risk importer (lib/csvImportRisk.ts). The aspects page previews the rows,
// then POSTs each valid one to /api/environmental/aspects, and its optional
// first score to /api/environmental/aspects/[id]/scores, so every row goes
// through the same validation, RLS and audit trigger as one typed by hand.
//
// Required columns (headers are case- and punctuation-insensitive):
//   activity, aspect, impact, process_area
// Optional:
//   life_cycle_stage, flow, status, controls, notes, source_reference
//   operating_condition, severity, likelihood, rationale   (one first score;
//   all four together, or none)

import {
  validateAspectInput,
  validateAspectScoreInput,
  type AspectFlow,
  type AspectInput,
  type AspectLifeCycleStage,
  type AspectOperatingCondition,
  type AspectScoreInput,
  type AspectStatus,
} from '@soteria/core/environmentalAspect'
import { DEFAULT_SCORING_METHOD } from '@soteria/core/scoringMethod'
import { cell, normalizeHeader, parseCsv } from '@/lib/csvImport'

export const ASPECT_CSV_REQUIRED = ['activity', 'aspect', 'impact', 'process_area'] as const
const OPTIONAL = [
  'life_cycle_stage', 'flow', 'status', 'controls', 'notes', 'source_reference',
  'operating_condition', 'severity', 'likelihood', 'rationale',
] as const
const SCORE_COLUMNS = ['operating_condition', 'severity', 'likelihood', 'rationale'] as const

type Column = typeof ASPECT_CSV_REQUIRED[number] | typeof OPTIONAL[number]

export interface ParsedAspectRow {
  /** 1-indexed line in the file, header included, for error display. */
  rowNumber: number
  aspect:    AspectInput
  /** The row's first score, when its four score columns are filled. */
  score:     AspectScoreInput | null
  status:    'valid' | 'invalid'
  errors:    string[]
}

export interface AspectCsvParseResult {
  rows:        ParsedAspectRow[]
  headerError: string | null
}

/** A template to download: every column, and one invented example row. */
export const ASPECT_CSV_TEMPLATE = [
  [...ASPECT_CSV_REQUIRED, ...OPTIONAL].join(','),
  'Parts degreasing,Solvent vapour release,Air pollution (VOC),Finishing,operation,output,controlled,'
    + 'Lidded tank; fume extraction,,SDS-114,normal,3,4,Daily use; lid left open during breaks',
].join('\n') + '\n'

function headerIndex(header: string[]): { ok: true; at: Partial<Record<Column, number>> } | { ok: false; error: string } {
  const seen = new Map<string, number>()
  header.forEach((h, i) => seen.set(normalizeHeader(h), i))
  const at: Partial<Record<Column, number>> = {}
  for (const column of [...ASPECT_CSV_REQUIRED, ...OPTIONAL]) {
    const i = seen.get(normalizeHeader(column))
    if (i !== undefined) at[column] = i
  }
  const missing = ASPECT_CSV_REQUIRED.filter(column => at[column] === undefined)
  return missing.length > 0 ? { ok: false, error: `Missing required column: ${missing.join(', ')}` } : { ok: true, at }
}

const optional = (value: string): string | null => (value.length > 0 ? value : null)

export function parseAspectCsv(text: string): AspectCsvParseResult {
  const grid = parseCsv(text).filter(row => row.some(c => c.trim() !== ''))
  if (grid.length === 0) return { rows: [], headerError: 'The file is empty.' }
  const header = headerIndex(grid[0])
  if (!header.ok) return { rows: [], headerError: header.error }
  const at = header.at
  const get = (row: string[], column: Column) => cell(row, at[column])

  const rows = grid.slice(1).map((row, i): ParsedAspectRow => {
    const aspect: AspectInput = {
      activity:        get(row, 'activity'),
      aspect:          get(row, 'aspect'),
      impact:          get(row, 'impact'),
      processArea:     get(row, 'process_area'),
      lifeCycleStage:  (optional(get(row, 'life_cycle_stage').toLowerCase()) ?? 'operation') as AspectLifeCycleStage,
      flow:            optional(get(row, 'flow').toLowerCase()) as AspectFlow | null,
      status:          (optional(get(row, 'status').toLowerCase()) ?? 'identified') as AspectStatus,
      controls:        optional(get(row, 'controls')),
      notes:           optional(get(row, 'notes')),
      sourceReference: optional(get(row, 'source_reference')),
    }
    const errors = validateAspectInput(aspect).map(e => `${e.field} ${e.message}`)

    const scoreCells = SCORE_COLUMNS.map(column => get(row, column))
    let score: AspectScoreInput | null = null
    if (scoreCells.some(value => value.length > 0)) {
      score = {
        operatingCondition: scoreCells[0].toLowerCase() as AspectOperatingCondition,
        severity:           /^\d+$/.test(scoreCells[1]) ? Number(scoreCells[1]) : Number.NaN,
        likelihood:         /^\d+$/.test(scoreCells[2]) ? Number(scoreCells[2]) : Number.NaN,
        rationale:          scoreCells[3],
      }
      // Phase 1 has no method editor, so every tenant scores under the default rule.
      errors.push(...validateAspectScoreInput(score, DEFAULT_SCORING_METHOD).map(e => `${e.field} ${e.message}`))
    }

    return { rowNumber: i + 2, aspect, score, status: errors.length === 0 ? 'valid' : 'invalid', errors }
  })
  return { rows, headerError: null }
}

/** The POST body for one parsed row, in the API's column names. */
export function aspectBody(aspect: AspectInput) {
  return {
    activity:         aspect.activity,
    aspect:           aspect.aspect,
    impact:           aspect.impact,
    process_area:     aspect.processArea,
    life_cycle_stage: aspect.lifeCycleStage,
    flow:             aspect.flow,
    status:           aspect.status,
    controls:         aspect.controls,
    notes:            aspect.notes,
    source_reference: aspect.sourceReference,
  }
}
