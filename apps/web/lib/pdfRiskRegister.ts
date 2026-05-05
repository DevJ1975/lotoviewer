import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { sanitizeForWinAnsi } from './pdfPermit'

// Risk register PDF. Tabular layout: one row per risk, paginated
// landscape Letter so the table can carry seven columns without
// truncation. Styling intentionally matches pdfShared (navy header
// strip, slate body text) so a printed register sits next to a
// confined-space permit and looks like the same document.

const PAGE_W = 792    // 11"  landscape
const PAGE_H = 612    // 8.5"
const MARGIN = 36

const NAVY  = rgb(0.13, 0.27, 0.53)
const SLATE = rgb(0.15, 0.18, 0.23)
const MUTED = rgb(0.45, 0.50, 0.55)
const RULE  = rgb(0.82, 0.85, 0.90)
const WHITE = rgb(1, 1, 1)

// Risk-band swatch colors. Match the on-screen palette in risk.ts.
const BAND_FILL: Record<string, ReturnType<typeof rgb>> = {
  low:      rgb(0.13, 0.55, 0.30),
  moderate: rgb(0.92, 0.70, 0.07),
  high:     rgb(0.92, 0.34, 0.10),
  extreme:  rgb(0.86, 0.15, 0.15),
}

export interface RiskRegisterRow {
  risk_number:     string
  title:           string
  hazard_category: string
  status:          string
  inherent_band:   string | null
  inherent_score:  number | null
  residual_band:   string | null
  residual_score:  number | null
  next_review_date: string | null
}

export interface RiskRegisterMeta {
  tenantName:    string
  tenantNumber:  string
  generatedAt:   string
  generatedBy:   string | null
  totalRisks:    number
}

export async function buildRiskRegisterPdf(
  meta: RiskRegisterMeta,
  rows: RiskRegisterRow[],
): Promise<Uint8Array> {
  const pdf  = await PDFDocument.create()
  pdf.setTitle(`Risk Register · ${meta.tenantName}`)
  pdf.setAuthor('Soteria Field')
  pdf.setSubject('ISO 45001 6.1 Risk Register')
  pdf.setCreationDate(new Date(meta.generatedAt))

  const font     = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = drawHeader(page, fontBold, font, meta)

  // Column layout (x-offsets within content area). Last column is
  // computed as page width minus margin.
  const cols = [
    { key: 'risk_number',     label: 'Risk #',     x: MARGIN,         w: 80 },
    { key: 'title',           label: 'Title',      x: MARGIN + 84,    w: 240 },
    { key: 'hazard_category', label: 'Category',   x: MARGIN + 328,   w: 90 },
    { key: 'status',          label: 'Status',     x: MARGIN + 422,   w: 80 },
    { key: 'inherent',        label: 'Inherent',   x: MARGIN + 506,   w: 70 },
    { key: 'residual',        label: 'Residual',   x: MARGIN + 580,   w: 70 },
    { key: 'next_review',     label: 'Next review', x: MARGIN + 654,  w: 92 },
  ] as const

  drawTableHeader(page, fontBold, cols, y)
  y -= 18

  for (const r of rows) {
    if (y < MARGIN + 24) {
      page = pdf.addPage([PAGE_W, PAGE_H])
      y = drawHeader(page, fontBold, font, meta, /* continued */ true)
      drawTableHeader(page, fontBold, cols, y)
      y -= 18
    }

    drawRow(page, font, fontBold, cols, r, y)
    y -= 16
  }

  drawFooter(page, font, meta)

  return pdf.save()
}

