// OSHA Form 300 — Log of Work-Related Injuries and Illnesses.
//
// Rendered from scratch (no fillable template) so layout drift on
// OSHA's published PDFs doesn't break us, and so we can paginate
// dynamically — one page can hold ~16 cases, additional pages get
// auto-generated for tenants with longer logs.
//
// Landscape Letter. The columns mirror the official form's letter
// labels (A–N + the four injury/illness categories) for clarity at
// audit time. Privacy-case rows ship "Privacy Case" in column B and
// blank columns C + E per 1904.29(b)(7).

import { PDFDocument, StandardFonts, type PDFPage, type PDFFont, rgb } from 'pdf-lib'
import { sanitizeForWinAnsi, drawBrandMark } from '@/lib/pdfShared'
import {
  type Osha300Row,
  INJURY_TYPE_LABEL,
} from '@soteria/core/oshaForms'

// Landscape Letter: 11" × 8.5" (792 × 612).
const PAGE_W   = 792
const PAGE_H   = 612
const MARGIN_X = 28
const MARGIN_Y = 36

const NAVY   = rgb(0.13, 0.27, 0.53)
const SLATE  = rgb(0.15, 0.18, 0.23)
const MUTED  = rgb(0.45, 0.50, 0.55)
const RULE   = rgb(0.82, 0.85, 0.90)
const WHITE  = rgb(1, 1, 1)
const BLACK  = rgb(0, 0, 0)

interface RenderOpts {
  rows:                ReadonlyArray<Osha300Row>
  establishmentName:   string
  city:                string | null
  state:               string | null
  year:                number
  // Optional company display info — lands in the header.
  companyName?:        string | null
}

// Column layout: percentages of usable width (PAGE_W - 2*MARGIN_X).
// The 16 columns fit the form's structure:
//   A case#, B name, C job, D date, E location, F desc,
//   G death, H days_away, I restricted, J other,
//   K days_away days, L days_restricted days,
//   then six injury/illness category checkboxes.
// We collapse the six injury/illness categories into one column
// labelled "Type" since most rows are 'injury' — saves horizontal
// real estate for the columns that actually carry data.

interface ColumnDef {
  key:    string
  label:  string
  widthPct: number
  align?: 'left' | 'center' | 'right'
}

const COLUMNS: ColumnDef[] = [
  { key: 'A',  label: 'A — Case #',     widthPct: 7,   align: 'left'   },
  { key: 'B',  label: 'B — Employee',   widthPct: 11,  align: 'left'   },
  { key: 'C',  label: 'C — Job title',  widthPct: 9,   align: 'left'   },
  { key: 'D',  label: 'D — Date',       widthPct: 6,   align: 'center' },
  { key: 'E',  label: 'E — Location',   widthPct: 11,  align: 'left'   },
  { key: 'F',  label: 'F — Description', widthPct: 22, align: 'left'   },
  { key: 'G',  label: 'G',              widthPct: 3,   align: 'center' },
  { key: 'H',  label: 'H',              widthPct: 3,   align: 'center' },
  { key: 'I',  label: 'I',              widthPct: 3,   align: 'center' },
  { key: 'J',  label: 'J',              widthPct: 3,   align: 'center' },
  { key: 'K',  label: 'K — Days away',  widthPct: 5,   align: 'center' },
  { key: 'L',  label: 'L — Restr.',     widthPct: 5,   align: 'center' },
  { key: 'M',  label: 'M — Type',       widthPct: 12,  align: 'left'   },
]

const ROW_H = 28          // mm-ish row height — matches the form's "two-line" rows
const HEADER_BAND_H = 24
const COL_HEAD_H = 18

export async function renderOsha300Pdf(opts: RenderOpts): Promise<Uint8Array> {
  const pdf  = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Pre-compute column x-positions / widths in absolute units.
  const usable = PAGE_W - MARGIN_X * 2
  const totalPct = COLUMNS.reduce((s, c) => s + c.widthPct, 0)
  const colXs: number[] = []
  const colWs: number[] = []
  let cx = MARGIN_X
  for (const col of COLUMNS) {
    const w = (col.widthPct / totalPct) * usable
    colXs.push(cx)
    colWs.push(w)
    cx += w
  }

  // ── Pagination ───────────────────────────────────────────────────────────
  // First page: header band (title + establishment + year) + column
  // header strip + N data rows. Subsequent pages: column header strip
  // + N data rows. The body height available depends on the page.
  const firstBodyTop = PAGE_H - MARGIN_Y - HEADER_BAND_H - 6 - COL_HEAD_H
  const restBodyTop  = PAGE_H - MARGIN_Y - COL_HEAD_H
  const bodyBottom   = MARGIN_Y + 24                  // leave room for footer
  const firstRows    = Math.max(1, Math.floor((firstBodyTop - bodyBottom) / ROW_H))
  const restRows     = Math.max(1, Math.floor((restBodyTop  - bodyBottom) / ROW_H))

  const total = opts.rows.length
  // Build a flat list of (page index, slice of rows) tuples.
  const pages: Array<Osha300Row[]> = []
  if (total === 0) {
    pages.push([])
  } else {
    let idx = 0
    pages.push(opts.rows.slice(idx, idx + firstRows))
    idx += firstRows
    while (idx < total) {
      pages.push(opts.rows.slice(idx, idx + restRows))
      idx += restRows
    }
  }

  for (let p = 0; p < pages.length; p++) {
    const page = pdf.addPage([PAGE_W, PAGE_H])
    const isFirst = p === 0
    const slice   = pages[p]!
    drawHeader(page, font, bold, opts, isFirst, p, pages.length)
    const tableTop = isFirst ? firstBodyTop + COL_HEAD_H : restBodyTop + COL_HEAD_H
    drawColumnHeader(page, bold, colXs, colWs, tableTop)
    drawRows(page, font, bold, colXs, colWs, tableTop - COL_HEAD_H, slice, isFirst ? firstRows : restRows)
    drawFooter(page, font, opts, p, pages.length)
  }

  return await pdf.save()
}

