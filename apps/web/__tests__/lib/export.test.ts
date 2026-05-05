import { describe, it, expect } from 'vitest'
import { csvEscape, buildEquipmentCsv } from '@/lib/export'
import type { Equipment } from '@soteria/core/types'

function eq(partial: Partial<Equipment>): Equipment {
  return {
    equipment_id:       'EQ-001',
    description:        'Demo',
    department:         'Packaging',
    prefix:             null,
    photo_status:       'complete',
    has_equip_photo:    true,
    has_iso_photo:      true,
    equip_photo_url:    'https://x/a.jpg',
    iso_photo_url:      'https://x/b.jpg',
    placard_url:        null,
    signed_placard_url: null,
    notes:              null,
    notes_es:           null,
    internal_notes:     null,
    spanish_reviewed:   false,
    verified:           true,
    verified_date:      '2026-04-01',
    verified_by:        'jamil@x.com',
    needs_equip_photo:  true,
    needs_iso_photo:    true,
    needs_verification: false,
    decommissioned:     false,
    annotations:        [],
    iso_annotations:        [],
    created_at:         '2026-01-01T00:00:00Z',
    updated_at:         '2026-04-01T00:00:00Z',
    ...partial,
  }
}

// ── csvEscape ─────────────────────────────────────────────────────────────
//
// CSV injection (CWE-1236) is the real reason this helper exists. Excel,
// Sheets, and Numbers all treat a leading = + - @ TAB or CR as a formula
// trigger — a malicious row description like `=cmd|'/c calc'!A1` becomes
// arbitrary code execution when an admin opens the export. Prefix with a
// single quote and the spreadsheet treats the cell as text.

describe('csvEscape', () => {
  it('passes plain text through unchanged', () => {
    expect(csvEscape('Hello world')).toBe('Hello world')
  })

  it('quotes values containing a comma', () => {
    expect(csvEscape('foo, bar')).toBe('"foo, bar"')
  })

  it('escapes embedded double quotes by doubling them and wraps the cell', () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""')
  })

  it('quotes values containing a newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })

  it('neutralizes Excel formula-injection prefixes by leading-quote', () => {
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvEscape('+1+1')).toBe("'+1+1")
    expect(csvEscape('-cmd')).toBe("'-cmd")
    expect(csvEscape('@import')).toBe("'@import")
  })

  it('also neutralizes leading TAB and CR (subtler injection vectors)', () => {
    expect(csvEscape('\tEvil')).toBe("'\tEvil")
    expect(csvEscape('\rEvil')).toBe("'\rEvil")
  })

  it('combines neutralization with quoting when an injection prefix is also delimited', () => {
    // '=SUM(A1, B1)' has both a formula prefix AND a comma — the helper
    // must apply both transforms.
    expect(csvEscape('=SUM(A1, B1)')).toBe("\"'=SUM(A1, B1)\"")
  })

  it('returns an empty string for an empty input', () => {
    expect(csvEscape('')).toBe('')
  })

  it('does not neutralize a leading quote (already safe in CSV)', () => {
    expect(csvEscape("'already-quoted")).toBe("'already-quoted")
  })
})

// ── buildEquipmentCsv ─────────────────────────────────────────────────────

describe('buildEquipmentCsv', () => {
  it('produces a header row plus one row per equipment', () => {
    const csv = buildEquipmentCsv([eq({})], new Set())
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('equipment_id')
    expect(lines[0]).toContain('decommissioned')
  })

  it('sorts rows by equipment_id ASC for deterministic output', () => {
    const csv = buildEquipmentCsv([
      eq({ equipment_id: 'EQ-002' }),
      eq({ equipment_id: 'EQ-001' }),
      eq({ equipment_id: 'EQ-003' }),
    ], new Set())
    const ids = csv.split('\n').slice(1).map(l => l.split(',')[0])
    expect(ids).toEqual(['EQ-001', 'EQ-002', 'EQ-003'])
  })

  it('marks decommissioned rows from the supplied set, regardless of the row\'s flag', () => {
    // A user can decommission a row but the local flag may not have
    // re-fetched yet. The exporter trusts the live `decommissioned` set
    // so the export reflects current UI state.
    const csv = buildEquipmentCsv(
      [eq({ equipment_id: 'EQ-001', decommissioned: false })],
      new Set(['EQ-001']),
    )
    const dataRow = csv.split('\n')[1]
    expect(dataRow).toContain('true')   // decommissioned column
  })

  it('escapes user-controlled fields against CSV injection', () => {
    // A malicious description is the most plausible injection vector —
    // anyone who can edit equipment can plant one.
    const csv = buildEquipmentCsv(
      [eq({ description: '=HYPERLINK("https://evil")' })],
      new Set(),
    )
    expect(csv).toContain("'=HYPERLINK")  // leading quote neutralizes the formula
  })

  it('quotes notes that contain commas', () => {
    const csv = buildEquipmentCsv(
      [eq({ notes: 'Line 1, line 2, line 3' })],
      new Set(),
    )
    expect(csv).toContain('"Line 1, line 2, line 3"')
  })

  it('handles null prefix and notes by emitting empty cells', () => {
    const csv = buildEquipmentCsv([eq({ prefix: null, notes: null })], new Set())
    const fields = csv.split('\n')[1].split(',')
    // prefix is the 4th column (index 3); notes is the last column.
    expect(fields[3]).toBe('')
    expect(fields[fields.length - 1]).toBe('')
  })

  it('produces an empty body for an empty input', () => {
    const csv = buildEquipmentCsv([], new Set())
    expect(csv.split('\n')).toHaveLength(1)  // headers only
  })

  it('emits booleans as the strings true/false (not 1/0)', () => {
    // Excel parses "true"/"false" as booleans; "1"/"0" become numbers
    // which the user might filter incorrectly.
    const csv = buildEquipmentCsv([eq({
      verified:           true,
      has_equip_photo:    true,
      has_iso_photo:      false,
      needs_equip_photo:  true,
      needs_iso_photo:    false,
    })], new Set())
    const dataRow = csv.split('\n')[1]
    expect(dataRow).toContain(',true,false,true,false,true,')
  })
})
