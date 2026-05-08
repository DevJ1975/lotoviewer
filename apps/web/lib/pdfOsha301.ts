// OSHA Form 301 — Injury and Illness Incident Report.
//
// Layout-faithful replica of the official OSHA Form 301, reproduced
// from the public-domain government form. Single-page portrait Letter.
// The form has three labelled blocks — Information about the
// employee, Information about the physician or other health care
// professional, Information about the case — followed by a "Completed
// by" footer block. We mirror the exact field numbering (1–18) used
// on the OSHA template.
//
// Differences from the official form: SoteriaField provenance line
// in the bottom margin (form body is unmodified), pure black on
// white for printability + audit fidelity.

import { PDFDocument, StandardFonts, type PDFPage, type PDFFont, rgb } from 'pdf-lib'
import { sanitizeForWinAnsi, wrap } from '@/lib/pdfShared'
import { type Osha301Form } from '@soteria/core/oshaForms'

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 36

const BLACK = rgb(0, 0, 0)
const GREY  = rgb(0.4, 0.4, 0.4)

interface RenderOpts {
  form:                Osha301Form
  establishmentName?:  string | null
}

export async function renderOsha301Pdf(opts: RenderOpts): Promise<Uint8Array> {
  const pdf  = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const page = pdf.addPage([PAGE_W, PAGE_H])

  const f = opts.form
  let y = PAGE_H - MARGIN

  // ── Header ────────────────────────────────────────────────────────
  page.drawText('OSHA’s Form 301', {
    x: MARGIN, y: y - 14, size: 16, font: bold, color: BLACK,
  })
  page.drawText('Injury and Illness Incident Report', {
    x: MARGIN, y: y - 30, size: 13, font: bold, color: BLACK,
  })
  // Right-aligned agency block.
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
  y -= 36

  // Attention banner — matches the boilerplate on the official 301.
  const attention =
    'This Injury and Illness Incident Report is one of the first forms you must fill out when a recordable work-related ' +
    'injury or illness has occurred. Together with the Log of Work-Related Injuries and Illnesses and the accompanying ' +
    'Summary, these forms help the employer and OSHA develop a picture of the extent and severity of work-related ' +
    'incidents. Within 7 calendar days after you receive information that a recordable work-related injury or illness ' +
    'has occurred, you must fill out this form or an equivalent. Some state workers’ compensation, insurance, or other ' +
    'reports may be acceptable substitutes. To be considered an equivalent form, any substitute must contain all the ' +
    'information asked for on this form.'
  const attLines = wrap(sanitizeForWinAnsi(attention), font, 7.5, PAGE_W - 2 * MARGIN)
  for (const line of attLines) {
    page.drawText(line, { x: MARGIN, y: y - 8, size: 7.5, font, color: BLACK })
    y -= 9
  }
  y -= 6

  // Optional establishment + case # line above the field blocks.
  if (opts.establishmentName) {
    page.drawText(sanitizeForWinAnsi(`Establishment name: ${opts.establishmentName}`), {
      x: MARGIN, y: y - 10, size: 9, font: bold, color: BLACK,
    })
  }
  page.drawText(sanitizeForWinAnsi(`Case number from the Log: ${f.case_number}`), {
    x: PAGE_W - MARGIN - 240, y: y - 10, size: 9, font: bold, color: BLACK,
  })
  y -= 18

  // ── Block: Information about the employee ─────────────────────────
  y = sectionHeader(page, bold, 'Information about the employee', y)
  y = field(page, font, bold, '1.', 'Full name', f.employee_full_name, y)
  y = field(page, font, bold, '2.', 'Street',    f.employee_address,    y)
  // City/State/Zip not in our schema as separate columns; leave a placeholder line.
  y = field(page, font, bold, '3.', 'City, State, ZIP', null, y)
  y = pairedField(page, font, bold,
    '4.', 'Date of birth', formatDate(f.employee_dob),
    '5.', 'Date hired',    formatDate(f.employee_hired_at), y)
  y = checkboxRow(page, font, bold, '6.', 'Sex',
    [
      { label: 'Male',   checked: f.employee_gender === 'male' },
      { label: 'Female', checked: f.employee_gender === 'female' },
      { label: 'Other',  checked: f.employee_gender === 'other' || f.employee_gender === 'nonbinary' },
    ], y)

  // ── Block: Information about the physician or other health care professional ──
  y -= 6
  y = sectionHeader(page, bold, 'Information about the physician or other health care professional', y)
  y = field(page, font, bold, '7.', 'Name of physician or other health care professional', f.treating_physician, y)
  y = field(page, font, bold, '8.', 'If treatment was given away from the worksite, where was it given? — Facility',
    f.treatment_facility, y)
  y = field(page, font, bold, '   ', 'Street, City, State, ZIP', null, y)
  y = checkboxRow(page, font, bold, '9.', 'Was employee treated in an emergency room?',
    [
      { label: 'Yes', checked: f.treated_in_emergency_room === true },
      { label: 'No',  checked: f.treated_in_emergency_room === false },
    ], y)
  y = checkboxRow(page, font, bold, '10.', 'Was employee hospitalized overnight as an in-patient?',
    [
      { label: 'Yes', checked: f.hospitalised_overnight === true },
      { label: 'No',  checked: f.hospitalised_overnight === false },
    ], y)

  // ── Block: Information about the case ─────────────────────────────
  y -= 6
  y = sectionHeader(page, bold, 'Information about the case', y)
  y = pairedField(page, font, bold,
    '11.', 'Case number from the Log', f.case_number,
    '12.', 'Date of injury or illness', formatDate(f.date_of_injury), y)
  y = pairedField(page, font, bold,
    '13.', 'Time employee began work', '',
    '14.', 'Time of event', f.time_of_event, y)
  y = field(page, font, bold, '15.',
    'What was the employee doing just before the incident occurred? Describe the activity, as well as the tools, ' +
    'equipment, or material the employee was using. Be specific.',
    f.what_was_employee_doing, y, 2)
  y = field(page, font, bold, '16.',
    'What happened? Tell us how the injury occurred. Examples: "When ladder slipped on wet floor, worker fell 20 feet"; ' +
    '"Worker was sprayed with chlorine when gasket broke during replacement"; "Worker developed soreness in wrist over time."',
    f.what_happened, y, 4)
  y = field(page, font, bold, '17.',
    'What was the injury or illness? Tell us the part of the body that was affected and how it was affected; be more ' +
    'specific than "hurt", "pain", or "sore". Examples: "strained back"; "chemical burn, hand"; "carpal tunnel syndrome".',
    f.injury_or_illness, y, 2)
  y = field(page, font, bold, '18.',
    'What object or substance directly harmed the employee? Examples: "concrete floor"; "chlorine"; "radial arm saw". ' +
    'If this question does not apply to the incident, leave it blank.',
    f.what_object_substance, y, 2)
  if (f.date_of_death) {
    y = field(page, font, bold, '   ', 'If the employee died, when did death occur? — Date of death',
      formatDate(f.date_of_death), y)
  }

  // ── Completed by ──────────────────────────────────────────────────
  y -= 6
  y = sectionHeader(page, bold, 'Completed by', y)
  y = pairedField(page, font, bold,
    '   ', 'Name', f.prepared_by_name,
    '   ', 'Title', f.prepared_by_title, y)
  y = pairedField(page, font, bold,
    '   ', 'Phone', f.prepared_by_phone,
    '   ', 'Date completed',
    f.prepared_at ? new Date(f.prepared_at).toLocaleString() : null, y)

  // ── Footer ────────────────────────────────────────────────────────
  page.drawText(
    sanitizeForWinAnsi(
      'According to Public Law 91-596 and 29 CFR 1904, OSHA’s recordkeeping rule, you must keep this form on file for ' +
      '5 years following the year to which it pertains.',
    ),
    { x: MARGIN, y: 32, size: 6.5, font: oblique, color: GREY,
      maxWidth: PAGE_W - 2 * MARGIN, lineHeight: 7.5 },
  )
  page.drawText('Generated by SoteriaField', {
    x: PAGE_W - MARGIN - 110, y: 18, size: 7, font, color: GREY,
  })

  return await pdf.save()
}

