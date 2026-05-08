// OSHA Form 300 — Log of Work-Related Injuries and Illnesses.
//
// Visual replica of the official OSHA Form 300 (Rev. 01/2004),
// reproduced from the public-domain U.S. government form
// (17 USC § 105). Drawn from scratch — no fillable template
// overlay — so we can paginate dynamically across any number of
// cases (the official template only has ~13 fixed rows).
//
// Visual conventions copied from the official form:
//   - Navy "Step 1.." through "Step 5." band header strip across
//     the column header.
//   - Sub-band "Remained at Work" spanning columns I–J.
//   - Sub-band "Illness" with vertical-rotated column labels
//     for injury/illness types 1–6.
//   - Open circles in classification columns (G/H/I/J) and
//     illness-type columns (1–6); ✕ inside a circle for "checked".
//   - Light-blue ruled lines inside data cells.
//   - "Page totals ▶" row at the bottom of the data area.
//   - Establishment name / City / State fillable strip in the
//     top-right corner. Per-row "Reset" buttons + "Add a Form
//     Page" button on the official fillable PDF are omitted —
//     they are interactive-PDF UI, not form content.

import {
  PDFDocument, StandardFonts, type PDFPage, type PDFFont, rgb, degrees,
} from 'pdf-lib'
import { sanitizeForWinAnsi, wrap } from '@/lib/pdfShared'
import { type Osha300Row } from '@soteria/core/oshaForms'

// Landscape Letter: 11" × 8.5" (792 × 612).
const PAGE_W   = 792
const PAGE_H   = 612
const MARGIN_X = 16
const MARGIN_Y = 18

const NAVY      = rgb(0.13, 0.18, 0.34)
const SUB_NAVY  = rgb(0.20, 0.27, 0.42)
const RULE_BLUE = rgb(0.74, 0.80, 0.89)
const FAINT_BG  = rgb(0.96, 0.97, 0.99)
const BLACK     = rgb(0, 0, 0)
const WHITE     = rgb(1, 1, 1)
const GREY      = rgb(0.42, 0.45, 0.50)

interface RenderOpts {
  rows:                ReadonlyArray<Osha300Row>
  establishmentName:   string
  city:                string | null
  state:               string | null
  year:                number
  companyName?:        string | null
}

interface ColumnDef {
  key:    string
  letter: string
  label:  string
  example?: string                // italic "(e.g., …)" beneath the label
  widthPct: number
  align:  'left' | 'center'
  step:   1 | 2 | 3 | 4 | 5
  subBand?: 'remainedAtWork' | 'illness'
  vertical?: boolean              // header label rotated 90° (illness cols)
}

const COLUMNS: ColumnDef[] = [
  { key: 'A', letter: '(A)', label: 'Case no.',                  widthPct: 4.0,  align: 'center', step: 1 },
  { key: 'B', letter: '(B)', label: "Employee’s name",           widthPct: 11.0, align: 'left',   step: 1 },
  { key: 'C', letter: '(C)', label: 'Job title',                 example: 'e.g., Welder', widthPct: 8.5, align: 'left', step: 1 },
  { key: 'D', letter: '(D)', label: 'Date of injury or onset of illness', example: 'e.g., 2/10', widthPct: 7.0, align: 'center', step: 2 },
  { key: 'E', letter: '(E)', label: 'Where the event occurred',  example: 'e.g., Loading dock north end', widthPct: 11.0, align: 'left', step: 2 },
  { key: 'F', letter: '(F)', label: 'Describe injury or illness, parts of body affected, and object/substance that directly injured or made person ill',
    example: 'e.g., Second degree burns on right forearm from acetylene torch', widthPct: 19.5, align: 'left', step: 2 },
  { key: 'G', letter: '(G)', label: 'Death',                     widthPct: 3.5, align: 'center', step: 3 },
  { key: 'H', letter: '(H)', label: 'Days away from work',       widthPct: 3.5, align: 'center', step: 3 },
  { key: 'I', letter: '(I)', label: 'Job transfer or restriction', widthPct: 3.5, align: 'center', step: 3, subBand: 'remainedAtWork' },
  { key: 'J', letter: '(J)', label: 'Other recordable cases',    widthPct: 3.5, align: 'center', step: 3, subBand: 'remainedAtWork' },
  { key: 'K', letter: '(K)', label: 'Away from work',            widthPct: 4.0, align: 'center', step: 4 },
  { key: 'L', letter: '(L)', label: 'On job transfer or restriction', widthPct: 4.0, align: 'center', step: 4 },
  { key: '1', letter: '(1)', label: 'Injury',                    widthPct: 2.85, align: 'center', step: 5, subBand: 'illness', vertical: true },
  { key: '2', letter: '(2)', label: 'Skin disorder',             widthPct: 2.85, align: 'center', step: 5, subBand: 'illness', vertical: true },
  { key: '3', letter: '(3)', label: 'Respiratory condition',     widthPct: 2.85, align: 'center', step: 5, subBand: 'illness', vertical: true },
  { key: '4', letter: '(4)', label: 'Poisoning',                 widthPct: 2.85, align: 'center', step: 5, subBand: 'illness', vertical: true },
  { key: '5', letter: '(5)', label: 'Hearing loss',              widthPct: 2.85, align: 'center', step: 5, subBand: 'illness', vertical: true },
  { key: '6', letter: '(6)', label: 'All other illnesses',       widthPct: 2.85, align: 'center', step: 5, subBand: 'illness', vertical: true },
]

