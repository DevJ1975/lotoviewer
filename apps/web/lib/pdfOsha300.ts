// OSHA Form 300 — Log of Work-Related Injuries and Illnesses.
//
// Layout-faithful replica of the official OSHA Form 300 (Rev. 01/2004),
// reproduced from the public-domain government form. Drawn from
// scratch — no fillable template overlay — so we can paginate
// dynamically and avoid drift on OSHA-published PDFs.
//
// Differences from the official form: SoteriaField provenance line
// in the bottom margin (form body is unmodified), colour palette
// is pure black on white for printability + audit fidelity.
// Privacy-case rows ship "Privacy Case" in column B and blank
// columns C + E per 1904.29(b)(7).

import { PDFDocument, StandardFonts, type PDFPage, type PDFFont, rgb } from 'pdf-lib'
import { sanitizeForWinAnsi } from '@/lib/pdfShared'
import {
  type Osha300Row,
} from '@soteria/core/oshaForms'

// Landscape Letter: 11" × 8.5" (792 × 612).
const PAGE_W   = 792
const PAGE_H   = 612
const MARGIN_X = 24
const MARGIN_Y = 28

const BLACK = rgb(0, 0, 0)
const GREY  = rgb(0.4, 0.4, 0.4)

interface RenderOpts {
  rows:                ReadonlyArray<Osha300Row>
  establishmentName:   string
  city:                string | null
  state:               string | null
  year:                number
  // Optional company display info.
  companyName?:        string | null
}

// Column geometry — replicates the official 300's three-zone layout:
//   ZONE 1 "Identify the person":       A, B, C
//   ZONE 2 "Describe the case":          D, E, F
//   ZONE 3 "Classify the case":          G H I J  (single-X box)
//                                        K L      (day counters)
//                                        1 2 3 4 5 6 (illness type)
//
// Width % values are tuned so all 16 columns + the three zone
// headers fit on landscape Letter without crowding column F
// (Description), which carries the bulk of the prose.
interface ColumnDef {
  key:    string
  label:  string
  sub?:   string             // second header line (for narrow numeric cols)
  widthPct: number
  align?: 'left' | 'center'
}

const COLUMNS: ColumnDef[] = [
  // Zone 1 — identify the person
  { key: 'A',  label: '(A)',   sub: 'Case no.',     widthPct: 4.5, align: 'center' },
  { key: 'B',  label: '(B)',   sub: 'Employee',     widthPct: 9.5, align: 'left'   },
  { key: 'C',  label: '(C)',   sub: 'Job title',    widthPct: 7.5, align: 'left'   },
  // Zone 2 — describe the case
  { key: 'D',  label: '(D)',   sub: 'Date of injury', widthPct: 5.5, align: 'center' },
  { key: 'E',  label: '(E)',   sub: 'Where event occurred', widthPct: 9, align: 'left' },
  { key: 'F',  label: '(F)',   sub: 'Describe injury/illness, parts of body, object/substance', widthPct: 19.5, align: 'left' },
  // Zone 3a — classify (check only one)
  { key: 'G',  label: '(G)',   sub: 'Death',        widthPct: 3.0, align: 'center' },
  { key: 'H',  label: '(H)',   sub: 'Days away',    widthPct: 3.0, align: 'center' },
  { key: 'I',  label: '(I)',   sub: 'Restricted',   widthPct: 3.0, align: 'center' },
  { key: 'J',  label: '(J)',   sub: 'Other rec.',   widthPct: 3.0, align: 'center' },
  // Zone 3b — number of days
  { key: 'K',  label: '(K)',   sub: 'Away days',    widthPct: 4.0, align: 'center' },
  { key: 'L',  label: '(L)',   sub: 'Restr. days',  widthPct: 4.0, align: 'center' },
  // Zone 3c — type of illness/injury (one X per row)
  { key: '1',  label: '(1)',   sub: 'Injury',       widthPct: 3.5, align: 'center' },
  { key: '2',  label: '(2)',   sub: 'Skin',         widthPct: 3.5, align: 'center' },
  { key: '3',  label: '(3)',   sub: 'Respir.',      widthPct: 3.5, align: 'center' },
  { key: '4',  label: '(4)',   sub: 'Poisoning',    widthPct: 3.5, align: 'center' },
  { key: '5',  label: '(5)',   sub: 'Hearing',      widthPct: 3.0, align: 'center' },
  { key: '6',  label: '(6)',   sub: 'Other ill.',   widthPct: 3.5, align: 'center' },
]

