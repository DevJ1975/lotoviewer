import { describe, it, expect } from 'vitest'
import {
  parseCsv,
  normalizeHeader,
  parseBool,
  buildHeaderMap,
  processRows,
  toInsertRow,
  decodeFile,
  type ParsedRow,
  type HeaderMap,
} from '@/lib/csvImport'

// ------------------------------ parseCsv ------------------------------

describe('parseCsv', () => {
  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('returns an empty array for whitespace-only input', () => {
    expect(parseCsv('\n\n   \n')).toEqual([])
  })

  it('parses a single row with no trailing newline', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']])
  })

  it('parses a single row with a trailing newline', () => {
    expect(parseCsv('a,b,c\n')).toEqual([['a', 'b', 'c']])
  })

  it('parses multiple rows with LF line endings', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })

  it('parses multiple rows with CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })

  it('parses mixed CRLF / LF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4\r\n')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })

  it('preserves empty fields within a non-blank row', () => {
    expect(parseCsv('a,,c\nx,y,z')).toEqual([['a', '', 'c'], ['x', 'y', 'z']])
  })

  it('strips fully-empty rows such as ",,"', () => {
    expect(parseCsv('a,b,c\n,,\nx,y,z')).toEqual([['a', 'b', 'c'], ['x', 'y', 'z']])
  })

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']])
  })

  it('unescapes "" as a literal quote inside a quoted field', () => {
    expect(parseCsv('"she said ""hi""",next')).toEqual([['she said "hi"', 'next']])
  })

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']])
  })

  it('handles CRLF inside quoted fields', () => {
    expect(parseCsv('"line1\r\nline2",b')).toEqual([['line1\r\nline2', 'b']])
  })

  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('\ufeffa,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('skips fully blank rows', () => {
    expect(parseCsv('a,b\n\n1,2\n,,\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })

  it('quotes that appear mid-unquoted-field are treated as literal characters', () => {
    // Not strictly RFC 4180 (which says unquoted fields shouldn't contain quotes),
    // but leniency matches the spec we wrote: quote only enters quoted-mode if
    // it's the very first character of a field.
    expect(parseCsv('a"b,c')).toEqual([['a"b', 'c']])
  })

  it('leaves trailing whitespace in unquoted fields intact (trim is a concern of the consumer)', () => {
    expect(parseCsv('a , b ,c')).toEqual([['a ', ' b ', 'c']])
  })
})

// ------------------------------ normalizeHeader ------------------------------

describe('normalizeHeader', () => {
  it('lowercases', () => {
    expect(normalizeHeader('Equipment')).toBe('equipment')
  })

  it('strips surrounding whitespace', () => {
    expect(normalizeHeader('  hello  ')).toBe('hello')
  })

  it('collapses spaces and underscores', () => {
    expect(normalizeHeader('Equipment ID')).toBe('equipmentid')
    expect(normalizeHeader('equipment_id')).toBe('equipmentid')
    expect(normalizeHeader('Equipment  Id')).toBe('equipmentid')
    expect(normalizeHeader('equipment__id')).toBe('equipmentid')
    expect(normalizeHeader('NEEDS EQUIP PHOTO')).toBe('needsequipphoto')
    expect(normalizeHeader('needs_equip_photo')).toBe('needsequipphoto')
  })

  it('returns an empty string for all-whitespace input', () => {
    expect(normalizeHeader('   ')).toBe('')
  })
})

// ------------------------------ parseBool ------------------------------

describe('parseBool', () => {
  it('parses truthy values', () => {
    for (const v of ['true', 'TRUE', 'True', 'yes', 'YES', '1']) {
      expect(parseBool(v, false)).toBe(true)
    }
  })

  it('parses falsy values', () => {
    for (const v of ['false', 'FALSE', 'no', 'NO', '0']) {
      expect(parseBool(v, true)).toBe(false)
    }
  })

  it('trims whitespace before parsing', () => {
    expect(parseBool('  true  ', false)).toBe(true)
    expect(parseBool('\tno\t', true)).toBe(false)
  })

  it('returns the default for an empty string', () => {
    expect(parseBool('', true)).toBe(true)
    expect(parseBool('', false)).toBe(false)
  })

  it('returns the default for whitespace-only input', () => {
    expect(parseBool('   ', true)).toBe(true)
  })

  it('returns the default for undefined (column absent)', () => {
    expect(parseBool(undefined, true)).toBe(true)
    expect(parseBool(undefined, false)).toBe(false)
  })

  it('returns null for unrecognised values', () => {
    expect(parseBool('maybe', true)).toBeNull()
    expect(parseBool('y', true)).toBeNull()
    expect(parseBool('-1', true)).toBeNull()
    expect(parseBool('2', true)).toBeNull()
  })
})

// ------------------------------ buildHeaderMap ------------------------------

describe('buildHeaderMap', () => {
  it('maps all required columns', () => {
    const result = buildHeaderMap(['equipment_id', 'description', 'department'])
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.equipmentid).toBe(0)
    expect(result.description).toBe(1)
    expect(result.department).toBe(2)
  })

  it('picks up all optional columns when present', () => {
    const result = buildHeaderMap([
      'equipment_id', 'description', 'department',
      'prefix', 'needs_equip_photo', 'needs_iso_photo', 'notes',
    ])
    if ('error' in result) throw new Error('expected no error')
    expect(result.prefix).toBe(3)
    expect(result.needsequipphoto).toBe(4)
    expect(result.needsisophoto).toBe(5)
    expect(result.notes).toBe(6)
  })

  it('is case and whitespace insensitive', () => {
    const result = buildHeaderMap(['  EQUIPMENT ID  ', 'Description', 'DEPARTMENT'])
    if ('error' in result) throw new Error('expected no error')
    expect(result.equipmentid).toBe(0)
  })

  it('errors if equipment_id is missing', () => {
    const result = buildHeaderMap(['description', 'department'])
    expect(result).toEqual({ error: 'Missing required column: equipment_id' })
  })

  it('lists all missing required columns', () => {
    const result = buildHeaderMap(['prefix'])
    if (!('error' in result)) throw new Error('expected an error')
    expect(result.error).toContain('equipment_id')
    expect(result.error).toContain('description')
    expect(result.error).toContain('department')
    expect(result.error).toContain('columns:')
  })

  it('leaves optional columns undefined when absent', () => {
    const result = buildHeaderMap(['equipment_id', 'description', 'department'])
    if ('error' in result) throw new Error('expected no error')
    expect(result.prefix).toBeUndefined()
    expect(result.notes).toBeUndefined()
  })
})

