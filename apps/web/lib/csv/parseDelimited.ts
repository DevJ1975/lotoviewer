// Dependency-free delimited-text parser for the historical-import CSV
// path. Turns a comma- OR tab-separated export into a header list plus
// one record per row, keyed by header.
//
// Why hand-rolled instead of a library: the only input is a user's
// 300A export (a handful of columns, a few dozen rows), and the format
// is RFC-4180 CSV or its tab-separated cousin. A parser that handles
// quoting, embedded delimiters/newlines, CRLF, BOM, and blank lines is
// ~60 lines — not worth an npm dependency or its supply-chain surface.
//
// NOT handled: .xlsx (binary). That needs a heavy spreadsheet library
// (e.g. SheetJS) we deliberately don't pull in. The UI restricts the
// file picker to .csv/.tsv and tells the admin to "Save As CSV" from
// Excel; this parser assumes text in.

export interface ParsedDelimited {
  headers: string[]
  rows:    Record<string, string>[]
}

// Auto-detect the delimiter from the header line: tab if the first
// line has any tab, else comma. Counting on the first line (not the
// whole file) avoids being fooled by a comma inside a quoted data
// cell — a tab in the header is an unambiguous TSV signal.
function detectDelimiter(firstLine: string): ',' | '\t' {
  return firstLine.includes('\t') ? '\t' : ','
}

// RFC-4180-style record reader: parses the whole text into rows of
// fields. Handles double-quoted fields (which may contain the
// delimiter, quotes via "" escaping, and literal newlines), CRLF + LF
// line endings, and a trailing newline. Fully-blank lines are dropped.
function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let sawField = false // distinguishes a real (possibly empty) field from "no field yet"

  const pushField = () => { record.push(field); field = ''; sawField = false }
  const pushRecord = () => {
    pushField()
    // Drop fully-blank lines (e.g. a stray "," or trailing newline run):
    // a record whose every cell is empty carries no data.
    if (record.some(cell => cell.length > 0)) records.push(record)
    record = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue } // "" → literal "
        inQuotes = false
        continue
      }
      field += c
      continue
    }

    // A quote only opens a quoted field at the field's start; a quote
    // mid-field is treated literally (lenient, matches spreadsheets).
    if (c === '"' && field === '' && !sawField) { inQuotes = true; sawField = true; continue }
    if (c === delimiter) { pushField(); continue }
    if (c === '\r') {
      pushRecord()
      if (text[i + 1] === '\n') i++ // consume the LF of a CRLF pair
      continue
    }
    if (c === '\n') { pushRecord(); continue }

    field += c
    sawField = true
  }

  // Flush a final record with no trailing newline.
  if (sawField || field.length > 0 || record.length > 0) pushRecord()

  return records
}

// Parse delimited text into headers + keyed rows.
//
// - Strips a leading UTF-8 BOM.
// - Auto-detects comma vs tab from the header line.
// - Header cells are trimmed; duplicate headers keep the FIRST column
//   (a later same-named column is ignored) so a row's value is
//   deterministic.
// - Each data row is keyed by header; missing trailing cells default
//   to '' and extra cells beyond the header count are dropped.
export function parseDelimited(text: string): ParsedDelimited {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  // Detect on the first physical line, before any quoting matters for
  // the delimiter choice (a header rarely quotes).
  const firstLineEnd = clean.search(/\r\n|\r|\n/)
  const firstLine = firstLineEnd === -1 ? clean : clean.slice(0, firstLineEnd)
  const delimiter = detectDelimiter(firstLine)

  const records = parseRecords(clean, delimiter)
  if (records.length === 0) return { headers: [], rows: [] }

  const headers = records[0]!.map(h => h.trim())

  const rows: Record<string, string>[] = []
  for (let r = 1; r < records.length; r++) {
    const cells = records[r]!
    const row: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]!
      if (key === '' || key in row) continue // skip blank + duplicate headers
      row[key] = cells[c] ?? ''
    }
    rows.push(row)
  }

  return { headers, rows }
}