const TYPE_TO_COL_INDEX: Record<string, number> = {
  injury:        12,
  skin_disorder: 13,
  respiratory:   14,
  poisoning:     15,
  hearing_loss:  16,
  other_illness: 17,
}

const ROW_H = 38                     // tall enough for 2 ruled lines
const STEP_BAND_H = 14
const SUB_BAND_H = 12
const COL_HEAD_H = 60                // taller to fit vertical illness labels
const TOP_BLOCK_H = 130              // title + please-record + reminders + estab strip

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

  const tableTop  = PAGE_H - MARGIN_Y - TOP_BLOCK_H
  const bodyBottom = MARGIN_Y + 50           // leave room for totals row + footer
  const rowSlots  = Math.max(1, Math.floor((tableTop - STEP_BAND_H - SUB_BAND_H - COL_HEAD_H - bodyBottom) / ROW_H))

  const total = opts.rows.length
  const pages: Array<Osha300Row[]> = []
  if (total === 0) pages.push([])
  else for (let i = 0; i < total; i += rowSlots) pages.push(opts.rows.slice(i, i + rowSlots))

  for (let p = 0; p < pages.length; p++) {
    const page = pdf.addPage([PAGE_W, PAGE_H])
    drawTopBlock(page, font, bold, oblique, opts, p, pages.length)
    drawStepBands(page, bold, oblique, colXs, colWs, tableTop)
    const subBandTop = tableTop - STEP_BAND_H
    drawSubBands(page, bold, oblique, colXs, colWs, subBandTop)
    const colHeadTop = subBandTop - SUB_BAND_H
    drawColumnHeaders(page, font, bold, oblique, colXs, colWs, colHeadTop)
    const bodyTop = colHeadTop - COL_HEAD_H
    drawRowGrid(page, oblique, colXs, colWs, bodyTop, rowSlots)
    drawRowsContent(page, font, bold, colXs, colWs, bodyTop, pages[p]!, rowSlots)
    drawPageTotals(page, font, bold, colXs, colWs, bodyTop - rowSlots * ROW_H, pages[p]!)
    drawFooter(page, font, oblique, p, pages.length)
  }

  return await pdf.save()
}

// ──────────────────────────────────────────────────────────────────────────
// Top: title, Please Record, Reminders, Establishment strip
// ──────────────────────────────────────────────────────────────────────────

