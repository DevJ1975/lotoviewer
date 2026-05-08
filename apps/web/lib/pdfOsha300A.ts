// OSHA Form 300A — Summary of Work-Related Injuries and Illnesses.
//
// Visual replica of the official OSHA Form 300A (Rev. 01/2004),
// reproduced from the public-domain U.S. government form
// (17 USC § 105). Single-page portrait Letter.
//
// Two-column layout matching the official form:
//   LEFT  — Number of Cases (G/H/I/J), Number of Days (K/L),
//           Injury and Illness Types (1-6)
//   RIGHT — Establishment Information, Employment Information,
//           Sign here (cert + name/title/phone/date boxes)
//
// Each section header is a thin gray bar. Each numeric cell shows
// the label at top-left, value centered, column letter at the
// bottom. Field labels in the right-hand panel sit above light-blue
// rule lines. Computed reference rates (TRIR/DART) are appended at
// the bottom under a "Reference rates — not part of OSHA 300A"
// caption so an auditor can't mistake them for required fields.

import { PDFDocument, StandardFonts, type PDFPage, type PDFFont, rgb } from 'pdf-lib'
import { sanitizeForWinAnsi, wrap } from '@/lib/pdfShared'
import {
  type Osha300ASummary,
  trirFromSummary,
  dartFromSummary,
} from '@soteria/core/oshaForms'

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 24

const NAVY      = rgb(0.13, 0.18, 0.34)
const HEADER_BG = rgb(0.85, 0.87, 0.91)        // gray section bar
const RULE_BLUE = rgb(0.74, 0.80, 0.89)
const RULE_GREY = rgb(0.55, 0.58, 0.62)
const BLACK     = rgb(0, 0, 0)
const GREY      = rgb(0.42, 0.45, 0.50)

interface RenderOpts {
  summary:                  Osha300ASummary
  establishment: {
    name:                       string
    street:                     string | null
    city:                       string | null
    state:                      string | null
    zip:                        string | null
    naics_code:                 string | null
    certifying_executive_name:  string | null
    certifying_executive_title: string | null
    is_partial_year:            boolean
  }
  certified_by_name?:       string | null
  certified_at?:            string | null
}