// ------------------------------ processRows ------------------------------

function headerMap(overrides: Partial<HeaderMap> = {}): HeaderMap {
  const base: HeaderMap = {
    equipmentid: 0,
    description: 1,
    department: 2,
    prefix: 3,
    needsequipphoto: 4,
    needsisophoto: 5,
    notes: 6,
  }
  return { ...base, ...overrides }
}

describe('processRows — required fields', () => {
  it('marks a fully-formed row as new', () => {
    const rows = processRows(
      [['321-MX-01', 'Main Switch', 'Maintenance', '321', 'true', 'true', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].status).toBe('new')
    expect(rows[0].error).toBeUndefined()
  })

  it('marks a row as existing when equipment_id is already in Supabase', () => {
    const rows = processRows(
      [['A-1', 'X', 'Y', '', '', '', '']],
      headerMap(),
      new Set(['A-1']),
    )
    expect(rows[0].status).toBe('existing')
  })

  it('flags a row with missing equipment_id as invalid', () => {
    const rows = processRows(
      [['', 'X', 'Y', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toContain('equipment_id')
  })

  it('flags a row with missing description as invalid', () => {
    const rows = processRows(
      [['A-1', '', 'Y', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].error).toContain('description')
  })

  it('flags a row with missing department as invalid', () => {
    const rows = processRows(
      [['A-1', 'X', '', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].error).toContain('department')
  })

  it('combines multiple errors into one message', () => {
    const rows = processRows(
      [['', '', '', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].error).toContain('equipment_id')
    expect(rows[0].error).toContain('description')
    expect(rows[0].error).toContain('department')
  })

  it('treats whitespace-only required fields as missing', () => {
    const rows = processRows(
      [['  ', '\t', '   ', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].status).toBe('invalid')
  })

  it('invalid status takes precedence over existing', () => {
    const rows = processRows(
      [['', '', '', '', '', '', '']],
      headerMap(),
      new Set(['']),
    )
    expect(rows[0].status).toBe('invalid')
  })
})

describe('processRows — prefix derivation', () => {
  it('uses the supplied prefix when present', () => {
    const rows = processRows(
      [['321-MX-01', 'X', 'Y', 'CUSTOM', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].prefix).toBe('CUSTOM')
  })

  it('derives prefix from equipment_id when the column is empty', () => {
    const rows = processRows(
      [['321-MX-01', 'X', 'Y', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].prefix).toBe('321')
  })

  it('derives prefix from equipment_id when the column is absent entirely', () => {
    const rows = processRows(
      [['321-MX-01', 'X', 'Y']],
      headerMap({ prefix: undefined, needsequipphoto: undefined, needsisophoto: undefined, notes: undefined }),
      new Set(),
    )
    expect(rows[0].prefix).toBe('321')
  })

  it('falls back to the full equipment_id when there is no dash', () => {
    const rows = processRows(
      [['NODASH', 'X', 'Y', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].prefix).toBe('NODASH')
  })

  it('derives prefix from the FIRST dash only (handles multi-segment ids)', () => {
    const rows = processRows(
      [['450-PMP-01-REV-A', 'X', 'Y', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].prefix).toBe('450')
  })
})

describe('processRows — booleans', () => {
  it('defaults needs_equip_photo and needs_iso_photo to true when columns are absent', () => {
    const rows = processRows(
      [['A-1', 'X', 'Y']],
      headerMap({ prefix: undefined, needsequipphoto: undefined, needsisophoto: undefined, notes: undefined }),
      new Set(),
    )
    expect(rows[0].needsEquipPhoto).toBe(true)
    expect(rows[0].needsIsoPhoto).toBe(true)
  })

  it('defaults to true when the cell is blank but the column exists', () => {
    const rows = processRows(
      [['A-1', 'X', 'Y', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].needsEquipPhoto).toBe(true)
    expect(rows[0].needsIsoPhoto).toBe(true)
  })

  it('parses yes / no correctly', () => {
    const rows = processRows(
      [['A-1', 'X', 'Y', '', 'no', 'YES', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].needsEquipPhoto).toBe(false)
    expect(rows[0].needsIsoPhoto).toBe(true)
  })

  it('flags an unrecognised boolean as invalid', () => {
    const rows = processRows(
      [['A-1', 'X', 'Y', '', 'maybe', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].error).toContain('needs_equip_photo')
  })
})

describe('processRows — notes and trimming', () => {
  it('treats an empty notes cell as null', () => {
    const rows = processRows(
      [['A-1', 'X', 'Y', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].notes).toBeNull()
  })

  it('preserves non-empty notes and trims surrounding whitespace', () => {
    const rows = processRows(
      [['A-1', 'X', 'Y', '', '', '', '  check torque  ']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].notes).toBe('check torque')
  })

  it('trims whitespace on required fields', () => {
    const rows = processRows(
      [['  A-1  ', '  Desc  ', '  Dept  ', '', '', '', '']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].equipmentId).toBe('A-1')
    expect(rows[0].description).toBe('Desc')
    expect(rows[0].department).toBe('Dept')
  })
})

describe('processRows — ragged rows', () => {
  it('treats cells past end-of-row as empty (short row is missing optional columns)', () => {
    // Row has only the first three cells; prefix / booleans / notes are undefined.
    const rows = processRows(
      [['A-1', 'Desc', 'Dept']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].status).toBe('new')
    expect(rows[0].prefix).toBe('A')
    expect(rows[0].needsEquipPhoto).toBe(true)
    expect(rows[0].needsIsoPhoto).toBe(true)
    expect(rows[0].notes).toBeNull()
  })

  it('ignores extra trailing cells beyond the declared header width', () => {
    const rows = processRows(
      [['A-1', 'Desc', 'Dept', '', '', '', '', 'EXTRA1', 'EXTRA2']],
      headerMap(),
      new Set(),
    )
    expect(rows[0].status).toBe('new')
  })
})

describe('processRows — duplicates within the file', () => {
  it('flags the second occurrence as invalid', () => {
    const rows = processRows(
      [
        ['A-1', 'X', 'Y', '', '', '', ''],
        ['A-1', 'X', 'Y', '', '', '', ''],
      ],
      headerMap(),
      new Set(),
    )
    expect(rows[0].status).toBe('new')
    expect(rows[1].status).toBe('invalid')
    expect(rows[1].error).toContain('Duplicate')
  })

  it('does not flag a row whose equipment_id is empty (already invalid) as a duplicate', () => {
    const rows = processRows(
      [
        ['', 'X', 'Y', '', '', '', ''],
        ['', 'X', 'Y', '', '', '', ''],
      ],
      headerMap(),
      new Set(),
    )
    // Both are invalid for "missing equipment_id", but neither should add
    // "Duplicate" to its message.
    expect(rows[0].error ?? '').not.toContain('Duplicate')
    expect(rows[1].error ?? '').not.toContain('Duplicate')
  })
})

// ------------------------------ toInsertRow ------------------------------

describe('toInsertRow', () => {
  const parsed: ParsedRow = {
    equipmentId: 'A-1',
    description: 'X',
    department:  'Y',
    prefix:      'A',
    needsEquipPhoto: false,
    needsIsoPhoto:   true,
    notes: 'hello',
    status: 'new',
  }

  it('maps camelCase fields to snake_case columns', () => {
    const row = toInsertRow(parsed)
    expect(row.equipment_id).toBe('A-1')
    expect(row.description).toBe('X')
    expect(row.department).toBe('Y')
    expect(row.prefix).toBe('A')
    expect(row.needs_equip_photo).toBe(false)
    expect(row.needs_iso_photo).toBe(true)
    expect(row.notes).toBe('hello')
  })

  it('hard-codes the system-controlled fields regardless of input', () => {
    const row = toInsertRow(parsed)
    expect(row.has_equip_photo).toBe(false)
    expect(row.has_iso_photo).toBe(false)
    expect(row.photo_status).toBe('missing')
    expect(row.needs_verification).toBe(false)
    expect(row.verified).toBe(false)
    expect(row.spanish_reviewed).toBe(false)
  })

  it('omits the id column (uuid default)', () => {
    expect('id' in toInsertRow(parsed)).toBe(false)
  })

  it('preserves null notes', () => {
    const row = toInsertRow({ ...parsed, notes: null })
    expect(row.notes).toBeNull()
  })
})

// ------------------------------ decodeFile ------------------------------

function fileFromBytes(bytes: number[], name = 'test.csv'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'text/csv' })
}

describe('decodeFile', () => {
  it('decodes valid UTF-8 content', async () => {
    const text = 'equipment_id,description\n321-MX-01,Café'
    const file = new File([text], 'test.csv', { type: 'text/csv' })
    expect(await decodeFile(file)).toBe(text)
  })

  it('falls back to Latin-1 when the bytes are invalid UTF-8', async () => {
    // "Café" encoded as Latin-1: 43 61 66 E9. The trailing 0xE9 is not a valid
    // UTF-8 continuation byte, so strict UTF-8 will throw and we fall back.
    const bytes = [0x43, 0x61, 0x66, 0xe9]
    const result = await decodeFile(fileFromBytes(bytes))
    expect(result).toBe('Café')
  })

  it('round-trips an Excel-style Latin-1 CSV export', async () => {
    // "a,b\nx,é" in Latin-1
    const bytes = [0x61, 0x2c, 0x62, 0x0a, 0x78, 0x2c, 0xe9]
    const result = await decodeFile(fileFromBytes(bytes))
    expect(result).toBe('a,b\nx,é')
  })
})

// ------------------------------ integration ------------------------------

describe('end-to-end — the example from the spec', () => {
  const csv = [
    'equipment_id,description,department,prefix,needs_equip_photo,needs_iso_photo,notes',
    '321-MX-01,Main Disconnect Switch,Maintenance,321,true,true,',
    '321-MX-02,Motor Control Center,Maintenance,321,true,true,',
    '450-PMP-01,Feed Pump Motor,Operations,450,true,false,Check torque specs',
    '450-VLV-01,Isolation Valve,Operations,450,false,true,Manual valve only',
  ].join('\n')

  it('parses and classifies all four rows as new against an empty DB', () => {
    const all = parseCsv(csv)
    const map = buildHeaderMap(all[0])
    if ('error' in map) throw new Error(map.error)

    const rows = processRows(all.slice(1), map, new Set())
    expect(rows).toHaveLength(4)
    expect(rows.every(r => r.status === 'new')).toBe(true)
  })

  it('classifies existing IDs as existing, leaving the rest as new', () => {
    const all = parseCsv(csv)
    const map = buildHeaderMap(all[0])
    if ('error' in map) throw new Error(map.error)

    const rows = processRows(all.slice(1), map, new Set(['321-MX-01', '450-VLV-01']))
    expect(rows[0].status).toBe('existing')
    expect(rows[1].status).toBe('new')
    expect(rows[2].status).toBe('new')
    expect(rows[3].status).toBe('existing')
  })

  it('converts each new row through toInsertRow with hard-coded defaults', () => {
    const all = parseCsv(csv)
    const map = buildHeaderMap(all[0])
    if ('error' in map) throw new Error(map.error)

    const inserts = processRows(all.slice(1), map, new Set())
      .filter(r => r.status === 'new')
      .map(toInsertRow)

    expect(inserts).toHaveLength(4)
    for (const row of inserts) {
      expect(row.has_equip_photo).toBe(false)
      expect(row.has_iso_photo).toBe(false)
      expect(row.photo_status).toBe('missing')
      expect(row.needs_verification).toBe(false)
      expect(row.verified).toBe(false)
      expect(row.spanish_reviewed).toBe(false)
    }

    expect(inserts[2].notes).toBe('Check torque specs')
    expect(inserts[2].needs_iso_photo).toBe(false)
    expect(inserts[3].needs_equip_photo).toBe(false)
  })
})