// ──────────────────────────────────────────────────────────────────────────

function sectionHeader(page: PDFPage, bold: PDFFont, title: string, y: number): number {
  // Plain bordered band — matches the official form's section dividers.
  page.drawRectangle({
    x: MARGIN, y: y - 16, width: PAGE_W - 2 * MARGIN, height: 16,
    borderColor: BLACK, borderWidth: 0.6,
  })
  page.drawText(sanitizeForWinAnsi(title), {
    x: MARGIN + 6, y: y - 12, size: 9, font: bold, color: BLACK,
  })
  return y - 18
}

function field(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  num: string, label: string, value: string | null,
  y: number, multiline: number = 1,
): number {
  // Number + label on one line; value goes underneath in a ruled box.
  page.drawText(sanitizeForWinAnsi(num), {
    x: MARGIN, y: y - 9, size: 8, font: bold, color: BLACK,
  })
  // Label can wrap across multiple lines for long instructions (Q15-Q18).
  const labelLines = wrap(sanitizeForWinAnsi(label), font, 7.5, PAGE_W - 2 * MARGIN - 18)
  let labelY = y - 9
  for (const line of labelLines) {
    page.drawText(line, { x: MARGIN + 16, y: labelY, size: 7.5, font, color: BLACK })
    labelY -= 9
  }
  // Value box below the label.
  const boxTop = labelY - 2
  const boxH   = 14 + (multiline - 1) * 12
  page.drawRectangle({
    x: MARGIN, y: boxTop - boxH, width: PAGE_W - 2 * MARGIN, height: boxH,
    borderColor: BLACK, borderWidth: 0.5,
  })
  if (value) {
    const v = sanitizeForWinAnsi(value)
    if (multiline > 1) {
      const lines = wrap(v, font, 9, PAGE_W - 2 * MARGIN - 6).slice(0, multiline)
      let vy = boxTop - 12
      for (const line of lines) {
        page.drawText(line, { x: MARGIN + 4, y: vy, size: 9, font, color: BLACK })
        vy -= 12
      }
    } else {
      page.drawText(v, { x: MARGIN + 4, y: boxTop - 11, size: 9, font, color: BLACK })
    }
  }
  return boxTop - boxH - 4
}

