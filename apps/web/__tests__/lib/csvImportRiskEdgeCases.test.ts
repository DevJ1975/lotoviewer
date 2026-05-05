import { describe, it, expect } from 'vitest'
import { parseRiskCsv } from '@/lib/csvImportRisk'

const HEADERS = 'title,description,hazard_category,source,activity_type,exposure_frequency,inherent_severity,inherent_likelihood'

// Edge cases beyond the happy-path tests in csvImportRisk.test.ts.
// Hammers the parser with realistic adversarial inputs.

describe('parseRiskCsv — adversarial inputs', () => {
  it('survives a CSV with only a BOM byte', () => {
    expect(parseRiskCsv('﻿').headerError).toBeTruthy()
  })

  it('strips a UTF-8 BOM from the first cell of the header', () => {
    const csv = '﻿' + HEADERS + '\nForklift,d,physical,inspection,routine,daily,3,3'
    const { rows, headerError } = parseRiskCsv(csv)
    expect(headerError).toBeNull()
    expect(rows[0].status).toBe('valid')
  })

  it('handles quoted fields containing commas', () => {
    const csv = `${HEADERS}\n"Falling tools, ladder","Worker, distracted",physical,inspection,routine,daily,3,3`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].title).toBe('Falling tools, ladder')
    expect(rows[0].description).toBe('Worker, distracted')
  })

  it('handles quoted fields with escaped double-quotes', () => {
    const csv = `${HEADERS}\n"He said ""watch out""",d,physical,inspection,routine,daily,3,3`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].title).toBe('He said "watch out"')
  })

  it('handles CRLF line endings', () => {
    const csv = `${HEADERS}\r\nx,y,physical,inspection,routine,daily,3,3\r\n`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('valid')
  })

  it('handles unicode in title + description', () => {
    const csv = `${HEADERS}\n"O₂ deficiency","H₂S exposure in vault",chemical,inspection,routine,daily,4,3`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('valid')
    expect(rows[0].title).toContain('O₂')
    expect(rows[0].description).toContain('H₂S')
  })

  it('handles a 100-row file', () => {
    const lines = [HEADERS]
    for (let i = 0; i < 100; i++) {
      lines.push(`Risk ${i},Description ${i},physical,inspection,routine,daily,3,3`)
    }
    const { rows, headerError } = parseRiskCsv(lines.join('\n'))
    expect(headerError).toBeNull()
    expect(rows).toHaveLength(100)
    expect(rows.every(r => r.status === 'valid')).toBe(true)
  })

  it('rejects severity=0 and severity=6 (out of 1..5 range)', () => {
    const csv = [
      HEADERS,
      'a,d,physical,inspection,routine,daily,0,3',
      'b,d,physical,inspection,routine,daily,6,3',
    ].join('\n')
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('invalid')
    expect(rows[1].status).toBe('invalid')
  })

  it('accepts severity=1 and severity=5 (boundaries inside range)', () => {
    const csv = [
      HEADERS,
      'a,d,physical,inspection,routine,daily,1,1',
      'b,d,physical,inspection,routine,daily,5,5',
    ].join('\n')
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('valid')
    expect(rows[1].status).toBe('valid')
  })

  it('rejects non-numeric severity', () => {
    const csv = `${HEADERS}\nx,d,physical,inspection,routine,daily,abc,3`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('invalid')
  })

  it('rejects every invalid enum value individually', () => {
    const cases = [
      { col: 'hazard_category', bad: 'unknown' },
      { col: 'source',          bad: 'rumor' },
      { col: 'activity_type',   bad: 'casual' },
      { col: 'exposure_frequency', bad: 'sometimes' },
    ]
    for (const c of cases) {
      const cells = ['t', 'd', 'physical', 'inspection', 'routine', 'daily', '3', '3']
      const idx = HEADERS.split(',').indexOf(c.col)
      cells[idx] = c.bad
      const csv = `${HEADERS}\n${cells.join(',')}`
      const { rows } = parseRiskCsv(csv)
      expect(rows[0].status, `${c.col}=${c.bad}`).toBe('invalid')
    }
  })

  it('handles rows with too few columns gracefully', () => {
    const csv = `${HEADERS}\nhalf,a,row`
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].status).toBe('invalid')
  })

  it('handles a header with extra whitespace + mixed case', () => {
    const csv = '  TITLE , Description , HAZARD CATEGORY , Source , Activity Type , Exposure Frequency , INHERENT SEVERITY , Inherent_Likelihood \nx,y,physical,inspection,routine,daily,3,3'
    const { headerError } = parseRiskCsv(csv)
    expect(headerError).toBeNull()
  })

  it('produces 1-indexed source-row numbers including the header row', () => {
    const csv = [
      HEADERS,
      'a,d,physical,inspection,routine,daily,3,3',
      'b,d,physical,inspection,routine,daily,3,3',
    ].join('\n')
    const { rows } = parseRiskCsv(csv)
    expect(rows[0].rowNumber).toBe(2)   // header is row 1
    expect(rows[1].rowNumber).toBe(3)
  })
})