const ROW_H = 26
const COL_HEAD_H = 26
const ZONE_HEAD_H = 14
const HEADER_BAND_H = 56     // form title + agency block + establishment line

const TYPE_TO_COL_INDEX: Record<string, number> = {
  injury:        12,
  skin_disorder: 13,
  respiratory:   14,
  poisoning:     15,
  hearing_loss:  16,
  other_illness: 17,
}

export async function renderOsha300Pdf(opts: RenderOpts): Promise<Uint8Array> {
  const pdf  = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique)

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

  const headerTop = PAGE_H - MARGIN_Y
  const tableTop  = headerTop - HEADER_BAND_H - 4
  const bodyBottom = MARGIN_Y + 22
  const rowSlots = Math.max(1, Math.floor((tableTop - ZONE_HEAD_H - COL_HEAD_H - bodyBottom) / ROW_H))

  // Pagination — the official 300 is one row per case; we mirror that.
  const total = opts.rows.length
  const pages: Array<Osha300Row[]> = []
  if (total === 0) {
    pages.push([])
  } else {
    for (let i = 0; i < total; i += rowSlots) pages.push(opts.rows.slice(i, i + rowSlots))
  }

  for (let p = 0; p < pages.length; p++) {
    const page = pdf.addPage([PAGE_W, PAGE_H])
    drawHeader(page, font, bold, oblique, opts, p, pages.length)
    drawZoneHeaders(page, bold, colXs, colWs, tableTop)
    drawColumnHeaders(page, font, bold, colXs, colWs, tableTop - ZONE_HEAD_H)
    drawBody(page, font, bold, colXs, colWs, tableTop - ZONE_HEAD_H - COL_HEAD_H, pages[p]!, rowSlots)
    drawFooter(page, font, oblique, p, pages.length)
  }

  return await pdf.save()
}

// ──────────────────────────────────────────────────────────────────────────

function drawHeader(
  page: PDFPage, font: PDFFont, bold: PDFFont, oblique: PDFFont,
  opts: RenderOpts, pageIdx: number, pageCount: number,
) {
  const top = PAGE_H - MARGIN_Y
  // Form title block — left aligned per the official form.
  page.drawText('OSHA’s Form 300', {
    x: MARGIN_X, y: top - 12, size: 14, font: bold, color: BLACK,
  })
  page.drawText('(Rev. 01/2004)', {
    x: MARGIN_X + 105, y: top - 11, size: 8, font: oblique, color: BLACK,
  })
  page.drawText('Log of Work-Related Injuries and Illnesses', {
    x: MARGIN_X, y: top - 28, size: 13, font: bold, color: BLACK,
  })
  page.drawText(
    sanitizeForWinAnsi(
      'You must record information about every work-related injury or illness that involves loss of consciousness, ' +
      'restricted work activity or job transfer, days away from work, or medical treatment beyond first aid. You ' +
      'must also record significant work-related injuries and illnesses that are diagnosed by a physician or licensed ' +
      'health care professional. You must complete an Injury and Illness Incident Report (OSHA Form 301) or ' +
      'equivalent form for each injury or illness recorded on this form. If you’re not sure whether a case is ' +
      'recordable, call your local OSHA office for help.',
    ),
    { x: MARGIN_X, y: top - 42, size: 6.5, font, color: BLACK, maxWidth: PAGE_W * 0.55, lineHeight: 7.5 },
  )

  // Right side — agency + year + page block.
  const rightX = PAGE_W - MARGIN_X - 220
  page.drawText('U.S. Department of Labor', {
    x: rightX, y: top - 12, size: 9, font: bold, color: BLACK,
  })
  page.drawText('Occupational Safety and Health Administration', {
    x: rightX, y: top - 22, size: 8, font, color: BLACK,
  })
  page.drawText('Form approved OMB no. 1218-0176', {
    x: rightX, y: top - 31, size: 7, font: oblique, color: BLACK,
  })

  // Year + Establishment + page count box, drawn as a small bordered block.
  const yearBoxY = top - 56
  page.drawText(`Year 20${String(opts.year).slice(-2)}`, {
    x: rightX, y: yearBoxY + 4, size: 10, font: bold, color: BLACK,
  })
  // Establishment name / city / state line — required header field on the official form.
  const estLine = sanitizeForWinAnsi(
    [
      `Establishment name: ${opts.establishmentName}`,
      opts.city ? `City: ${opts.city}` : null,
      opts.state ? `State: ${opts.state}` : null,
    ].filter(Boolean).join('   '),
  )
  page.drawText(estLine, {
    x: MARGIN_X, y: top - HEADER_BAND_H + 4, size: 9, font: bold, color: BLACK,
  })
  page.drawText(`Page ${pageIdx + 1} of ${pageCount}`, {
    x: PAGE_W - MARGIN_X - 70, y: top - HEADER_BAND_H + 4, size: 9, font: bold, color: BLACK,
  })
}