export async function renderOsha300APdf(opts: RenderOpts): Promise<Uint8Array> {
  const pdf  = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const page = pdf.addPage([PAGE_W, PAGE_H])

  let y = PAGE_H - MARGIN

  // ── Title block ───────────────────────────────────────────────────
  page.drawText('OSHA’s Form 300A', {
    x: MARGIN, y: y - 14, size: 14, font: bold, color: NAVY,
  })
  page.drawText('(Rev. 01/2004)', {
    x: MARGIN + 110, y: y - 13, size: 8, font: oblique, color: NAVY,
  })
  page.drawText('Summary of Work-Related', {
    x: MARGIN, y: y - 32, size: 16, font: bold, color: NAVY,
  })
  page.drawText('Injuries and Illnesses', {
    x: MARGIN, y: y - 50, size: 16, font: bold, color: NAVY,
  })

  // Right side — agency block + Year box.
  const rightX = PAGE_W - MARGIN - 220
  page.drawText('Year', {
    x: PAGE_W - MARGIN - 60, y: y - 12, size: 8, font, color: BLACK,
  })
  page.drawRectangle({
    x: PAGE_W - MARGIN - 60, y: y - 30, width: 60, height: 16,
    borderColor: BLACK, borderWidth: 0.6,
  })
  page.drawText(`20${String(opts.summary.year).slice(-2)}`, {
    x: PAGE_W - MARGIN - 50, y: y - 26, size: 11, font: bold, color: BLACK,
  })
  page.drawText('U.S. Department of Labor', {
    x: rightX, y: y - 14, size: 9, font: bold, color: BLACK,
  })
  page.drawText('Occupational Safety and Health Administration', {
    x: rightX, y: y - 24, size: 7.5, font, color: BLACK,
  })
  page.drawText('Form approved OMB no. 1218-0176', {
    x: rightX, y: y - 36, size: 7, font: oblique, color: BLACK,
  })

  y -= 60

  // ── Italic boilerplate paragraph beneath title ────────────────────
  const blurb =
    'All establishments covered by Part 1904 must complete this Summary page, even if no injuries or illnesses ' +
    'occurred during the year. Remember to review the Log to verify that the entries are complete and accurate before ' +
    'completing this summary. Using the Log, count the individual entries you made for each category. Then write the ' +
    'totals below, making sure you’ve added the entries from every page of the Log. If you had no cases, write “0.” ' +
    'Employees, former employees, and their representatives have the right to review the OSHA Form 300 in its ' +
    'entirety. They also have limited access to the OSHA Form 301 or its equivalent. See 29 CFR Part 1904.35, in ' +
    'OSHA’s recordkeeping rule, for further details on the access provisions for these forms.'
  for (const line of wrap(sanitizeForWinAnsi(blurb), oblique, 7, PAGE_W - 2 * MARGIN)) {
    page.drawText(line, { x: MARGIN, y: y - 8, size: 7, font: oblique, color: BLACK })
    y -= 8.5
  }
  y -= 6

  // ── Two-column layout ─────────────────────────────────────────────
  const gutter   = 8
  const colW     = (PAGE_W - 2 * MARGIN - gutter) / 2
  const leftX    = MARGIN
  const rightCx  = MARGIN + colW + gutter
  const colTop   = y

  // ── LEFT column ───────────────────────────────────────────────────
  let ly = colTop

  ly = drawSectionBar(page, bold, 'Number of Cases', leftX, ly, colW)
  ly = drawCountsRow(page, font, bold, leftX, ly, colW, [
    { letter: 'G', label: 'Total number of deaths',                                value: opts.summary.total_deaths },
    { letter: 'H', label: 'Total number of cases with days away from work',        value: opts.summary.total_days_away },
    { letter: 'I', label: 'Total number of cases with job transfer or restriction', value: opts.summary.total_restricted },
    { letter: 'J', label: 'Total number of other recordable cases',                value: opts.summary.total_other_recordable },
  ])

  ly -= 6
  ly = drawSectionBar(page, bold, 'Number of Days', leftX, ly, colW)
  ly = drawCountsRow(page, font, bold, leftX, ly, colW, [
    { letter: 'K', label: 'Total number of days away from work',                   value: opts.summary.total_days_away_count },
    { letter: 'L', label: 'Total number of days of job transfer or restriction',   value: opts.summary.total_days_restricted_count },
  ])

  ly -= 6
  ly = drawSectionBar(page, bold, 'Injury and Illness Types', leftX, ly, colW)
  ly = drawIllnessTypesBlock(page, font, bold, opts.summary, leftX, ly, colW)

  // ── RIGHT column ──────────────────────────────────────────────────
  let ry = colTop
  const e = opts.establishment

  ry = drawSectionBar(page, bold, 'Establishment Information', rightCx, ry, colW)
  ry = drawLabelRule(page, font, bold, rightCx, ry, colW, 'Your establishment name', e.name)
  ry = drawLabelRule(page, font, bold, rightCx, ry, colW, 'Street', e.street ?? '')
  // City | State | Zip on a single row (3 fields).
  ry = drawCityStateZip(page, font, bold, rightCx, ry, colW, e.city ?? '', e.state ?? '', e.zip ?? '')
  ry = drawLabelRule(page, font, bold, rightCx, ry, colW, 'Industry description (e.g., Manufacture of motor truck trailers)', '')
  ry = drawLabelRule(page, font, bold, rightCx, ry, colW, 'Standard Industrial Classification (SIC), if known (e.g., SIC 3715)', '')
  ry = drawLabelRule(page, font, bold, rightCx, ry, colW, 'OR North American Industrial Classification (NAICS), if known (e.g., 336212)', e.naics_code ?? '')

  ry -= 4
  ry = drawSectionBar(page, bold, 'Employment Information', rightCx, ry, colW)
  ry = drawLabelRule(page, font, bold, rightCx, ry, colW,
    'Annual average number of employees', String(opts.summary.annual_avg_employees))
  ry = drawLabelRule(page, font, bold, rightCx, ry, colW,
    'Total hours worked by all employees last year', String(opts.summary.total_hours_worked))

  ry -= 4
  ry = drawSectionBar(page, bold, 'Sign here', rightCx, ry, colW)
  ry = drawSignHere(page, font, bold, oblique, opts, rightCx, ry, colW)

  // ── Reference rates strip (computed; non-OSHA) ────────────────────
  const bottomY = Math.min(ly, ry) - 6
  drawReferenceStrip(page, font, bold, oblique, opts.summary, leftX, bottomY, PAGE_W - 2 * MARGIN)

  // ── Posting reminder + footer ─────────────────────────────────────
  page.drawText(
    'Post this Summary page from February 1 to April 30 of the year following the year covered by the form.',
    { x: MARGIN, y: 38, size: 7, font: bold, color: BLACK },
  )
  page.drawText(
    sanitizeForWinAnsi(
      'Public reporting burden for this collection of information is estimated to average 50 minutes per response, ' +
      'including time to review the instructions, search and gather the data needed, and complete and review the ' +
      'collection of information. Persons are not required to respond to the collection of information unless it ' +
      'displays a current valid OMB control number.',
    ),
    { x: MARGIN, y: 18, size: 5.5, font: oblique, color: GREY,
      maxWidth: PAGE_W - 2 * MARGIN - 100, lineHeight: 6.5 },
  )
  page.drawText('Generated by SoteriaField', {
    x: PAGE_W - MARGIN - 100, y: 12, size: 7, font, color: GREY,
  })

  return await pdf.save()
}

