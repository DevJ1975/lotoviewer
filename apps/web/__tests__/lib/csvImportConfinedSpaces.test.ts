import { describe, it, expect } from 'vitest'
import {
  parseConfinedSpaceCsv,
  toInsertPayload,
  type ParsedSpaceRow,
} from '@/lib/csvImportConfinedSpaces'

// Helpers
function csvFile(text: string): File {
  return new File([text], 'test.csv', { type: 'text/csv' })
}

const HEADER = 'space_id,description,department,space_type,classification,entry_dimensions,known_hazards,isolation_required'

// ── Header / column-detection edge cases ────────────────────────────────────

describe('parseConfinedSpaceCsv — header detection', () => {
  it('rejects an empty file', async () => {
    const { rows, errors } = await parseConfinedSpaceCsv(csvFile(''))
    expect(rows).toEqual([])
    expect(errors).toEqual(['CSV is empty.'])
  })

  it('rejects when required columns are missing', async () => {
    const { rows, errors } = await parseConfinedSpaceCsv(csvFile('foo,bar\n1,2'))
    expect(rows).toEqual([])
    expect(errors[0]).toMatch(/Missing required column/)
    expect(errors[0]).toMatch(/space_id/)
    expect(errors[0]).toMatch(/description/)
    expect(errors[0]).toMatch(/department/)
  })

  it('lists all missing columns when more than one is absent', async () => {
    const { errors } = await parseConfinedSpaceCsv(csvFile('description\nfoo'))
    expect(errors[0]).toMatch(/space_id/)
    expect(errors[0]).toMatch(/department/)
  })

  it('accepts header names case-insensitively and ignores spaces/underscores', async () => {
    // Mix of casings + spaces — should normalize to spaceid/description/department.
    const { rows, errors } = await parseConfinedSpaceCsv(csvFile(
      'Space ID,Description,DEPARTMENT\nCS-1,Tank A,Bakery'
    ))
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].space_id).toBe('CS-1')
    expect(rows[0].description).toBe('Tank A')
    expect(rows[0].department).toBe('Bakery')
  })

  it('strips a UTF-8 BOM at the start of the file', async () => {
    // Constructed via fromCharCode so the BOM byte survives source-control
    // roundtrips regardless of editor invisible-character handling.
    const BOM = String.fromCharCode(0xFEFF)
    const { rows, errors } = await parseConfinedSpaceCsv(csvFile(
      `${BOM}space_id,description,department\nCS-1,Tank,Bakery`
    ))
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].space_id).toBe('CS-1')
  })
})

// ── Validation — row-level errors and defaults ─────────────────────────────

describe('parseConfinedSpaceCsv — row validation', () => {
  it('flags rows missing space_id as invalid', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\n,Tank,Bakery'
    ))
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/space_id is required/)
  })

  it('flags rows missing description as invalid', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\nCS-1,,Bakery'
    ))
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/description is required/)
  })

  it('flags rows missing department as invalid', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\nCS-1,Tank,'
    ))
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/department is required/)
  })

  it('combines multiple per-row errors into a single message', async () => {
    // Row needs at least one non-empty cell to survive parseCsv's
    // all-empty filter — a missing-description AND unknown-space_type
    // combination triggers two errors on a row that parses cleanly.
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department,space_type\nCS-1,,Bakery,drum'
    ))
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/description is required/)
    expect(rows[0].error).toMatch(/unknown space_type "drum"/)
  })

  it('defaults space_type to "other" when omitted', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\nCS-1,Tank,Bakery'
    ))
    expect(rows[0].space_type).toBe('other')
  })

  it('defaults classification to "permit_required" when omitted (conservative default)', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\nCS-1,Tank,Bakery'
    ))
    expect(rows[0].classification).toBe('permit_required')
  })

  it('flags an unknown space_type as invalid but still records the parsed row', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department,space_type\nCS-1,Tank,Bakery,drum'
    ))
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/unknown space_type "drum"/)
    // Falls back to 'other' even on the invalid row so the schema CHECK
    // wouldn't reject if the user fixed only the error and re-imported.
    expect(rows[0].space_type).toBe('other')
  })

  it('flags an unknown classification as invalid', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department,classification\nCS-1,Tank,Bakery,maybe'
    ))
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toMatch(/unknown classification "maybe"/)
  })

  it('accepts space_type and classification case-insensitively', async () => {
    // The cell is lowercased before the VALID_* lookup. "TANK" / "Permit_Required"
    // should both work.
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department,space_type,classification\nCS-1,Tank,Bakery,TANK,Permit_Required'
    ))
    expect(rows[0].status).toBe('new')
    expect(rows[0].space_type).toBe('tank')
    expect(rows[0].classification).toBe('permit_required')
  })

  it('treats whitespace-only cells as empty', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department,entry_dimensions\nCS-1,Tank,Bakery,   '
    ))
    expect(rows[0].status).toBe('new')
    expect(rows[0].entry_dimensions).toBeNull()
  })

  it('drops the file entirely if all data rows are empty (parser filters)', async () => {
    // The shared parseCsv strips rows whose every cell is empty. So a file
    // that's just headers + blank lines should yield zero parsed rows and
    // no errors.
    const { rows, errors } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\n\n\n'
    ))
    expect(rows).toEqual([])
    expect(errors).toEqual([])
  })
})

