import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'
import type { Equipment, LotoReview } from '@soteria/core/types'

// ------------------------------ types ------------------------------

// Exported so the unit tests in __tests__/lib/report.test.ts can assert
// the aggregator's output shape directly. Internally still the same row.
export interface DeptStats {
  dept:        string
  total:       number
  complete:    number
  partial:     number
  missing:     number
  pct:         number
  signedOff:   boolean
  signedOffBy: string | null
}

export interface ReportInput {
  equipment:      Equipment[]
  decommissioned: ReadonlySet<string>
  reviews:        LotoReview[]
  facility?:      string  // default "Snak King"
}

// ------------------------------ colors & layout ------------------------------

const C = {
  navy:        rgb(0.106, 0.227, 0.420),
  yellow:      rgb(0.961, 0.772, 0.094),
  white:       rgb(1, 1, 1),
  black:       rgb(0, 0, 0),
  green:       rgb(0.063, 0.725, 0.506),
  amber:       rgb(0.961, 0.620, 0.043),
  red:         rgb(0.937, 0.267, 0.267),
  gray:        rgb(0.420, 0.447, 0.502),
  lightGreen:  rgb(0.863, 0.988, 0.906),
  altRow:      rgb(0.973, 0.980, 0.988),
  tableBorder: rgb(0.895, 0.902, 0.910),
}

const PAGE_W  = 612
const PAGE_H  = 792
const MARGIN  = 36

// ------------------------------ stat aggregation ------------------------------

// Exported for unit testing — stable across PDF layout tweaks because
// the aggregation has its own correctness criteria (most-recent-approved
// review wins per dept; unapproved reviews never count).
export function latestApprovedReviewByDept(reviews: LotoReview[]): Map<string, LotoReview> {
  const map = new Map<string, LotoReview>()
  // The reviews list may arrive unsorted; pick the newest approved per dept.
  for (const r of reviews) {
    if (!r.approved) continue
    const existing = map.get(r.department)
    if (!existing || (r.created_at ?? '') > (existing.created_at ?? '')) {
      map.set(r.department, r)
    }
  }
  return map
}

// Exported for unit testing — pure aggregator, no PDF dependency.
export function computeDeptStats(active: Equipment[], reviews: LotoReview[]): DeptStats[] {
  const latest = latestApprovedReviewByDept(reviews)
  const byDept = new Map<string, Equipment[]>()
  for (const eq of active) {
    const list = byDept.get(eq.department) ?? []
    list.push(eq)
    byDept.set(eq.department, list)
  }
  const out: DeptStats[] = []
  for (const [dept, rows] of byDept) {
    const complete = rows.filter(e => e.photo_status === 'complete').length
    const partial  = rows.filter(e => e.photo_status === 'partial').length
    const missing  = rows.filter(e => e.photo_status === 'missing').length
    const pct      = rows.length > 0 ? Math.round((complete / rows.length) * 100) : 0
    const review   = latest.get(dept)
    out.push({
      dept,
      total: rows.length,
      complete,
      partial,
      missing,
      pct,
      signedOff:   !!review,
      signedOffBy: review?.reviewer_name ?? null,
    })
  }
  return out.sort((a, b) => a.dept.localeCompare(b.dept))
}

// ------------------------------ drawing helpers ------------------------------

interface Fonts {
  regular: PDFFont
  bold:    PDFFont
}

function textWidth(text: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(text, size)
}

function clip(text: string, font: PDFFont, size: number, maxW: number): string {
  if (textWidth(text, font, size) <= maxW) return text
  const ellipsis = '…'
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    const candidate = text.slice(0, mid) + ellipsis
    if (textWidth(candidate, font, size) <= maxW) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + ellipsis
}

function statusColor(status: Equipment['photo_status']) {
  return status === 'complete' ? C.green : status === 'partial' ? C.amber : C.red
}

// ------------------------------ page 1: executive summary ------------------------------