function pairedField(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  n1: string, l1: string, v1: string | null,
  n2: string, l2: string, v2: string | null, y: number,
): number {
  const half = (PAGE_W - 2 * MARGIN) / 2
  // Left half.
  page.drawText(sanitizeForWinAnsi(n1), { x: MARGIN, y: y - 9, size: 8, font: bold, color: BLACK })
  page.drawText(sanitizeForWinAnsi(l1), { x: MARGIN + 16, y: y - 9, size: 7.5, font, color: BLACK })
  // Right half.
  page.drawText(sanitizeForWinAnsi(n2), { x: MARGIN + half, y: y - 9, size: 8, font: bold, color: BLACK })
  page.drawText(sanitizeForWinAnsi(l2), { x: MARGIN + half + 16, y: y - 9, size: 7.5, font, color: BLACK })
  // Boxes.
  const boxTop = y - 13
  page.drawRectangle({
    x: MARGIN, y: boxTop - 14, width: half - 4, height: 14,
    borderColor: BLACK, borderWidth: 0.5,
  })
  page.drawRectangle({
    x: MARGIN + half, y: boxTop - 14, width: half - 4, height: 14,
    borderColor: BLACK, borderWidth: 0.5,
  })
  if (v1) page.drawText(sanitizeForWinAnsi(v1), { x: MARGIN + 4, y: boxTop - 11, size: 9, font, color: BLACK })
  if (v2) page.drawText(sanitizeForWinAnsi(v2), { x: MARGIN + half + 4, y: boxTop - 11, size: 9, font, color: BLACK })
  return boxTop - 14 - 4
}

function checkboxRow(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  num: string, label: string,
  options: Array<{ label: string; checked: boolean }>, y: number,
): number {
  page.drawText(sanitizeForWinAnsi(num), {
    x: MARGIN, y: y - 9, size: 8, font: bold, color: BLACK,
  })
  page.drawText(sanitizeForWinAnsi(label), {
    x: MARGIN + 16, y: y - 9, size: 7.5, font, color: BLACK,
  })
  // Lay options out on the right, fixed spacing.
  const optX0 = PAGE_W - MARGIN - options.length * 60
  for (let i = 0; i < options.length; i++) {
    const o = options[i]!
    const x = optX0 + i * 60
    page.drawRectangle({
      x, y: y - 13, width: 10, height: 10,
      borderColor: BLACK, borderWidth: 0.5,
    })
    if (o.checked) {
      page.drawText('X', { x: x + 1, y: y - 12, size: 9, font: bold, color: BLACK })
    }
    page.drawText(sanitizeForWinAnsi(o.label), {
      x: x + 14, y: y - 11, size: 8, font, color: BLACK,
    })
  }
  return y - 18
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${m[2]}/${m[3]}/${m[1]}`
}
