// OSHA Form 300A — Summary of Work-Related Injuries and Illnesses.
//
// Layout-faithful replica of the official OSHA Form 300A, reproduced
// from the public-domain government form. Single-page portrait Letter.
//
// The official 300A has four bordered count blocks at the top:
//   "Number of Cases":   G death | H days_away | I restricted | J other
//   "Number of Days":    K total_days_away    | L total_days_restricted
//   "Injury and Illness Types": 1..6 type counts
// Below those: an "Establishment information" block (name, street,
// city/state/zip, industry description, SIC, NAICS), an "Employment
// information" block (annual avg #, total hours), then the
// "Sign here / Knowingly falsifying..." certification block with
// signed name, title, phone, date.
//
// We mirror that geometry exactly. Computed reference rates
// (TRIR/DART) are appended at the bottom under a clear "Reference
// rates — not part of OSHA 300A" caption so an auditor can't mistake
// them for required fields.

import { PDFDocument, StandardFonts, type PDFPage, type PDFFont, rgb } from 'pdf-lib'
import { sanitizeForWinAnsi, wrap } from '@/lib/pdfShared'
import {
  type Osha300ASummary,
  trirFromSummary,
  dartFromSummary,
} from '@soteria/core/oshaForms'

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 30

const BLACK = rgb(0, 0, 0)
const GREY  = rgb(0.4, 0.4, 0.4)

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

  // ── Header ────────────────────────────────────────────────────────
  page.drawText('OSHA’s Form 300A', {
    x: MARGIN, y: y - 14, size: 16, font: bold, color: BLACK,
  })
  page.drawText('(Rev. 01/2004)', {
    x: MARGIN + 130, y: y - 13, size: 8, font: oblique, color: BLACK,
  })
  page.drawText('Summary of Work-Related Injuries and Illnesses', {
    x: MARGIN, y: y - 30, size: 13, font: bold, color: BLACK,
  })
  // Right side agency block.
  const rightX = PAGE_W - MARGIN - 220
  page.drawText('U.S. Department of Labor', {
    x: rightX, y: y - 12, size: 9, font: bold, color: BLACK,
  })
  page.drawText('Occupational Safety and Health Administration', {
    x: rightX, y: y - 22, size: 8, font, color: BLACK,
  })
  page.drawText('Form approved OMB no. 1218-0176', {
    x: rightX, y: y - 31, size: 7, font: oblique, color: BLACK,
  })
  page.drawText(`Year 20${String(opts.summary.year).slice(-2)}`, {
    x: rightX, y: y - 44, size: 12, font: bold, color: BLACK,
  })
  y -= 50

  // Boilerplate block.
  const blurb =
    'All establishments covered by Part 1904 must complete this Summary page, even if no injuries or illnesses ' +
    'occurred during the year. Remember to review the Log to verify that the entries are complete and accurate ' +
    'before completing this summary. Using the Log, count the individual entries you made for each category. ' +
    'Then write the totals below, making sure you’ve added the entries from every page of the Log. If you had ' +
    'no cases, write "0." Employees, former employees, and their representatives have the right to review the ' +
    'OSHA Form 300 in its entirety. They also have limited access to the OSHA Form 301 or its equivalent. See ' +
    '29 CFR Part 1904.35, in OSHA’s recordkeeping rule, for further details on the access provisions for these forms.'
  for (const line of wrap(sanitizeForWinAnsi(blurb), font, 7.5, PAGE_W - 2 * MARGIN)) {
    page.drawText(line, { x: MARGIN, y: y - 8, size: 7.5, font, color: BLACK })
    y -= 9
  }
  y -= 8

  // ── Number of Cases ───────────────────────────────────────────────
  y = drawCountsBlock(
    page, font, bold,
    'Number of Cases',
    [
      { code: 'G',  caption: 'Total number of deaths',                        value: opts.summary.total_deaths },
      { code: 'H',  caption: 'Total number of cases with days away from work', value: opts.summary.total_days_away },
      { code: 'I',  caption: 'Total number of cases with job transfer or restriction', value: opts.summary.total_restricted },
      { code: 'J',  caption: 'Total number of other recordable cases',         value: opts.summary.total_other_recordable },
    ],
    y,
  )

  // ── Number of Days ────────────────────────────────────────────────
  y -= 6
  y = drawCountsBlock(
    page, font, bold,
    'Number of Days',
    [
      { code: 'K',  caption: 'Total number of days away from work',                    value: opts.summary.total_days_away_count },
      { code: 'L',  caption: 'Total number of days of job transfer or restriction',    value: opts.summary.total_days_restricted_count },
    ],
    y,
  )

  // ── Injury and Illness Types ──────────────────────────────────────
  y -= 6
  y = drawCountsBlock(
    page, font, bold,
    'Injury and Illness Types',
    [
      { code: '1',  caption: 'Injuries',                value: opts.summary.by_injury_type.injury },
      { code: '2',  caption: 'Skin Disorders',          value: opts.summary.by_injury_type.skin_disorder },
      { code: '3',  caption: 'Respiratory Conditions',  value: opts.summary.by_injury_type.respiratory },
      { code: '4',  caption: 'Poisonings',              value: opts.summary.by_injury_type.poisoning },
      { code: '5',  caption: 'Hearing Loss',            value: opts.summary.by_injury_type.hearing_loss },
      { code: '6',  caption: 'All Other Illnesses',     value: opts.summary.by_injury_type.other_illness },
    ],
    y,
  )

  // ── Establishment information ─────────────────────────────────────
  y -= 8
  y = drawEstablishmentBlock(page, font, bold, opts, y)

  // ── Employment information ────────────────────────────────────────
  y -= 6
  y = drawEmploymentBlock(page, font, bold, opts.summary, y)

  // ── Reference rates (computed; clearly labelled non-OSHA) ─────────
  y -= 6
  y = drawReferenceRates(page, font, bold, oblique, opts.summary, y)

  // ── Sign here ─────────────────────────────────────────────────────
  y -= 6
  drawCertification(page, font, bold, oblique, opts, y)

  // ── Footer ────────────────────────────────────────────────────────
  page.drawText(
    sanitizeForWinAnsi(
      'Public reporting burden for this collection of information is estimated to average 50 minutes per response, including ' +
      'time to review the instruction, search and gather the data needed, and complete and review the collection of information.',
    ),
    { x: MARGIN, y: 22, size: 5.5, font: oblique, color: GREY,
      maxWidth: PAGE_W - 2 * MARGIN - 130, lineHeight: 6.5 },
  )
  page.drawText('Generated by SoteriaField · Post by April 30 of the following year', {
    x: PAGE_W - MARGIN - 240, y: 14, size: 7, font, color: GREY,
  })

  return await pdf.save()
}