// ──────────────────────────────────────────────────────────────────────────

function drawSectionBar(
  page: PDFPage, bold: PDFFont, title: string,
  x: number, y: number, w: number,
): number {
  const h = 14
  page.drawRectangle({
    x, y: y - h, width: w, height: h,
    color: HEADER_BG, borderColor: BLACK, borderWidth: 0.4,
  })
  page.drawText(sanitizeForWinAnsi(title), {
    x: x + 4, y: y - 10, size: 8.5, font: bold, color: BLACK,
  })
  return y - h
}

interface CountCell { letter: string; label: string; value: number }

function drawCountsRow(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  x: number, top: number, totalW: number, cells: CountCell[],
): number {
  const cellW = totalW / cells.length
  const cellH = 76
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!
    const cx = x + i * cellW
    page.drawRectangle({
      x: cx, y: top - cellH, width: cellW, height: cellH,
      borderColor: BLACK, borderWidth: 0.4,
    })
    // Label — top, wrapped.
    const labelLines = wrap(sanitizeForWinAnsi(c.label), font, 6.5, cellW - 8)
    let ly = top - 10
    for (const line of labelLines.slice(0, 4)) {
      page.drawText(line, { x: cx + 4, y: ly, size: 6.5, font, color: BLACK })
      ly -= 7.5
    }
    // Value — centered horizontally, mid-cell.
    const v = String(c.value)
    const approx = v.length * 14 * 0.55
    page.drawText(v, {
      x: cx + (cellW - approx) / 2, y: top - cellH + 24, size: 14, font: bold, color: BLACK,
    })
    // Rule line under the number.
    page.drawLine({
      start: { x: cx + cellW * 0.25, y: top - cellH + 22 },
      end:   { x: cx + cellW * 0.75, y: top - cellH + 22 },
      thickness: 0.5, color: BLACK,
    })
    // Letter — bottom, centered.
    const letter = `(${c.letter})`
    const lApprox = letter.length * 8 * 0.5
    page.drawText(letter, {
      x: cx + (cellW - lApprox) / 2, y: top - cellH + 6, size: 8, font: bold, color: BLACK,
    })
  }
  return top - cellH
}

function drawIllnessTypesBlock(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  s: Osha300ASummary, x: number, top: number, totalW: number,
): number {
  // The official 300A renders a "Total number of..." caption + (M) letter
  // and arranges six numbered illness-type rows. We use a 2-column
  // 3-row grid to match the screenshot ordering.
  const innerH = 76
  page.drawRectangle({
    x, y: top - innerH, width: totalW, height: innerH,
    borderColor: BLACK, borderWidth: 0.4,
  })
  page.drawText('Total number of...', {
    x: x + 6, y: top - 12, size: 7, font, color: BLACK,
  })
  page.drawText('(M)', {
    x: x + totalW / 2 - 8, y: top - 12, size: 8, font: bold, color: BLACK,
  })
  const types = s.by_injury_type
  const rows: Array<{ num: string; label: string; value: number }> = [
    { num: '(1)', label: 'Injury',                value: types.injury },
    { num: '(2)', label: 'Skin Disorder',         value: types.skin_disorder },
    { num: '(3)', label: 'Respiratory Condition', value: types.respiratory },
    { num: '(4)', label: 'Poisoning',             value: types.poisoning },
    { num: '(5)', label: 'Hearing Loss',          value: types.hearing_loss },
    { num: '(6)', label: 'All Other Illnesses',   value: types.other_illness },
  ]
  // 2 columns × 3 rows.
  const halfW = totalW / 2
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    const colIdx = i < 3 ? 0 : 1
    const rowIdx = i % 3
    const rx = x + 6 + colIdx * halfW
    const ry = top - 24 - rowIdx * 16
    page.drawText(`${r.num}  ${r.label}`, {
      x: rx, y: ry, size: 7, font, color: BLACK,
    })
    // Underline + value at right.
    const ruleStart = rx + 110
    const ruleEnd   = rx + halfW - 14
    page.drawLine({
      start: { x: ruleStart, y: ry - 2 }, end: { x: ruleEnd, y: ry - 2 },
      thickness: 0.5, color: BLACK,
    })
    const v = String(r.value)
    const approx = v.length * 9 * 0.55
    page.drawText(v, {
      x: (ruleStart + ruleEnd) / 2 - approx / 2, y: ry, size: 9, font: bold, color: BLACK,
    })
  }
  return top - innerH
}