function drawZoneHeaders(
  page: PDFPage, bold: PDFFont, colXs: number[], colWs: number[], topY: number,
) {
  // The official form groups columns under three umbrella labels.
  // We mirror those zones exactly so a reader familiar with the OSHA
  // 300 instantly orients.
  const zones: Array<{ start: number; end: number; label: string }> = [
    { start: 0,  end: 2,  label: 'Identify the person' },
    { start: 3,  end: 5,  label: 'Describe the case' },
    { start: 6,  end: 9,  label: 'Classify the case — CHECK ONLY ONE box for each case based on the most serious outcome' },
    { start: 10, end: 11, label: 'Enter the number of days the injured or ill worker was:' },
    { start: 12, end: 17, label: 'Check the "injury" column or choose one type of illness:' },
  ]
  for (const z of zones) {
    const zx  = colXs[z.start]!
    const zxe = colXs[z.end]! + colWs[z.end]!
    page.drawRectangle({
      x: zx, y: topY - ZONE_HEAD_H, width: zxe - zx, height: ZONE_HEAD_H,
      borderColor: BLACK, borderWidth: 0.6,
    })
    page.drawText(sanitizeForWinAnsi(z.label), {
      x: zx + 4, y: topY - ZONE_HEAD_H + 4, size: 7, font: bold, color: BLACK,
      maxWidth: zxe - zx - 8,
    })
  }
}

function drawColumnHeaders(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  colXs: number[], colWs: number[], topY: number,
) {
  for (let i = 0; i < COLUMNS.length; i++) {
    const x = colXs[i]!, w = colWs[i]!
    page.drawRectangle({
      x, y: topY - COL_HEAD_H, width: w, height: COL_HEAD_H,
      borderColor: BLACK, borderWidth: 0.5,
    })
    const c = COLUMNS[i]!
    // Column letter — bold, centered top.
    const labelW = c.label.length * 8 * 0.5
    page.drawText(c.label, {
      x: x + (w - labelW) / 2, y: topY - 10, size: 8, font: bold, color: BLACK,
    })
    if (c.sub) {
      // Sub-label, smaller, centered or left depending on width.
      const sub = sanitizeForWinAnsi(c.sub)
      const cw = w > 60 ? sub : maybeTrunc(sub, w, 6)
      page.drawText(cw, {
        x: x + 2, y: topY - COL_HEAD_H + 4, size: 6, font, color: BLACK,
        maxWidth: w - 4, lineHeight: 6.5,
      })
    }
  }
}