function drawTopBlock(
  page: PDFPage, font: PDFFont, bold: PDFFont, oblique: PDFFont,
  opts: RenderOpts, pageIdx: number, pageCount: number,
) {
  const top = PAGE_H - MARGIN_Y

  // Title — left side, navy on white.
  page.drawText('OSHA’s Form 300', {
    x: MARGIN_X, y: top - 14, size: 14, font: bold, color: NAVY,
  })
  page.drawText('(Rev. 01/2004)', {
    x: MARGIN_X + 110, y: top - 13, size: 8, font: oblique, color: NAVY,
  })
  page.drawText('Log of Work-Related', {
    x: MARGIN_X, y: top - 32, size: 18, font: bold, color: NAVY,
  })
  page.drawText('Injuries and Illnesses', {
    x: MARGIN_X, y: top - 52, size: 18, font: bold, color: NAVY,
  })

  // Right side: agency block + OMB + establishment strip.
  const rightX = PAGE_W - MARGIN_X - 220
  page.drawText('U.S. Department of Labor', {
    x: rightX, y: top - 14, size: 9, font: bold, color: BLACK,
  })
  page.drawText('Occupational Safety and Health Administration', {
    x: rightX, y: top - 24, size: 7.5, font, color: BLACK,
  })
  page.drawText('Form approved OMB no. 1218-0176', {
    x: rightX, y: top - 36, size: 7, font: oblique, color: BLACK,
  })

  // Establishment / city / state strip (right side, ruled fields).
  const stripY = top - 62
  drawLabelledRule(page, font, bold, 'Establishment name', opts.establishmentName, rightX, stripY, 220, 8)
  drawLabelledRule(page, font, bold, 'City', opts.city ?? '', rightX, stripY - 18, 110, 8)
  drawLabelledRule(page, font, bold, 'State', opts.state ?? '', rightX + 120, stripY - 18, 100, 8)
  drawLabelledRule(page, font, bold, 'Year', `20${String(opts.year).slice(-2)}`, rightX, stripY - 36, 70, 8)
  drawLabelledRule(page, font, bold, `Page ${pageIdx + 1} of ${pageCount}`, '', rightX + 90, stripY - 36, 130, 8)

  // "Please Record" + "Reminders" blocks under the title.
  const blockY = top - 74
  page.drawText('Please Record:', {
    x: MARGIN_X, y: blockY, size: 8, font: bold, color: BLACK,
  })
  const please = [
    'Information about every work-related death and about every work-related injury or illness that involves loss of',
    'consciousness, restricted work activity or job transfer, days away from work, or medical treatment beyond first aid.',
    'Significant work-related injuries and illnesses that are diagnosed by a physician or licensed health care professional.',
    'Work-related injuries and illnesses that meet any of the specific recording criteria listed in 29 CFR Part 1904.8',
    'through 1904.12.',
  ]
  let py = blockY - 8
  for (const line of please) {
    page.drawText(sanitizeForWinAnsi('• ' + line), {
      x: MARGIN_X, y: py, size: 6.5, font, color: BLACK,
    })
    py -= 7.5
  }

  const remX = MARGIN_X + 360
  page.drawText('Reminders:', {
    x: remX, y: blockY, size: 8, font: bold, color: BLACK,
  })
  const rem = [
    'Complete an Injury and Illness Incident Report (OSHA Form 301) or equivalent',
    'form for each injury or illness recorded on this form. If you’re not sure whether a',
    'case is recordable, call your local OSHA office for help.',
    'Feel free to use two lines for a single case if you need to.',
    'Complete the 5 steps for each case.',
  ]
  py = blockY - 8
  for (const line of rem) {
    page.drawText(sanitizeForWinAnsi('• ' + line), {
      x: remX, y: py, size: 6.5, font, color: BLACK,
    })
    py -= 7.5
  }
}

