import { describe, it, expect } from 'vitest'
import { parseRiskCsv, toApiPayload } from '@/lib/csvImportRisk'

const HEADERS = 'title,description,hazard_category,source,activity_type,exposure_frequency,inherent_severity,inherent_likelihood'

describe('parseRiskCsv', () => {
  it('rejects an empty file', () => {
    const r = parseRiskCsv('')
    expect(r.headerError).toMatch(/empty/i)
    expect(r.rows).toEqual([])
  })

  it('rejects when a required column is missing', () => {
    const r = parseRiskCsv('title,description\nx,y')
    expect(r.headerError).toMatch(/Missing required column/)
  })

  it('parses a valid row to status=valid', () => {
    const csv = `${HEADERS}\nForklift collision,Loading dock pinch point,physical,inspection,routine,daily,4,3`
    const { rows, headerError } = parseRiskCsv(csv)
    expect(headerError).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('valid')
    expect(rows[0].inherent_severity).toBe(4)
    expect(rows[0].inherent_likelihood).toBe(3)
  })

  it('flags invalid hazard_category', () => {
    const csv = `${HEADERS}\nx,y,bogus,inspection,routine,daily,3,3`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/hazard_category/)
  })

  it('flags out-of-range severity', () => {
    const csv = `${HEADERS}\nx,y,physical,inspection,routine,daily,9,3`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/inherent_severity/)
  })

  it('handles header normalization (case + spacing)', () => {
    const csv = 'Title,Description,Hazard Category,Source,Activity Type,Exposure Frequency,Inherent Severity,Inherent Likelihood\nx,y,physical,inspection,routine,daily,3,3'
    const { rows, headerError } = parseRiskCsv(csv)
    expect(headerError).toBeNull()
    expect(rows[0].status).toBe('valid')
  })

  it('rejects partial residual scoring (severity without likelihood)', () => {
    const csv = `${HEADERS},residual_severity,residual_likelihood\nx,y,physical,inspection,routine,daily,3,3,2,`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/residual_likelihood/)
  })

  it('accepts both residual columns when both supplied', () => {
    const csv = `${HEADERS},residual_severity,residual_likelihood\nx,y,physical,inspection,routine,daily,3,3,2,2`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('valid')
    expect(rows[0].residual_severity).toBe(2)
    expect(rows[0].residual_likelihood).toBe(2)
  })

  it('rejects malformed next_review_date', () => {
    const csv = `${HEADERS},next_review_date\nx,y,physical,inspection,routine,daily,3,3,not-a-date`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/next_review_date/)
  })

  it('skips entirely-blank rows', () => {
    const csv = `${HEADERS}\n\n\nForklift,desc,physical,inspection,routine,daily,3,3\n\n`
    const { rows } = parseRiskCsv(csv)
    expect(rows).toHaveLength(1)
  })
})

describe('toApiPayload', () => {
  it('builds the POST shape /api/risk expects', () => {
    const csv = `${HEADERS},location,next_review_date\nx,y,physical,inspection,routine,daily,3,3,Loading dock,2027-01-15`
    const { rows } = parseRiskCsv(csv)
    const payload = toApiPayload(rows[0])
    expect(payload.risk).toMatchObject({
      title:               'x',
      hazard_category:     'physical',
      inherent_severity:   3,
      inherent_likelihood: 3,
      location:            'Loading dock',
      next_review_date:    '2027-01-15',
    })
    expect(payload.controls).toEqual([])
  })

  it('omits optional fields when not supplied', () => {
    const csv = `${HEADERS}\nx,y,physical,inspection,routine,daily,3,3`
    const { rows } = parseRiskCsv(csv)
    const payload = toApiPayload(rows[0]) as { risk: Record<string, unknown> }
    expect(payload.risk.location).toBeUndefined()
    expect(payload.risk.next_review_date).toBeUndefined()
  })
})