// ──────────────────────────────────────────────────────────────────────────

interface CountCell { code: string; caption: string; value: number }

function drawCountsBlock(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  title: string, cells: CountCell[], top: number,
): number {
  // Title bar.
  page.drawText(title, {
    x: MARGIN, y: top - 10, size: 9, font: bold, color: BLACK,
  })
  const rowTop = top - 14
  const usable = PAGE_W - 2 * MARGIN
  const cellW = usable / cells.length
  const cellH = 44

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!
    const x = MARGIN + i * cellW
    page.drawRectangle({
      x, y: rowTop - cellH, width: cellW, height: cellH,
      borderColor: BLACK, borderWidth: 0.6,
    })
    // Code (e.g. "G") — bold top-left.
    page.drawText(c.code, {
      x: x + 4, y: rowTop - 11, size: 8, font: bold, color: BLACK,
    })
    // Caption — wrapped under the code.
    const captionLines = wrap(sanitizeForWinAnsi(c.caption), font, 6.5, cellW - 32)
    let cy = rowTop - 11
    for (const line of captionLines.slice(0, 3)) {
      page.drawText(line, { x: x + 14, y: cy, size: 6.5, font, color: BLACK })
      cy -= 7.5
    }
    // Value box on the right of the cell.
    const valBoxX = x + cellW - 30
    const valBoxY = rowTop - cellH + 6
    page.drawRectangle({
      x: valBoxX, y: valBoxY, width: 24, height: 24,
      borderColor: BLACK, borderWidth: 0.6,
    })
    const v = String(c.value)
    const approx = v.length * 14 * 0.55
    page.drawText(v, {
      x: valBoxX + (24 - approx) / 2, y: valBoxY + 7, size: 14, font: bold, color: BLACK,
    })
  }
  return rowTop - cellH
}

function drawEstablishmentBlock(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  opts: RenderOpts, top: number,
): number {
  const e = opts.establishment
  page.drawText('Establishment information', {
    x: MARGIN, y: top - 10, size: 9, font: bold, color: BLACK,
  })
  // Bordered field stack.
  const rowH = 16
  const labels: Array<{ label: string; value: string }> = [
    { label: 'Your establishment name',                    value: e.name },
    { label: 'Street',                                     value: e.street ?? '' },
    { label: 'City',                                       value: e.city ?? '' },
    { label: 'State',                                      value: e.state ?? '' },
    { label: 'ZIP',                                        value: e.zip ?? '' },
    { label: 'Standard Industrial Classification (SIC), if known',     value: '' },
    { label: 'North American Industrial Classification (NAICS), if known', value: e.naics_code ?? '' },
  ]
  let y = top - 14
  for (const it of labels) {
    page.drawRectangle({
      x: MARGIN, y: y - rowH, width: PAGE_W - 2 * MARGIN, height: rowH,
      borderColor: BLACK, borderWidth: 0.5,
    })
    page.drawText(sanitizeForWinAnsi(it.label), {
      x: MARGIN + 4, y: y - 11, size: 7, font, color: BLACK,
    })
    if (it.value) {
      page.drawText(sanitizeForWinAnsi(it.value), {
        x: MARGIN + 250, y: y - 11, size: 9, font: bold, color: BLACK,
      })
    }
    y -= rowH
  }
  return y
}