function drawLabelledRule(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  label: string, value: string, x: number, y: number, w: number, fontSize: number,
) {
  // Light-blue underline rule with label above.
  page.drawText(sanitizeForWinAnsi(label), {
    x, y: y + 2, size: 6.5, font, color: BLACK,
  })
  page.drawLine({
    start: { x, y }, end: { x: x + w, y },
    thickness: 0.6, color: RULE_BLUE,
  })
  if (value) {
    page.drawText(sanitizeForWinAnsi(value), {
      x: x + 2, y: y + 4, size: fontSize, font: bold, color: BLACK,
    })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Step bands — Step 1..5 across the column header strip
// ──────────────────────────────────────────────────────────────────────────

function drawStepBands(
  page: PDFPage, bold: PDFFont, oblique: PDFFont,
  colXs: number[], colWs: number[], topY: number,
) {
  // Find col-index range for each step.
  const stepRanges: Record<number, { start: number; end: number }> = {}
  for (let i = 0; i < COLUMNS.length; i++) {
    const s = COLUMNS[i]!.step
    if (!stepRanges[s]) stepRanges[s] = { start: i, end: i }
    stepRanges[s]!.end = i
  }
  const titles: Record<number, string> = {
    1: 'Step 1. Identify the person',
    2: 'Step 2. Describe the case',
    3: 'Step 3. Classify the case',
    4: 'Step 4.',
    5: 'Step 5.',
  }
  const subtitles: Record<number, string | null> = {
    1: null,
    2: null,
    3: 'SELECT ONLY ONE circle based on the most serious outcome:',
    4: 'Enter the number of days the injured or ill worker was:',
    5: 'Select one column:',
  }
  for (const stepKey of Object.keys(stepRanges)) {
    const step  = Number(stepKey)
    const range = stepRanges[step]!
    const x   = colXs[range.start]!
    const xe  = colXs[range.end]! + colWs[range.end]!
    page.drawRectangle({
      x, y: topY - STEP_BAND_H, width: xe - x, height: STEP_BAND_H,
      color: NAVY,
    })
    page.drawText(sanitizeForWinAnsi(titles[step]!), {
      x: x + 4, y: topY - 10, size: 8, font: bold, color: WHITE,
    })
    if (subtitles[step]) {
      // Subtitles render on a second line under the step title — small italic.
      // Some bands are too narrow for the full subtitle (Step 4, 5); we
      // truncate cosmetically.
      const sub = sanitizeForWinAnsi(subtitles[step]!)
      const maxW = xe - x - 8
      const trunc = approxFitTrunc(sub, 6, maxW)
      page.drawText(trunc, {
        x: x + 4, y: topY - STEP_BAND_H - 8, size: 6, font: oblique, color: BLACK,
        maxWidth: maxW,
      })
    }
  }
}

function drawSubBands(
  page: PDFPage, bold: PDFFont, oblique: PDFFont,
  colXs: number[], colWs: number[], topY: number,
) {
  // "Remained at Work" sub-band spanning I + J in Step 3.
  // Find indexes flagged remainedAtWork.
  const rwStart = COLUMNS.findIndex(c => c.subBand === 'remainedAtWork')
  if (rwStart >= 0) {
    let rwEnd = rwStart
    for (let i = rwStart + 1; i < COLUMNS.length; i++) {
      if (COLUMNS[i]!.subBand === 'remainedAtWork') rwEnd = i
      else break
    }
    const x  = colXs[rwStart]!
    const xe = colXs[rwEnd]! + colWs[rwEnd]!
    page.drawRectangle({
      x, y: topY - SUB_BAND_H, width: xe - x, height: SUB_BAND_H,
      color: SUB_NAVY,
    })
    const label = 'Remained at Work'
    const approx = label.length * 7 * 0.5
    page.drawText(label, {
      x: x + (xe - x - approx) / 2, y: topY - 9, size: 7, font: bold, color: WHITE,
    })
  }

  // "Illness" sub-band spanning columns 1-6 in Step 5.
  const illStart = COLUMNS.findIndex(c => c.subBand === 'illness')
  if (illStart >= 0) {
    let illEnd = illStart
    for (let i = illStart + 1; i < COLUMNS.length; i++) {
      if (COLUMNS[i]!.subBand === 'illness') illEnd = i
      else break
    }
    const x  = colXs[illStart]!
    const xe = colXs[illEnd]! + colWs[illEnd]!
    page.drawRectangle({
      x, y: topY - SUB_BAND_H, width: xe - x, height: SUB_BAND_H,
      color: SUB_NAVY,
    })
    const label = 'Illness'
    const approx = label.length * 7 * 0.5
    page.drawText(label, {
      x: x + (xe - x - approx) / 2, y: topY - 9, size: 7, font: bold, color: WHITE,
    })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Column headers
// ──────────────────────────────────────────────────────────────────────────

function drawColumnHeaders(
  page: PDFPage, font: PDFFont, bold: PDFFont, oblique: PDFFont,
  colXs: number[], colWs: number[], topY: number,
) {
  for (let i = 0; i < COLUMNS.length; i++) {
    const c = COLUMNS[i]!
    const x = colXs[i]!, w = colWs[i]!
    page.drawRectangle({
      x, y: topY - COL_HEAD_H, width: w, height: COL_HEAD_H,
      borderColor: BLACK, borderWidth: 0.4, color: WHITE,
    })

    if (c.vertical) {
      // (1) Injury / (2) Skin disorder / etc — vertical, reads bottom-to-top.
      const baseX = x + w / 2 + 3
      const baseY = topY - COL_HEAD_H + 4
      // Letter at the top of the vertical strip; label rotated.
      page.drawText(c.letter, {
        x: x + 1, y: topY - 8, size: 7, font: bold, color: BLACK,
        maxWidth: w - 2,
      })
      page.drawText(sanitizeForWinAnsi(c.label), {
        x: baseX, y: baseY, size: 7, font, color: BLACK,
        rotate: degrees(90),
      })
      continue
    }

    // Horizontal columns (A..L).
    page.drawText(c.letter, {
      x: x + w / 2 - (c.letter.length * 8 * 0.5) / 2, y: topY - 11, size: 8, font: bold, color: BLACK,
    })
    const labelLines = wrap(sanitizeForWinAnsi(c.label), font, 6.5, w - 4)
    let ly = topY - 22
    for (const line of labelLines.slice(0, 4)) {
      page.drawText(line, { x: x + 2, y: ly, size: 6.5, font, color: BLACK })
      ly -= 7.5
    }
    if (c.example) {
      const exLines = wrap(sanitizeForWinAnsi(`(${c.example})`), font, 6, w - 4)
      for (const line of exLines.slice(0, 2)) {
        page.drawText(line, { x: x + 2, y: ly, size: 6, font: oblique, color: GREY })
        ly -= 7
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Row grid + content
// ──────────────────────────────────────────────────────────────────────────

function drawRowGrid(
  page: PDFPage, oblique: PDFFont,
  colXs: number[], colWs: number[], topY: number, rowSlots: number,
) {
  for (let r = 0; r < rowSlots; r++) {
    const y = topY - (r + 1) * ROW_H
    for (let i = 0; i < COLUMNS.length; i++) {
      const x = colXs[i]!, w = colWs[i]!
      page.drawRectangle({
        x, y, width: w, height: ROW_H,
        borderColor: BLACK, borderWidth: 0.3, color: WHITE,
      })
      // Two light-blue ruled lines per cell — text-input columns only.
      const c = COLUMNS[i]!
      if (c.step === 1 || c.step === 2) {
        page.drawLine({
          start: { x: x + 3, y: y + ROW_H - 14 }, end: { x: x + w - 3, y: y + ROW_H - 14 },
          thickness: 0.5, color: RULE_BLUE,
        })
        page.drawLine({
          start: { x: x + 3, y: y + 6 }, end: { x: x + w - 3, y: y + 6 },
          thickness: 0.5, color: RULE_BLUE,
        })
      }
      // Date column: "month / day" placeholder under the rule.
      if (c.key === 'D') {
        page.drawText('month / day', {
          x: x + w / 2 - 22, y: y + 10, size: 5.5, font: oblique, color: GREY,
        })
      }
      // K, L cells: "_days" placeholder rule + suffix.
      if (c.key === 'K' || c.key === 'L') {
        page.drawLine({
          start: { x: x + 4, y: y + 10 }, end: { x: x + w - 16, y: y + 10 },
          thickness: 0.5, color: RULE_BLUE,
        })
        page.drawText('days', {
          x: x + w - 14, y: y + 8, size: 5.5, font: oblique, color: GREY,
        })
      }
    }
  }
}

function drawRowsContent(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  colXs: number[], colWs: number[], topY: number,
  rows: ReadonlyArray<Osha300Row>, rowSlots: number,
) {
  for (let r = 0; r < rows.length && r < rowSlots; r++) {
    const row = rows[r]!
    const yTop = topY - r * ROW_H
    const yMid = yTop - ROW_H / 2 + 1

    const employeeDisplay = row.is_privacy_case ? 'Privacy Case' : (row.employee_name ?? '')
    const jobDisplay      = row.is_privacy_case ? '' : (row.job_title ?? '')
    const locDisplay      = row.is_privacy_case ? '' : (row.location_text ?? '')

    drawCell(page, font, row.case_number,                   colXs[0]!,  colWs[0]!,  yMid, 8, 'center')
    drawCell(page, font, employeeDisplay,                   colXs[1]!,  colWs[1]!,  yMid, 8)
    drawCell(page, font, jobDisplay,                        colXs[2]!,  colWs[2]!,  yMid, 8)
    drawCell(page, font, formatMonthDay(row.date_of_injury), colXs[3]!,  colWs[3]!, yMid, 8, 'center')
    drawCell(page, font, locDisplay,                        colXs[4]!,  colWs[4]!,  yMid, 8)
    drawCell(page, font, row.injury_description ?? '',      colXs[5]!,  colWs[5]!,  yMid, 8)

    // Classification — open circles in all four cells; filled in the chosen one.
    drawClassificationCircle(page, bold, colXs[6]!,  colWs[6]!,  yMid, row.classification === 'death')
    drawClassificationCircle(page, bold, colXs[7]!,  colWs[7]!,  yMid, row.classification === 'days_away')
    drawClassificationCircle(page, bold, colXs[8]!,  colWs[8]!,  yMid, row.classification === 'restricted')
    drawClassificationCircle(page, bold, colXs[9]!,  colWs[9]!,  yMid, row.classification === 'other_recordable')

    drawCell(page, font, row.days_away      ? String(row.days_away)      : '', colXs[10]!, colWs[10]!, yMid, 8, 'center')
    drawCell(page, font, row.days_restricted ? String(row.days_restricted) : '', colXs[11]!, colWs[11]!, yMid, 8, 'center')

    // Illness type circles (1..6). Always render all six as open circles;
    // the chosen one gets a filled mark.
    const typeIdx = TYPE_TO_COL_INDEX[row.injury_type]
    for (let k = 12; k <= 17; k++) {
      drawSmallCircle(page, bold, colXs[k]!, colWs[k]!, yMid, k === typeIdx)
    }
  }

  // Empty rows still need the open circles drawn so the form looks
  // identical full or empty.
  for (let r = rows.length; r < rowSlots; r++) {
    const yTop = topY - r * ROW_H
    const yMid = yTop - ROW_H / 2 + 1
    drawClassificationCircle(page, bold, colXs[6]!, colWs[6]!, yMid, false)
    drawClassificationCircle(page, bold, colXs[7]!, colWs[7]!, yMid, false)
    drawClassificationCircle(page, bold, colXs[8]!, colWs[8]!, yMid, false)
    drawClassificationCircle(page, bold, colXs[9]!, colWs[9]!, yMid, false)
    for (let k = 12; k <= 17; k++) drawSmallCircle(page, bold, colXs[k]!, colWs[k]!, yMid, false)
  }
}

function drawClassificationCircle(
  page: PDFPage, bold: PDFFont, x: number, w: number, y: number, filled: boolean,
) {
  const cx = x + w / 2
  const cy = y + 3
  page.drawCircle({
    x: cx, y: cy, size: 5,
    borderColor: BLACK, borderWidth: 0.5,
    color: filled ? NAVY : WHITE,
  })
  if (filled) {
    page.drawText('X', {
      x: cx - 2.3, y: cy - 2.8, size: 7, font: bold, color: WHITE,
    })
  }
}

function drawSmallCircle(
  page: PDFPage, bold: PDFFont, x: number, w: number, y: number, filled: boolean,
) {
  const cx = x + w / 2
  const cy = y + 3
  page.drawCircle({
    x: cx, y: cy, size: 3.5,
    borderColor: BLACK, borderWidth: 0.5,
    color: filled ? NAVY : WHITE,
  })
}

function drawCell(
  page: PDFPage, font: PDFFont, text: string,
  x: number, w: number, y: number, size: number,
  align: 'left' | 'center' = 'left',
) {
  const safe = sanitizeForWinAnsi(text)
  if (!safe) return
  const display = approxFitTrunc(safe, size, w - 6)
  const approx = display.length * size * 0.5
  const tx = align === 'center' ? x + (w - approx) / 2 : x + 3
  page.drawText(display, { x: tx, y, size, font, color: BLACK })
}

// ──────────────────────────────────────────────────────────────────────────
// Page totals row
// ──────────────────────────────────────────────────────────────────────────

function drawPageTotals(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  colXs: number[], colWs: number[], topY: number, rows: ReadonlyArray<Osha300Row>,
) {
  // Compute totals.
  let g = 0, h = 0, i = 0, j = 0
  let kSum = 0, lSum = 0
  const typeCounts = [0, 0, 0, 0, 0, 0]
  for (const r of rows) {
    if (r.classification === 'death')             g++
    if (r.classification === 'days_away')         h++
    if (r.classification === 'restricted')        i++
    if (r.classification === 'other_recordable')  j++
    kSum += r.days_away      ?? 0
    lSum += r.days_restricted ?? 0
    const idx = TYPE_TO_COL_INDEX[r.injury_type]
    if (idx != null) typeCounts[idx - 12]++
  }
  const TOT_H = 24
  const yTop = topY - 4
  // "Page totals ▶" label spanning A..F.
  const labelW = colXs[6]! - colXs[0]!
  page.drawText('Page totals  >', {
    x: colXs[0]! + labelW - 80, y: yTop - 16, size: 9, font: bold, color: BLACK,
  })

  const cells: Array<[number, number]> = [
    [6,  g], [7,  h], [8,  i], [9,  j],
    [10, kSum], [11, lSum],
    [12, typeCounts[0]!], [13, typeCounts[1]!], [14, typeCounts[2]!],
    [15, typeCounts[3]!], [16, typeCounts[4]!], [17, typeCounts[5]!],
  ]
  for (const [colIdx, val] of cells) {
    const x = colXs[colIdx]!, w = colWs[colIdx]!
    page.drawRectangle({
      x, y: yTop - TOT_H, width: w, height: TOT_H,
      borderColor: BLACK, borderWidth: 0.4, color: FAINT_BG,
    })
    const s = String(val)
    const approx = s.length * 12 * 0.55
    page.drawText(s, {
      x: x + (w - approx) / 2, y: yTop - 16, size: 12, font: bold, color: BLACK,
    })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Footer
// ──────────────────────────────────────────────────────────────────────────

function drawFooter(
  page: PDFPage, font: PDFFont, oblique: PDFFont,
  pageIdx: number, pageCount: number,
) {
  const burden =
    'Public reporting burden for this collection of information is estimated to average 14 minutes per response, including ' +
    'time to review the instructions, search and gather the data needed, and complete and review the collection of information. ' +
    'Persons are not required to respond to the collection of information unless it displays a current valid OMB control number.'
  page.drawText(sanitizeForWinAnsi(burden), {
    x: MARGIN_X, y: 22, size: 5.5, font: oblique, color: GREY,
    maxWidth: PAGE_W - 2 * MARGIN_X - 200, lineHeight: 6.5,
  })
  page.drawText(`Page ${pageIdx + 1} of ${pageCount}  ·  Generated by SoteriaField`, {
    x: PAGE_W - MARGIN_X - 200, y: 14, size: 7, font, color: GREY,
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function approxFitTrunc(s: string, size: number, maxWidth: number): string {
  const maxChars = Math.max(1, Math.floor(maxWidth / (size * 0.5)))
  return s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s
}

function formatMonthDay(iso: string): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${m[2]}/${m[3]}`
}