function drawExecutiveSummary(
  page: PDFPage,
  fonts: Fonts,
  data: {
    total:          number
    complete:       number
    partial:        number
    missing:        number
    decommissioned: number
    pct:            number
    facility:       string
    generatedAt:    Date
    deptStats:      DeptStats[]
  },
): DeptStats[] {
  const { bold, regular } = fonts

  // ── Header band (yellow, navy text)
  page.drawRectangle({ x: 0, y: PAGE_H - 60, width: PAGE_W, height: 60, color: C.yellow })
  page.drawText('SOTERIA LOTO PRO — PLACARD STATUS REPORT', {
    x: MARGIN, y: PAGE_H - 32, size: 16, font: bold, color: C.navy,
  })
  const subtitle = `${data.facility}  ·  ${data.generatedAt.toLocaleString()}`
  page.drawText(subtitle, {
    x: MARGIN, y: PAGE_H - 50, size: 10, font: regular, color: C.navy,
  })

  // ── Stats row: 5 boxes
  const statY  = PAGE_H - 60 - 30
  const statH  = 70
  const statW  = 100
  const gap    = 10
  const stats = [
    { label: 'TOTAL ACTIVE',    value: data.total,          color: C.navy },
    { label: 'COMPLETE',        value: data.complete,       color: C.green },
    { label: 'PARTIAL',         value: data.partial,        color: C.amber },
    { label: 'MISSING',         value: data.missing,        color: C.red },
    { label: 'DECOMMISSIONED',  value: data.decommissioned, color: C.gray },
  ]
  stats.forEach((s, i) => {
    const x = MARGIN + i * (statW + gap)
    const y = statY - statH
    page.drawRectangle({ x, y, width: statW, height: statH, borderColor: C.tableBorder, borderWidth: 1, color: C.white })
    const vStr = String(s.value)
    const vW   = textWidth(vStr, bold, 24)
    page.drawText(vStr, { x: x + (statW - vW) / 2, y: y + 36, size: 24, font: bold, color: s.color })
    const lW = textWidth(s.label, regular, 8)
    page.drawText(s.label, { x: x + (statW - lW) / 2, y: y + 14, size: 8, font: regular, color: C.gray })
  })

  // ── Progress bar
  const barY    = statY - statH - 40
  const barW    = PAGE_W - 2 * MARGIN
  const barH    = 18
  const fillW   = Math.max(0, Math.min(1, data.pct / 100)) * barW
  const fillCol = data.pct >= 100 ? C.green : C.navy
  page.drawRectangle({ x: MARGIN, y: barY, width: barW, height: barH, color: C.altRow, borderColor: C.tableBorder, borderWidth: 1 })
  if (fillW > 0) page.drawRectangle({ x: MARGIN, y: barY, width: fillW, height: barH, color: fillCol })
  const label = `${data.pct}% complete — ${data.complete} of ${data.total} placards done`
  const lW    = textWidth(label, bold, 9)
  page.drawText(label, { x: MARGIN + (barW - lW) / 2, y: barY + 5, size: 9, font: bold, color: data.pct >= 50 ? C.white : C.navy })

  // ── Department breakdown table
  let y = barY - 30
  page.drawText('Department Breakdown', { x: MARGIN, y, size: 12, font: bold, color: C.navy })
  y -= 14

  const cols = [
    { key: 'dept',      label: 'Department', x: MARGIN,           w: 160, align: 'left'   as const },
    { key: 'total',     label: 'Total',      x: MARGIN + 160,     w: 45,  align: 'right'  as const },
    { key: 'complete',  label: 'Complete',   x: MARGIN + 205,     w: 55,  align: 'right'  as const },
    { key: 'partial',   label: 'Partial',    x: MARGIN + 260,     w: 50,  align: 'right'  as const },
    { key: 'missing',   label: 'Missing',    x: MARGIN + 310,     w: 50,  align: 'right'  as const },
    { key: 'pct',       label: '%',          x: MARGIN + 360,     w: 40,  align: 'right'  as const },
    { key: 'signed',    label: 'Signed Off', x: MARGIN + 400,     w: 140, align: 'left'   as const },
  ]

  const headerH = 18
  page.drawRectangle({ x: MARGIN, y: y - headerH, width: PAGE_W - 2 * MARGIN, height: headerH, color: C.navy })
  for (const c of cols) {
    const lw = textWidth(c.label, bold, 9)
    const tx = c.align === 'right' ? c.x + c.w - lw - 6 : c.x + 6
    page.drawText(c.label, { x: tx, y: y - headerH + 6, size: 9, font: bold, color: C.white })
  }
  y -= headerH

  const rowH = 16
  const renderedDepts: DeptStats[] = []
  const minY = MARGIN + 20  // leave room for footer
  for (const d of data.deptStats) {
    if (y - rowH < minY) break  // overflow — drop remaining depts (rare)
    if (d.pct === 100) {
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: PAGE_W - 2 * MARGIN, height: rowH, color: C.lightGreen })
    }
    const signedText  = d.signedOff ? `✓ ${d.signedOffBy ?? 'Approved'}` : ''
    const signedColor = d.signedOff ? C.green : C.gray

    const cells: Array<{ text: string; font: PDFFont; color: ReturnType<typeof rgb> }> = [
      { text: d.dept,            font: regular, color: C.navy },
      { text: String(d.total),   font: regular, color: C.navy },
      { text: String(d.complete),font: regular, color: C.green },
      { text: String(d.partial), font: regular, color: C.amber },
      { text: String(d.missing), font: regular, color: C.red },
      { text: `${d.pct}%`,       font: bold,    color: d.pct === 100 ? C.green : C.navy },
      { text: signedText,        font: regular, color: signedColor },
    ]
    cells.forEach((cell, i) => {
      const c = cols[i]
      const clipped = clip(cell.text, cell.font, 9, c.w - 12)
      const tw = textWidth(clipped, cell.font, 9)
      const tx = c.align === 'right' ? c.x + c.w - tw - 6 : c.x + 6
      page.drawText(clipped, { x: tx, y: y - rowH + 5, size: 9, font: cell.font, color: cell.color })
    })
    page.drawLine({
      start: { x: MARGIN, y: y - rowH },
      end:   { x: PAGE_W - MARGIN, y: y - rowH },
      thickness: 0.5,
      color: C.tableBorder,
    })
    y -= rowH
    renderedDepts.push(d)
  }

  return data.deptStats.slice(renderedDepts.length)
}

