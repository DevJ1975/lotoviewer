// Aspects register CSV import: pure parsing and validation, following the
// risk importer (lib/csvImportRisk.ts). The aspects page previews the rows,
// then POSTs each valid one to /api/environmental/aspects, and its optional
// first score to /api/environmental/aspects/[id]/scores, so every row goes
// through the same validation, RLS and audit trigger as one typed by hand.
//
// Required columns (headers ignore case, and spaces and underscores are
// interchangeable; any other header is reported as ignored, never guessed):
//   activity, aspect, impact, process_area
// Optional:
//   life_cycle_stage, flow, control_level, status, controls, notes, source_reference
//   operating_condition, severity, likelihood, rationale   (one first score;
//   all four together, or none)

import {
  validateAspectInput,
  validateAspectScoreInput,
  type AspectControlLevel,
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
  'life_cycle_stage', 'flow', 'control_level', 'status', 'controls', 'notes', 'source_reference',
  'operating_condition', 'severity', 'likelihood', 'rationale',
] as const
const SCORE_COLUMNS = ['operating_condition', 'severity', 'likelihood', 'rationale'] as const

type Column = typeof ASPECT_CSV_REQUIRED[number] | typeof OPTIONAL[number]

export interface ParsedAspectRow {
  /** 1-indexed record number, the header counted as 1 and blank lines skipped, as a spreadsheet numbers rows. */
  rowNumber: number
  aspect:    AspectInput
  /** The row's first score, when its four score columns are filled. */
  score:     AspectScoreInput | null
  status:    'valid' | 'invalid'
  errors:    string[]
}

export interface AspectCsvParseResult {
  rows:           ParsedAspectRow[]
  headerError:    string | null
  /** Headers that match no column, so their cells are not imported. */
  ignoredColumns: string[]
}

/** A template to download: every column, and one invented example row. */
export const ASPECT_CSV_TEMPLATE = [
  [...ASPECT_CSV_REQUIRED, ...OPTIONAL].join(','),
  'Parts degreasing,Solvent vapour release,Air pollution (VOC),Finishing,operation,output,control,controlled,'
    + 'Lidded tank; fume extraction,,SDS-114,normal,3,4,Daily use; lid left open during breaks',
].join('\n') + '\n'

type HeaderIndex =
  | { ok: true; at: Partial<Record<Column, number>>; ignored: string[] }
  | { ok: false; error: string }

function headerIndex(header: string[]): HeaderIndex {
  const seen = new Map<string, number>()
  header.forEach((h, i) => seen.set(normalizeHeader(h), i))
  const at: Partial<Record<Column, number>> = {}
  for (const column of [...ASPECT_CSV_REQUIRED, ...OPTIONAL]) {
    const i = seen.get(normalizeHeader(column))
    if (i !== undefined) at[column] = i
  }
  const missing = ASPECT_CSV_REQUIRED.filter(column => at[column] === undefined)
  if (missing.length > 0) return { ok: false, error: `Missing required column: ${missing.join(', ')}` }
  const used = new Set(Object.values(at))
  const ignored = header.filter((h, i) => !used.has(i) && h.trim().length > 0)
  return { ok: true, at, ignored }
}

/** Core validators name fields as code does; a CSV user knows them by their column names. */
const COLUMN_FOR_FIELD: Record<string, string> = {
  processArea: 'process_area', lifeCycleStage: 'life_cycle_stage', sourceReference: 'source_reference',
  operatingCondition: 'operating_condition', controlLevel: 'control_level',
}
const asColumnError = (e: { field: string; message: string }) => `${COLUMN_FOR_FIELD[e.field] ?? e.field} ${e.message}`

const optional = (value: string): string | null => (value.length > 0 ? value : null)

export function parseAspectCsv(text: string): AspectCsvParseResult {
  const grid = parseCsv(text).filter(row => row.some(c => c.trim() !== ''))
  if (grid.length === 0) return { rows: [], headerError: 'The file is empty.', ignoredColumns: [] }
  const header = headerIndex(grid[0])
  if (!header.ok) return { rows: [], headerError: header.error, ignoredColumns: [] }
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
      controlLevel:    optional(get(row, 'control_level').toLowerCase()) as AspectControlLevel | null,
      status:          (optional(get(row, 'status').toLowerCase()) ?? 'identified') as AspectStatus,
      controls:        optional(get(row, 'controls')),
      notes:           optional(get(row, 'notes')),
      sourceReference: optional(get(row, 'source_reference')),
    }
    const errors = validateAspectInput(aspect).map(asColumnError)

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
      errors.push(...validateAspectScoreInput(score, DEFAULT_SCORING_METHOD).map(asColumnError))
    }

    return { rowNumber: i + 2, aspect, score, status: errors.length === 0 ? 'valid' : 'invalid', errors }
  })
  return { rows, headerError: null, ignoredColumns: header.ignored }
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
    control_level:    aspect.controlLevel,
    status:           aspect.status,
    controls:         aspect.controls,
    notes:            aspect.notes,
    source_reference: aspect.sourceReference,
  }
}