function drawLabelRule(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  x: number, top: number, w: number, label: string, value: string,
): number {
  const h = 22
  page.drawText(sanitizeForWinAnsi(label), {
    x: x + 2, y: top - 8, size: 6.5, font, color: BLACK,
  })
  page.drawLine({
    start: { x: x + 2, y: top - h + 2 }, end: { x: x + w - 2, y: top - h + 2 },
    thickness: 0.5, color: RULE_GREY,
  })
  if (value) {
    page.drawText(sanitizeForWinAnsi(value), {
      x: x + 4, y: top - h + 5, size: 9, font: bold, color: BLACK,
    })
  }
  return top - h
}

function drawCityStateZip(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  x: number, top: number, w: number,
  city: string, state: string, zip: string,
): number {
  const h = 22
  const widths = [w * 0.5, w * 0.2, w * 0.3]
  const labels = ['City', 'State', 'Zip']
  const values = [city, state, zip]
  let cx = x
  for (let i = 0; i < 3; i++) {
    const cw = widths[i]!
    page.drawText(labels[i]!, {
      x: cx + 2, y: top - 8, size: 6.5, font, color: BLACK,
    })
    page.drawLine({
      start: { x: cx + 2, y: top - h + 2 }, end: { x: cx + cw - 2, y: top - h + 2 },
      thickness: 0.5, color: RULE_GREY,
    })
    if (values[i]) {
      page.drawText(sanitizeForWinAnsi(values[i]!), {
        x: cx + 4, y: top - h + 5, size: 9, font: bold, color: BLACK,
      })
    }
    cx += cw
  }
  return top - h
}

function drawSignHere(
  page: PDFPage, font: PDFFont, bold: PDFFont, oblique: PDFFont,
  opts: RenderOpts, x: number, top: number, w: number,
): number {
  page.drawText('Knowingly falsifying this document may result in a fine.', {
    x: x + 2, y: top - 10, size: 7, font: oblique, color: BLACK,
  })
  const cert =
    'I certify that I have examined this document and that to the best of my knowledge the entries are true, accurate, and complete.'
  let yy = top - 20
  for (const line of wrap(sanitizeForWinAnsi(cert), font, 7, w - 4)) {
    page.drawText(line, { x: x + 2, y: yy, size: 7, font, color: BLACK })
    yy -= 8
  }
  yy -= 4
  // 2x2 grid: Company executive | Title  /  Phone | Date.
  const halfW = w / 2
  const fields: Array<{ label: string; value: string; col: 0 | 1; row: 0 | 1 }> = [
    { label: 'Company executive', value: opts.establishment.certifying_executive_name ?? opts.certified_by_name ?? '', col: 0, row: 0 },
    { label: 'Title',             value: opts.establishment.certifying_executive_title ?? '', col: 1, row: 0 },
    { label: 'Phone',             value: '', col: 0, row: 1 },
    { label: 'Date',              value: opts.certified_at ? new Date(opts.certified_at).toLocaleDateString() : '',  col: 1, row: 1 },
  ]
  const cellH = 22
  for (const f of fields) {
    const fx = x + f.col * halfW
    const fy = yy - f.row * cellH
    page.drawLine({
      start: { x: fx + 2, y: fy - cellH + 4 }, end: { x: fx + halfW - 4, y: fy - cellH + 4 },
      thickness: 0.5, color: RULE_GREY,
    })
    page.drawText(sanitizeForWinAnsi(f.label), {
      x: fx + 2, y: fy - cellH + 12, size: 6.5, font, color: GREY,
    })
    if (f.value) {
      page.drawText(sanitizeForWinAnsi(f.value), {
        x: fx + 4, y: fy - cellH + 7, size: 9, font: bold, color: BLACK,
      })
    }
  }
  return yy - 2 * cellH
}

function drawReferenceStrip(
  page: PDFPage, font: PDFFont, bold: PDFFont, oblique: PDFFont,
  s: Osha300ASummary, x: number, top: number, w: number,
) {
  page.drawText('Reference rates', {
    x, y: top - 10, size: 8, font: bold, color: BLACK,
  })
  page.drawText(' — computed by SoteriaField; not part of OSHA 300A.', {
    x: x + 80, y: top - 10, size: 7, font: oblique, color: GREY,
  })
  const trir = trirFromSummary(s)
  const dart = dartFromSummary(s)
  const half = w / 2
  const cells = [
    { label: 'TRIR (per 100 FTE)', value: trir == null ? '—' : trir.toFixed(2) },
    { label: 'DART (per 100 FTE)', value: dart == null ? '—' : dart.toFixed(2) },
  ]
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!
    const cx = x + i * half
    page.drawRectangle({
      x: cx, y: top - 30, width: half, height: 16,
      borderColor: BLACK, borderWidth: 0.4,
    })
    page.drawText(c.label, { x: cx + 4, y: top - 25, size: 7.5, font, color: BLACK })
    page.drawText(c.value, { x: cx + half - 50, y: top - 25, size: 10, font: bold, color: BLACK })
  }
}