// ──────────────────────────────────────────────────────────────────────────
// Drawing primitives
// ──────────────────────────────────────────────────────────────────────────

function drawHeader(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  opts: RenderOpts,
  isFirst: boolean,
  pageIdx: number,
  pageCount: number,
) {
  if (!isFirst) {
    // Compact header strip on continuation pages.
    page.drawText(sanitizeForWinAnsi(`OSHA Form 300 — ${opts.year} log — ${opts.establishmentName} (page ${pageIdx + 1} of ${pageCount})`), {
      x: MARGIN_X, y: PAGE_H - MARGIN_Y, size: 9, font: bold, color: SLATE,
    })
    return
  }

  const top = PAGE_H - MARGIN_Y
  page.drawRectangle({
    x: MARGIN_X, y: top - HEADER_BAND_H,
    width: PAGE_W - 2 * MARGIN_X, height: HEADER_BAND_H,
    color: NAVY,
  })
  // SoteriaField brand mark on the right edge of the navy band.
  // Light tone (cream + teal) so it reads on the navy backdrop.
  drawBrandMark({
    page, font, bold,
    x: PAGE_W - MARGIN_X - 92,
    y: top - HEADER_BAND_H + 4,
    height: 16,
    tone: 'light',
    withWordmark: true,
  })
  page.drawText('OSHA Form 300 — Log of Work-Related Injuries and Illnesses', {
    x: MARGIN_X + 8, y: top - 17, size: 12, font: bold, color: WHITE,
  })
  page.drawText(`Year ${opts.year}`, {
    x: MARGIN_X + 460, y: top - 17, size: 11, font: bold, color: WHITE,
  })

  // Establishment / company line.
  const subY = top - HEADER_BAND_H - 14
  const companyLine = sanitizeForWinAnsi(
    [opts.companyName, opts.establishmentName, [opts.city, opts.state].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join('  ·  '),
  )
  page.drawText(companyLine, {
    x: MARGIN_X, y: subY, size: 10, font, color: SLATE,
  })
}

function drawColumnHeader(
  page: PDFPage,
  bold: PDFFont,
  colXs: number[],
  colWs: number[],
  topY: number,
) {
  const headY = topY - COL_HEAD_H
  page.drawRectangle({
    x: MARGIN_X, y: headY,
    width: colXs[colXs.length - 1]! + colWs[colWs.length - 1]! - MARGIN_X,
    height: COL_HEAD_H, color: rgb(0.93, 0.95, 0.98),
  })

  // Outer frame (column header + body bottom rules drawn per-row).
  page.drawLine({
    start: { x: MARGIN_X, y: topY }, end: { x: PAGE_W - MARGIN_X, y: topY },
    thickness: 0.5, color: SLATE,
  })

  for (let i = 0; i < COLUMNS.length; i++) {
    const x = colXs[i]!
    page.drawText(sanitizeForWinAnsi(COLUMNS[i]!.label), {
      x: x + 3, y: headY + 5, size: 7.5, font: bold, color: SLATE,
    })
    // Vertical rule on the left edge of every column except the first.
    if (i > 0) {
      page.drawLine({
        start: { x, y: topY }, end: { x, y: headY },
        thickness: 0.5, color: RULE,
      })
    }
  }
  // Right border.
  page.drawLine({
    start: { x: PAGE_W - MARGIN_X, y: topY }, end: { x: PAGE_W - MARGIN_X, y: headY },
    thickness: 0.5, color: RULE,
  })

  // Sub-label band: G "Death", H "Days away", I "Job transfer or restriction", J "Other"
  const subBandY = headY - 8
  page.drawText('Classify case (check one)', {
    x: colXs[6]! + 1, y: subBandY, size: 6, font: bold, color: MUTED,
  })
}

function drawRows(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  colXs: number[],
  colWs: number[],
  topY: number,
  rows: ReadonlyArray<Osha300Row>,
  rowSlots: number,
) {
  // Draw the row grid first (rowSlots rows even if empty — the form
  // is meant to look like an empty log when unused).
  for (let r = 0; r < rowSlots; r++) {
    const y = topY - (r + 1) * ROW_H
    page.drawLine({
      start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y },
      thickness: 0.4, color: RULE,
    })
    for (let i = 0; i < COLUMNS.length; i++) {
      const x = colXs[i]!
      if (i > 0) {
        page.drawLine({
          start: { x, y }, end: { x, y: y + ROW_H },
          thickness: 0.4, color: RULE,
        })
      }
    }
  }
  // Outer right + left rules along the table.
  page.drawLine({
    start: { x: MARGIN_X, y: topY }, end: { x: MARGIN_X, y: topY - rowSlots * ROW_H },
    thickness: 0.5, color: SLATE,
  })
  page.drawLine({
    start: { x: PAGE_W - MARGIN_X, y: topY }, end: { x: PAGE_W - MARGIN_X, y: topY - rowSlots * ROW_H },
    thickness: 0.5, color: SLATE,
  })

  // Now fill the rows.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    const yTop = topY - r * ROW_H
    const yMid = yTop - ROW_H / 2 + 2
    const yBot = yTop - ROW_H + 4

    drawCell(page, font, row.case_number,                        colXs[0]!,  colWs[0]!,  yMid, 8)
    drawCell(page, font, row.employee_name,                      colXs[1]!,  colWs[1]!,  yMid, 8)
    drawCell(page, font, row.job_title ?? '',                    colXs[2]!,  colWs[2]!,  yMid, 8)
    drawCell(page, font, row.date_of_injury,                     colXs[3]!,  colWs[3]!,  yMid, 8, 'center')
    drawCell(page, font, row.location_text ?? '',                colXs[4]!,  colWs[4]!,  yMid, 8)
    drawCell(page, font, row.injury_description ?? '',           colXs[5]!,  colWs[5]!,  yMid, 8)

    // Classification radios — exactly one X mark.
    const cl = row.classification
    if (cl === 'death')            drawCheck(page, bold, colXs[6]!,  colWs[6]!,  yMid)
    if (cl === 'days_away')        drawCheck(page, bold, colXs[7]!,  colWs[7]!,  yMid)
    if (cl === 'restricted')       drawCheck(page, bold, colXs[8]!,  colWs[8]!,  yMid)
    if (cl === 'other_recordable') drawCheck(page, bold, colXs[9]!,  colWs[9]!,  yMid)

    drawCell(page, font, String(row.days_away || ''),       colXs[10]!, colWs[10]!, yMid, 8, 'center')
    drawCell(page, font, String(row.days_restricted || ''), colXs[11]!, colWs[11]!, yMid, 8, 'center')
    drawCell(page, font, INJURY_TYPE_LABEL[row.injury_type], colXs[12]!, colWs[12]!, yMid, 8)

    // Privacy stamp on the date row.
    if (row.is_privacy_case) {
      page.drawText('PRIVACY', {
        x: colXs[1]! + 3, y: yBot, size: 6, font: bold, color: rgb(0.7, 0.1, 0.1),
      })
    }
  }
}