function drawBody(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  colXs: number[], colWs: number[], topY: number,
  rows: ReadonlyArray<Osha300Row>, rowSlots: number,
) {
  // Empty row grid first (all `rowSlots` rows so the form looks
  // identical whether full or empty).
  for (let r = 0; r < rowSlots; r++) {
    const y = topY - (r + 1) * ROW_H
    for (let i = 0; i < COLUMNS.length; i++) {
      const x = colXs[i]!, w = colWs[i]!
      page.drawRectangle({
        x, y, width: w, height: ROW_H, borderColor: BLACK, borderWidth: 0.4,
      })
    }
  }

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    const yTop = topY - r * ROW_H
    const yMid = yTop - ROW_H / 2 + 2

    const employeeDisplay = row.is_privacy_case ? 'Privacy Case' : (row.employee_name ?? '')
    const jobDisplay      = row.is_privacy_case ? '' : (row.job_title ?? '')
    const locDisplay      = row.is_privacy_case ? '' : (row.location_text ?? '')

    drawCell(page, font, row.case_number,                          colXs[0]!,  colWs[0]!,  yMid, 8, 'center')
    drawCell(page, font, employeeDisplay,                          colXs[1]!,  colWs[1]!,  yMid, 8)
    drawCell(page, font, jobDisplay,                               colXs[2]!,  colWs[2]!,  yMid, 8)
    drawCell(page, font, formatMonthDay(row.date_of_injury),       colXs[3]!,  colWs[3]!,  yMid, 8, 'center')
    drawCell(page, font, locDisplay,                               colXs[4]!,  colWs[4]!,  yMid, 8)
    drawCell(page, font, row.injury_description ?? '',             colXs[5]!,  colWs[5]!,  yMid, 8)

    // Classification (G/H/I/J) — exactly one X.
    const cl = row.classification
    if (cl === 'death')             drawCheck(page, bold, colXs[6]!,  colWs[6]!,  yMid)
    if (cl === 'days_away')         drawCheck(page, bold, colXs[7]!,  colWs[7]!,  yMid)
    if (cl === 'restricted')        drawCheck(page, bold, colXs[8]!,  colWs[8]!,  yMid)
    if (cl === 'other_recordable')  drawCheck(page, bold, colXs[9]!,  colWs[9]!,  yMid)

    drawCell(page, font, row.days_away      ? String(row.days_away)      : '', colXs[10]!, colWs[10]!, yMid, 8, 'center')
    drawCell(page, font, row.days_restricted ? String(row.days_restricted) : '', colXs[11]!, colWs[11]!, yMid, 8, 'center')

    // Injury / illness type (1-6) — one X per row.
    const typeIdx = TYPE_TO_COL_INDEX[row.injury_type]
    if (typeIdx != null) drawCheck(page, bold, colXs[typeIdx]!, colWs[typeIdx]!, yMid)
  }
}

function drawCell(
  page: PDFPage, font: PDFFont, text: string,
  x: number, w: number, y: number, size: number,
  align: 'left' | 'center' = 'left',
) {
  const safe = sanitizeForWinAnsi(text)
  if (!safe) return
  const display = maybeTrunc(safe, w, size)
  const approx  = display.length * size * 0.5
  const tx = align === 'center' ? x + (w - approx) / 2 : x + 3
  page.drawText(display, { x: tx, y, size, font, color: BLACK })
}

function drawCheck(page: PDFPage, font: PDFFont, x: number, w: number, y: number) {
  page.drawText('X', {
    x: x + w / 2 - 3, y: y - 2, size: 11, font, color: BLACK,
  })
}

function drawFooter(
  page: PDFPage, font: PDFFont, oblique: PDFFont,
  pageIdx: number, pageCount: number,
) {
  const burden =
    'Public reporting burden for this collection of information is estimated to average 14 minutes per response, including time to ' +
    'review the instruction, search and gather the data needed, and complete and review the collection of information. Persons are not ' +
    'required to respond to the collection of information unless it displays a current valid OMB control number.'
  page.drawText(sanitizeForWinAnsi(burden), {
    x: MARGIN_X, y: 22, size: 5.5, font: oblique, color: GREY,
    maxWidth: PAGE_W - 2 * MARGIN_X - 200, lineHeight: 6.5,
  })
  page.drawText(`Page ${pageIdx + 1} of ${pageCount}  ·  Generated by SoteriaField`, {
    x: PAGE_W - MARGIN_X - 200, y: 14, size: 7, font, color: GREY,
  })
}

function maybeTrunc(s: string, w: number, size: number): string {
  const maxChars = Math.max(1, Math.floor((w - 6) / (size * 0.5)))
  return s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s
}

function formatMonthDay(iso: string): string {
  // Official 300 prints "month/day" (year is in the form header).
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${m[2]}/${m[3]}`
}