// ── Hazards parsing — semicolon-separated lists ────────────────────────────

describe('parseConfinedSpaceCsv — hazards parsing', () => {
  it('splits a semicolon-separated hazards list, trims each entry', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      `${HEADER}\nCS-1,Tank,Bakery,tank,permit_required,,Engulfment; CIP residue ;Limited egress,`
    ))
    expect(rows[0].known_hazards).toEqual(['Engulfment', 'CIP residue', 'Limited egress'])
  })

  it('drops empty fragments from leading/trailing/consecutive semicolons', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      `${HEADER}\nCS-1,Tank,Bakery,tank,permit_required,,;;Engulfment;;CIP residue;,`
    ))
    expect(rows[0].known_hazards).toEqual(['Engulfment', 'CIP residue'])
  })

  it('returns an empty array when known_hazards is omitted', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\nCS-1,Tank,Bakery'
    ))
    expect(rows[0].known_hazards).toEqual([])
  })

  it('handles a quoted hazard cell with internal commas', async () => {
    // CSV quoting: a hazard like "Engulfment, dust" is a single hazard
    // string, not two columns. The shared parseCsv handles this so the
    // semicolon split here works on the unquoted text.
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      `${HEADER}\nCS-1,Tank,Bakery,tank,permit_required,,"Engulfment, dust;CIP residue",`
    ))
    expect(rows[0].known_hazards).toEqual(['Engulfment, dust', 'CIP residue'])
  })
})

// ── Duplicate detection within a single file ───────────────────────────────

describe('parseConfinedSpaceCsv — duplicate space_id within file', () => {
  it('flags the second occurrence as invalid', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\nCS-1,First,Bakery\nCS-1,Second,Bakery'
    ))
    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe('new')
    expect(rows[1].status).toBe('invalid')
    expect(rows[1].error).toMatch(/duplicate space_id "CS-1"/)
  })

  it('does not falsely flag empty space_ids as duplicates of each other', async () => {
    // Both rows have empty space_id; both should be invalid for the missing-id
    // reason, NOT for "duplicate" — empty isn't a real id.
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\n,First,Bakery\n,Second,Bakery'
    ))
    expect(rows).toHaveLength(2)
    expect(rows[0].error).not.toMatch(/duplicate/)
    expect(rows[1].error).not.toMatch(/duplicate/)
  })

  it('all unique IDs across many rows yield all-new status', async () => {
    const { rows } = await parseConfinedSpaceCsv(csvFile(
      'space_id,description,department\nCS-1,A,B\nCS-2,A,B\nCS-3,A,B'
    ))
    expect(rows.every(r => r.status === 'new')).toBe(true)
  })
})

// ── toInsertPayload — projection for supabase.insert() ─────────────────────

describe('toInsertPayload', () => {
  it('strips the row-shape-only fields (status, error)', () => {
    const r: ParsedSpaceRow = {
      space_id:           'CS-1',
      description:        'Tank',
      department:         'Bakery',
      space_type:         'tank',
      classification:     'permit_required',
      entry_dimensions:   '24-inch top manway',
      known_hazards:      ['Engulfment'],
      isolation_required: 'LOTO on EQ-1',
      status:             'new',
    }
    const payload = toInsertPayload(r)
    expect(payload).toEqual({
      space_id:           'CS-1',
      description:        'Tank',
      department:         'Bakery',
      space_type:         'tank',
      classification:     'permit_required',
      entry_dimensions:   '24-inch top manway',
      known_hazards:      ['Engulfment'],
      isolation_required: 'LOTO on EQ-1',
    })
    // Make sure transient row fields don't leak into the insert.
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('error')
  })

  it('preserves null for optional text fields (won\'t coerce to empty string)', () => {
    const r: ParsedSpaceRow = {
      space_id: 'CS-1', description: 'Tank', department: 'Bakery',
      space_type: 'tank', classification: 'permit_required',
      entry_dimensions: null, known_hazards: [], isolation_required: null,
      status: 'new',
    }
    const payload = toInsertPayload(r)
    expect(payload.entry_dimensions).toBeNull()
    expect(payload.isolation_required).toBeNull()
  })
})