function drawCell(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  w: number,
  y: number,
  size: number,
  align: 'left' | 'center' | 'right' = 'left',
) {
  // Truncate text that won't fit on a single line. The 300 has tight
  // columns; we use a single-line policy and let the PDF reader's
  // tooltips reveal the full description if needed.
  const safe = sanitizeForWinAnsi(text)
  if (!safe) return
  let display = safe
  // Rough width estimate without measuring — Helvetica avg ~0.5 char-widths.
  const maxChars = Math.max(1, Math.floor((w - 6) / (size * 0.5)))
  if (display.length > maxChars) display = display.slice(0, maxChars - 1) + '…'
  let tx = x + 3
  if (align === 'center') {
    const approx = display.length * size * 0.5
    tx = x + (w - approx) / 2
  } else if (align === 'right') {
    const approx = display.length * size * 0.5
    tx = x + w - approx - 3
  }
  page.drawText(display, { x: tx, y, size, font, color: BLACK })
}

function drawCheck(page: PDFPage, font: PDFFont, x: number, w: number, y: number) {
  page.drawText('X', {
    x: x + w / 2 - 3, y, size: 11, font, color: rgb(0.6, 0.1, 0.1),
  })
}

function drawFooter(page: PDFPage, font: PDFFont, opts: RenderOpts, pageIdx: number, pageCount: number) {
  page.drawText(sanitizeForWinAnsi(`Generated by SoteriaField · ${opts.year} · Page ${pageIdx + 1} of ${pageCount}`), {
    x: MARGIN_X, y: MARGIN_Y - 10, size: 7, font, color: MUTED,
  })
  page.drawText('Privacy-case names suppressed per 29 CFR 1904.29(b)(7-9).', {
    x: PAGE_W - MARGIN_X - 240, y: MARGIN_Y - 10, size: 7, font, color: MUTED,
  })
}