// ------------------------------ pages 2+: equipment list ------------------------------

function drawEquipmentPages(
  pdfDoc: PDFDocument,
  fonts: Fonts,
  active: Equipment[],
): PDFPage[] {
  const { regular, bold } = fonts
  const pages: PDFPage[] = []

  const sorted = [...active].sort((a, b) => a.equipment_id.localeCompare(b.equipment_id))

  const cols = [
    { key: 'equipment_id', label: 'Equipment ID', x: MARGIN,              w: 90,  align: 'left' as const },
    { key: 'description',  label: 'Description',  x: MARGIN + 90,         w: 230, align: 'left' as const },
    { key: 'department',   label: 'Department',   x: MARGIN + 320,        w: 120, align: 'left' as const },
    { key: 'status',       label: 'Status',       x: MARGIN + 440,        w: 60,  align: 'left' as const },
    { key: 'verified',     label: 'Verified',     x: MARGIN + 500,        w: 40,  align: 'center' as const },
  ]

  const headerH = 20
  const rowH    = 16
  const topY    = PAGE_H - MARGIN
  const minY    = MARGIN + 28  // footer space

  let page: PDFPage | null = null
  let y = 0

  const startNewPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H])
    pages.push(page)
    y = topY
    page.drawText('Equipment List', { x: MARGIN, y: y - 14, size: 12, font: bold, color: C.navy })
    y -= 22
    page.drawRectangle({ x: MARGIN, y: y - headerH, width: PAGE_W - 2 * MARGIN, height: headerH, color: C.navy })
    for (const c of cols) {
      const lw = textWidth(c.label, bold, 9)
      const tx = c.align === 'center' ? c.x + (c.w - lw) / 2 : c.x + 6
      page.drawText(c.label, { x: tx, y: y - headerH + 7, size: 9, font: bold, color: C.white })
    }
    y -= headerH
  }

  startNewPage()

  sorted.forEach((eq, idx) => {
    if (!page) return
    if (y - rowH < minY) startNewPage()
    if (!page) return

    if (idx % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: PAGE_W - 2 * MARGIN, height: rowH, color: C.altRow })
    }

    const verifiedText = eq.verified ? '✓' : '—'
    const verifiedCol  = eq.verified ? C.green : C.gray

    const cells: Array<{ text: string; color: ReturnType<typeof rgb>; font?: PDFFont }> = [
      { text: eq.equipment_id,            color: C.navy,                 font: bold },
      { text: eq.description,             color: C.navy },
      { text: eq.department,              color: C.navy },
      { text: eq.photo_status,            color: statusColor(eq.photo_status), font: bold },
      { text: verifiedText,               color: verifiedCol,            font: bold },
    ]

    cells.forEach((cell, i) => {
      const c    = cols[i]
      const fnt  = cell.font ?? regular
      const clipped = clip(cell.text, fnt, 9, c.w - 12)
      const tw   = textWidth(clipped, fnt, 9)
      const tx   = c.align === 'center' ? c.x + (c.w - tw) / 2 : c.x + 6
      if (!page) return
      page.drawText(clipped, { x: tx, y: y - rowH + 5, size: 9, font: fnt, color: cell.color })
    })
    y -= rowH
  })

  return pages
}

