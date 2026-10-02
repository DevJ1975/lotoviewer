// The aspects CSV import validates each row with the same core rules the API
// applies, so a row that previews as valid will not be refused on POST.

import { describe, it, expect } from 'vitest'
import { ASPECT_CSV_TEMPLATE, aspectBody, parseAspectCsv } from '@/lib/environmental/csvImportAspects'

describe('parseAspectCsv', () => {
  it('accepts the downloadable template as it stands', () => {
    const { rows, headerError } = parseAspectCsv(ASPECT_CSV_TEMPLATE)
    expect(headerError).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      rowNumber: 2, status: 'valid', errors: [],
      aspect: { activity: 'Parts degreasing', processArea: 'Finishing', lifeCycleStage: 'operation', flow: 'output', status: 'controlled', sourceReference: 'SDS-114', notes: null },
      score: { operatingCondition: 'normal', severity: 3, likelihood: 4 },
    })
  })

  it('names a missing required column', () => {
    expect(parseAspectCsv('activity,aspect,impact\nWelding,Fume,Air\n').headerError).toBe('Missing required column: process_area')
  })

  it('tolerates header case and spacing, and defaults the optional fields', () => {
    const { rows } = parseAspectCsv('Activity,Aspect,Impact,Process Area\nBoiler firing,Combustion gases,Air quality,Utilities\n')
    expect(rows[0]).toMatchObject({
      status: 'valid', score: null,
      aspect: { processArea: 'Utilities', lifeCycleStage: 'operation', status: 'identified', flow: null },
    })
  })

  it('reports every problem in a row, and keeps checking the rest', () => {
    const csv = 'activity,aspect,impact,process_area,flow,severity\n'
      + ',Spill,Soil,Yard,sideways,9\n'
      + 'Forklift charging,Battery acid,Soil,Warehouse,,\n'
    const { rows } = parseAspectCsv(csv)
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].errors).toEqual(expect.arrayContaining([
      'activity is required', 'flow must be input, output, or empty',
      'operating_condition must be normal, abnormal, or emergency', 'severity must be a whole number from 1 to 5',
      'rationale is required: say why this score',
    ]))
    expect(rows[1].status).toBe('valid')
  })

  it('refuses a non-integer score rather than rounding it', () => {
    const csv = 'activity,aspect,impact,process_area,operating_condition,severity,likelihood,rationale\n'
      + 'Washing,Wash water,Water,Yard,normal,2.5,3,Weekly\n'
    expect(parseAspectCsv(csv).rows[0].errors).toContain('severity must be a whole number from 1 to 5')
  })

  it('names a header it does not recognise instead of silently dropping its cells', () => {
    const csv = 'activity,aspect,impact,process_area,Life-cycle stage\nWelding,Fume,Air,Fabrication,transport\n'
    const { rows, ignoredColumns } = parseAspectCsv(csv)
    expect(ignoredColumns).toEqual(['Life-cycle stage'])
    expect(rows[0].aspect.lifeCycleStage).toBe('operation')
  })

  it('names a missing value by its column, as the CSV user knows it', () => {
    expect(parseAspectCsv('activity,aspect,impact,process_area\nWelding,Fume,Air,\n').rows[0].errors)
      .toContain('process_area is required')
  })

  it('reports an empty file', () => {
    expect(parseAspectCsv('\n\n').headerError).toBe('The file is empty.')
  })
})

describe('aspectBody', () => {
  it('uses the API\'s column names', () => {
    const { rows } = parseAspectCsv(ASPECT_CSV_TEMPLATE)
    expect(aspectBody(rows[0].aspect)).toMatchObject({ process_area: 'Finishing', life_cycle_stage: 'operation', source_reference: 'SDS-114' })
  })
})
