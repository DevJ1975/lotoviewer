export interface ParsedRow {
  equipmentId:     string
  description:     string
  department:      string
  prefix:          string
  needsEquipPhoto: boolean
  needsIsoPhoto:   boolean
  notes:           string | null
  status: 'new' | 'existing' | 'invalid'
  error?: string
}

export interface NewEquipmentRow {
  equipment_id:       string
  description:        string
  department:         string
  prefix:             string
  needs_equip_photo:  boolean
  needs_iso_photo:    boolean
  notes:              string | null
  has_equip_photo:    false
  has_iso_photo:      false
  photo_status:       'missing'
  needs_verification: false
  verified:           false
  spanish_reviewed:   false
}

export interface HeaderMap {
  equipmentid:     number
  description:     number
  department:      number
  prefix?:         number
  needsequipphoto?: number
  needsisophoto?:   number
  notes?:          number
}

// RFC 4180: quoted fields, "" escapes inside quotes, CRLF or LF line endings.
export function parseCsv(text: string): string[][] {
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const len = text.length

  while (i < len) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }

    if (c === '"' && field === '') { inQuotes = true; i++; continue }

    if (c === ',')  { row.push(field); field = ''; i++; continue }
    if (c === '\r') {
      row.push(field); rows.push(row)
      row = []; field = ''
      i += text[i + 1] === '\n' ? 2 : 1
      continue
    }
    if (c === '\n') {
      row.push(field); rows.push(row)
      row = []; field = ''
      i++
      continue
    }

    field += c
    i++
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_]+/g, '')
}

// Returns true/false for recognised values, null for unrecognised.
// An empty / absent cell returns the provided default.
export function parseBool(raw: string | undefined, defaultValue: boolean): boolean | null {
  if (raw === undefined) return defaultValue
  const v = raw.trim().toLowerCase()
  if (v === '') return defaultValue
  if (v === 'true'  || v === 'yes' || v === '1') return true
  if (v === 'false' || v === 'no'  || v === '0') return false
  return null
}

export async function decodeFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('latin1').decode(buf)
  }
}

export function buildHeaderMap(headerRow: string[]): HeaderMap | { error: string } {
  const idx: Record<string, number> = {}
  for (let i = 0; i < headerRow.length; i++) {
    const key = normalizeHeader(headerRow[i])
    if (key) idx[key] = i
  }

  const missing: string[] = []
  if (!('equipmentid' in idx)) missing.push('equipment_id')
  if (!('description' in idx)) missing.push('description')
  if (!('department'  in idx)) missing.push('department')
  if (missing.length > 0) {
    return { error: `Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}` }
  }

  return {
    equipmentid:      idx.equipmentid,
    description:      idx.description,
    department:       idx.department,
    prefix:           idx.prefix,
    needsequipphoto:  idx.needsequipphoto,
    needsisophoto:    idx.needsisophoto,
    notes:            idx.notes,
  }
}

function cell(row: string[], i: number | undefined): string {
  if (i === undefined) return ''
  return (row[i] ?? '').trim()
}

export function processRows(
  dataRows: string[][],
  headerMap: HeaderMap,
  existingIds: ReadonlySet<string>,
): ParsedRow[] {
  const seenInFile = new Set<string>()
  const result: ParsedRow[] = []

  for (const raw of dataRows) {
    const equipmentId = cell(raw, headerMap.equipmentid)
    const description = cell(raw, headerMap.description)
    const department  = cell(raw, headerMap.department)

    const rawPrefix = cell(raw, headerMap.prefix)
    const prefix = rawPrefix || (equipmentId.includes('-') ? equipmentId.split('-')[0] : equipmentId)

    const equipBoolRaw = headerMap.needsequipphoto !== undefined ? raw[headerMap.needsequipphoto] : undefined
    const isoBoolRaw   = headerMap.needsisophoto   !== undefined ? raw[headerMap.needsisophoto]   : undefined
    const needsEquip   = parseBool(equipBoolRaw, true)
    const needsIso     = parseBool(isoBoolRaw, true)

    const notesRaw = cell(raw, headerMap.notes)
    const notes = notesRaw === '' ? null : notesRaw

    const errors: string[] = []
    if (!equipmentId) errors.push('Missing equipment_id')
    if (!description) errors.push('Missing description')
    if (!department)  errors.push('Missing department')
    if (needsEquip === null) errors.push('Invalid needs_equip_photo')
    if (needsIso   === null) errors.push('Invalid needs_iso_photo')
    if (equipmentId && seenInFile.has(equipmentId)) errors.push('Duplicate equipment_id in file')
    if (equipmentId) seenInFile.add(equipmentId)

    let status: ParsedRow['status'] = 'new'
    let error: string | undefined
    if (errors.length > 0) {
      status = 'invalid'
      error = errors.join('; ')
    } else if (existingIds.has(equipmentId)) {
      status = 'existing'
    }

    result.push({
      equipmentId,
      description,
      department,
      prefix,
      needsEquipPhoto: needsEquip ?? true,
      needsIsoPhoto:   needsIso   ?? true,
      notes,
      status,
      error,
    })
  }

  return result
}

export function toInsertRow(row: ParsedRow): NewEquipmentRow {
  return {
    equipment_id:       row.equipmentId,
    description:        row.description,
    department:         row.department,
    prefix:             row.prefix,
    needs_equip_photo:  row.needsEquipPhoto,
    needs_iso_photo:    row.needsIsoPhoto,
    notes:              row.notes,
    has_equip_photo:    false,
    has_iso_photo:      false,
    photo_status:       'missing',
    needs_verification: false,
    verified:           false,
    spanish_reviewed:   false,
  }
}