// ------------------------------ footers ------------------------------

function drawFooters(pages: PDFPage[], fonts: Fonts, generatedAt: Date) {
  const { regular } = fonts
  const total = pages.length
  const left  = `LOTO Status Report — ${generatedAt.toLocaleString()}`
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: 24 }, end: { x: PAGE_W - MARGIN, y: 24 },
      thickness: 0.5, color: C.tableBorder,
    })
    p.drawText(left, { x: MARGIN, y: 12, size: 8, font: regular, color: C.gray, maxWidth: PAGE_W - 2 * MARGIN - 80 })
    const right = `Page ${i + 1} of ${total}`
    const rw    = textWidth(right, regular, 8)
    p.drawText(right, { x: PAGE_W - MARGIN - rw, y: 12, size: 8, font: regular, color: C.gray })
  })
}

// ------------------------------ public API ------------------------------

export async function generateStatusReport(input: ReportInput): Promise<Uint8Array> {
  const pdf     = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold    = await pdf.embedFont(StandardFonts.HelveticaBold)
  const fonts: Fonts = { regular, bold }

  const { equipment, decommissioned, reviews } = input
  const facility    = input.facility ?? 'Snak King'
  const generatedAt = new Date()

  const active     = equipment.filter(eq => !decommissioned.has(eq.equipment_id))
  const complete   = active.filter(eq => eq.photo_status === 'complete').length
  const partial    = active.filter(eq => eq.photo_status === 'partial').length
  const missing    = active.filter(eq => eq.photo_status === 'missing').length
  const pct        = active.length > 0 ? Math.round((complete / active.length) * 100) : 0
  const deptStats  = computeDeptStats(active, reviews)

  // Page 1 — executive summary
  const page1 = pdf.addPage([PAGE_W, PAGE_H])
  drawExecutiveSummary(page1, fonts, {
    total:          active.length,
    complete,
    partial,
    missing,
    decommissioned: decommissioned.size,
    pct,
    facility,
    generatedAt,
    deptStats,
  })

  // Pages 2+ — equipment list
  const equipmentPages = drawEquipmentPages(pdf, fonts, active)

  // Footer on every page
  drawFooters([page1, ...equipmentPages], fonts, generatedAt)

  return pdf.save()
}

export function downloadStatusReport(bytes: Uint8Array, date = new Date()): void {
  // Slice off the underlying ArrayBuffer — Blob typings are stricter in some envs.
  const buf  = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const blob = new Blob([buf], { type: 'application/pdf' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `LOTO_Status_Report_${date.toISOString().slice(0, 10)}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