function drawEmploymentBlock(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  s: Osha300ASummary, top: number,
): number {
  page.drawText('Employment information', {
    x: MARGIN, y: top - 10, size: 9, font: bold, color: BLACK,
  })
  const items: Array<{ label: string; value: string }> = [
    { label: 'Annual average number of employees',           value: String(s.annual_avg_employees) },
    { label: 'Total hours worked by all employees last year', value: String(s.total_hours_worked) },
  ]
  let y = top - 14
  for (const it of items) {
    page.drawRectangle({
      x: MARGIN, y: y - 18, width: PAGE_W - 2 * MARGIN, height: 18,
      borderColor: BLACK, borderWidth: 0.5,
    })
    page.drawText(sanitizeForWinAnsi(it.label), {
      x: MARGIN + 4, y: y - 12, size: 7.5, font, color: BLACK,
    })
    page.drawText(it.value, {
      x: PAGE_W - MARGIN - 80, y: y - 13, size: 11, font: bold, color: BLACK,
    })
    y -= 18
  }
  return y
}

function drawReferenceRates(
  page: PDFPage, font: PDFFont, bold: PDFFont, oblique: PDFFont,
  s: Osha300ASummary, top: number,
): number {
  page.drawText('Reference rates', {
    x: MARGIN, y: top - 10, size: 8, font: bold, color: BLACK,
  })
  page.drawText(' — computed by SoteriaField; not part of OSHA 300A.', {
    x: MARGIN + 80, y: top - 10, size: 7, font: oblique, color: GREY,
  })
  const trir = trirFromSummary(s)
  const dart = dartFromSummary(s)
  const cells = [
    { label: 'TRIR (per 100 FTE)', value: trir == null ? '—' : trir.toFixed(2) },
    { label: 'DART (per 100 FTE)', value: dart == null ? '—' : dart.toFixed(2) },
  ]
  const w = (PAGE_W - 2 * MARGIN) / 2
  let y = top - 14
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!
    const x = MARGIN + i * w
    page.drawRectangle({
      x, y: y - 18, width: w, height: 18, borderColor: BLACK, borderWidth: 0.5,
    })
    page.drawText(c.label, { x: x + 4, y: y - 12, size: 7.5, font, color: BLACK })
    page.drawText(c.value, { x: x + w - 60, y: y - 13, size: 11, font: bold, color: BLACK })
  }
  return y - 18
}

function drawCertification(
  page: PDFPage, font: PDFFont, bold: PDFFont, oblique: PDFFont,
  opts: RenderOpts, top: number,
) {
  page.drawText('Sign here', {
    x: MARGIN, y: top - 10, size: 9, font: bold, color: BLACK,
  })
  page.drawText('Knowingly falsifying this document may result in a fine.', {
    x: MARGIN + 56, y: top - 10, size: 8, font: oblique, color: BLACK,
  })
  const cert =
    'I certify that I have examined this document and that to the best of my knowledge the entries are true, accurate, and complete.'
  for (const line of wrap(sanitizeForWinAnsi(cert), font, 8, PAGE_W - 2 * MARGIN)) {
    page.drawText(line, { x: MARGIN, y: top - 22, size: 8, font, color: BLACK })
  }

  // Four signature/title/phone/date boxes (matches the official form).
  const bxTop = top - 30
  const half = (PAGE_W - 2 * MARGIN) / 2
  const fields: Array<{ x: number; y: number; w: number; h: number; label: string; value: string }> = [
    { x: MARGIN,          y: bxTop - 26, w: half - 4, h: 26, label: 'Company executive name',
      value: opts.establishment.certifying_executive_name ?? opts.certified_by_name ?? '' },
    { x: MARGIN + half,   y: bxTop - 26, w: half - 4, h: 26, label: 'Title',
      value: opts.establishment.certifying_executive_title ?? '' },
    { x: MARGIN,          y: bxTop - 56, w: half - 4, h: 26, label: 'Phone',                 value: '' },
    { x: MARGIN + half,   y: bxTop - 56, w: half - 4, h: 26, label: 'Date',
      value: opts.certified_at ? new Date(opts.certified_at).toLocaleDateString() : '' },
  ]
  for (const f of fields) {
    page.drawRectangle({
      x: f.x, y: f.y, width: f.w, height: f.h, borderColor: BLACK, borderWidth: 0.5,
    })
    page.drawText(sanitizeForWinAnsi(f.label), {
      x: f.x + 4, y: f.y + f.h - 9, size: 7, font, color: BLACK,
    })
    if (f.value) {
      page.drawText(sanitizeForWinAnsi(f.value), {
        x: f.x + 4, y: f.y + 8, size: 10, font: bold, color: BLACK,
      })
    }
  }
}