function drawHeader(
  page: PDFPage,
  bold: PDFFont,
  font: PDFFont,
  meta: RiskRegisterMeta,
  continued = false,
): number {
  // Navy bar across the top.
  page.drawRectangle({ x: 0, y: PAGE_H - 56, width: PAGE_W, height: 56, color: NAVY })
  page.drawText(sanitizeForWinAnsi(`Risk Register${continued ? ' (continued)' : ''}`), {
    x: MARGIN, y: PAGE_H - 30, size: 16, font: bold, color: WHITE,
  })
  const sub = `${meta.tenantName} · #${meta.tenantNumber} · ${meta.totalRisks} risk${meta.totalRisks === 1 ? '' : 's'}`
  page.drawText(sanitizeForWinAnsi(sub), { x: MARGIN, y: PAGE_H - 47, size: 9, font, color: WHITE })

  const generated = new Date(meta.generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const right = `Generated ${generated}`
  const w = font.widthOfTextAtSize(right, 9)
  page.drawText(sanitizeForWinAnsi(right), { x: PAGE_W - MARGIN - w, y: PAGE_H - 47, size: 9, font, color: WHITE })

  return PAGE_H - 70
}

function drawTableHeader(
  page: PDFPage,
  bold: PDFFont,
  cols: ReadonlyArray<{ label: string; x: number }>,
  y: number,
) {
  for (const c of cols) {
    page.drawText(sanitizeForWinAnsi(c.label), { x: c.x, y, size: 8, font: bold, color: MUTED })
  }
  page.drawLine({
    start: { x: MARGIN, y: y - 4 },
    end:   { x: PAGE_W - MARGIN, y: y - 4 },
    thickness: 0.5,
    color: RULE,
  })
}

function drawRow(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  cols: ReadonlyArray<{ key: string; x: number; w: number }>,
  r: RiskRegisterRow,
  y: number,
) {
  const draw = (text: string, x: number, w: number, useFont: PDFFont = font, color = SLATE) => {
    const safe = sanitizeForWinAnsi(text)
    const truncated = truncate(safe, w, useFont, 9)
    page.drawText(truncated, { x, y, size: 9, font: useFont, color })
  }

  for (const c of cols) {
    if (c.key === 'risk_number')     draw(r.risk_number, c.x, c.w, bold)
    else if (c.key === 'title')      draw(r.title, c.x, c.w)
    else if (c.key === 'hazard_category') draw(capitalize(r.hazard_category), c.x, c.w)
    else if (c.key === 'status')     draw(r.status.replace('_', ' '), c.x, c.w)
    else if (c.key === 'inherent')   drawBand(page, font, r.inherent_band, r.inherent_score, c.x, y)
    else if (c.key === 'residual')   drawBand(page, font, r.residual_band, r.residual_score, c.x, y)
    else if (c.key === 'next_review') draw(r.next_review_date ?? '—', c.x, c.w)
  }
}

function drawBand(
  page: PDFPage,
  font: PDFFont,
  band: string | null,
  score: number | null,
  x: number,
  y: number,
) {
  if (!band || score == null) {
    page.drawText('—', { x, y, size: 9, font, color: MUTED })
    return
  }
  const fill = BAND_FILL[band] ?? MUTED
  const label = `${band[0].toUpperCase()} (${score})`
  const w = font.widthOfTextAtSize(label, 8) + 8
  page.drawRectangle({ x, y: y - 2, width: w, height: 12, color: fill })
  page.drawText(sanitizeForWinAnsi(label), { x: x + 4, y, size: 8, font, color: WHITE })
}

function drawFooter(page: PDFPage, font: PDFFont, meta: RiskRegisterMeta) {
  const text = sanitizeForWinAnsi(
    `Soteria Field · ISO 45001 6.1 risk register · ${meta.tenantName}` +
    (meta.generatedBy ? ` · exported by ${meta.generatedBy}` : ''),
  )
  page.drawText(text, { x: MARGIN, y: 18, size: 7, font, color: MUTED })
}

function capitalize(s: string): string {
  if (!s) return ''
  return s[0].toUpperCase() + s.slice(1)
}

// Truncate text to fit a column width at a given font size, adding
// "…" when cut. pdf-lib has no built-in measure-and-truncate.
function truncate(text: string, maxWidth: number, font: PDFFont, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  const ellipsis = '…'
  const ellW = font.widthOfTextAtSize(ellipsis, size)
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (font.widthOfTextAtSize(text.slice(0, mid), size) + ellW <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + ellipsis
}
