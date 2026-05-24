import { describe, expect, it } from 'vitest'
import { parseDelimited } from '@/lib/csv/parseDelimited'

// Contract tests for the historical-import delimited parser. The parser is
// the trust boundary for the CSV path — every quirk a spreadsheet export
// throws at it (BOM, CRLF, quoted commas, blank lines) must round-trip into
// clean header-keyed rows, because the column-mapping UI and the
// confirm-batch validator both read off its output.

describe('parseDelimited', () => {
  it('parses a simple comma file into headers + keyed rows', () => {
    const { headers, rows } = parseDelimited('year,deaths\n2021,0\n2022,1\n')
    expect(headers).toEqual(['year', 'deaths'])
    expect(rows).toEqual([
      { year: '2021', deaths: '0' },
      { year: '2022', deaths: '1' },
    ])
  })

  it('auto-detects a tab delimiter from the header line', () => {
    const { headers, rows } = parseDelimited('year\tdeaths\n2021\t3\n')
    expect(headers).toEqual(['year', 'deaths'])
    expect(rows).toEqual([{ year: '2021', deaths: '3' }])
  })

  it('strips a leading UTF-8 BOM', () => {
    const { headers } = parseDelimited('﻿year,deaths\n2021,0\n')
    expect(headers).toEqual(['year', 'deaths'])
  })

  it('handles CRLF line endings', () => {
    const { rows } = parseDelimited('year,deaths\r\n2021,0\r\n2022,1\r\n')
    expect(rows).toEqual([
      { year: '2021', deaths: '0' },
      { year: '2022', deaths: '1' },
    ])
  })

  it('handles a missing trailing newline', () => {
    const { rows } = parseDelimited('year,deaths\n2021,0')
    expect(rows).toEqual([{ year: '2021', deaths: '0' }])
  })

  it('honours quoted fields containing the delimiter', () => {
    const { rows } = parseDelimited('name,year\n"Acme, Inc.",2021\n')
    expect(rows[0]).toEqual({ name: 'Acme, Inc.', year: '2021' })
  })

  it('unescapes doubled quotes inside a quoted field (RFC-4180)', () => {
    const { rows } = parseDelimited('name,year\n"The ""Big"" Site",2021\n')
    expect(rows[0]!.name).toBe('The "Big" Site')
  })

  it('keeps a literal newline inside a quoted field', () => {
    const { rows } = parseDelimited('note,year\n"line one\nline two",2021\n')
    expect(rows[0]!.note).toBe('line one\nline two')
    expect(rows).toHaveLength(1)
  })

  it('skips fully-blank lines', () => {
    const { rows } = parseDelimited('year,deaths\n2021,0\n\n\n2022,1\n')
    expect(rows).toHaveLength(2)
  })

  it('defaults missing trailing cells to empty strings', () => {
    const { rows } = parseDelimited('year,deaths,hours\n2021,0\n')
    expect(rows[0]).toEqual({ year: '2021', deaths: '0', hours: '' })
  })

  it('drops cells beyond the header count', () => {
    const { rows } = parseDelimited('year,deaths\n2021,0,99\n')
    expect(rows[0]).toEqual({ year: '2021', deaths: '0' })
  })

  it('returns empty results for empty input', () => {
    expect(parseDelimited('')).toEqual({ headers: [], rows: [] })
  })
})
