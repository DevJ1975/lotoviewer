import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib'
import { layoutEcfaChart, type EcfaLayoutNode, type EcfaShape } from '@soteria/core/ecfaSchemas'
import { sanitizeForWinAnsi } from '@/lib/pdfShared'

// ECFA chart → PDF. Reuses the SAME pure layoutEcfaChart() geometry the
// on-screen SVG uses, so the exported chart matches the picture exactly.
// Draws with pdf-lib primitives (rectangles, ellipses, a diamond path, and
// connector lines), flipping the screen's y-down geometry into pdf-lib's
// y-up page space. Fits the chart to one landscape US-Letter page.

const INK    = rgb(0.12, 0.16, 0.22)
const SEQ    = rgb(0.39, 0.45, 0.55)
const COND_L = rgb(0.49, 0.83, 0.99)
const AMBER  = rgb(0.96, 0.62, 0.04)
const EVENT_BG = rgb(0.97, 0.98, 0.99)
const EVENT_L  = rgb(0.58, 0.64, 0.72)
const COND_BG  = rgb(0.94, 0.97, 1.0)
const LOSS_BG  = rgb(1.0, 0.89, 0.90)
const LOSS_L   = rgb(0.88, 0.11, 0.28)

const PAGE_W = 792
const PAGE_H = 612
const M = 36

function clip(text: string, font: PDFFont, size: number, maxW: number): string {
  const clean = sanitizeForWinAnsi(text.replace(/\s+/g, ' ').trim())
  if (font.widthOfTextAtSize(clean, size) <= maxW) return clean
  let out = clean
  while (out.length > 1 && font.widthOfTextAtSize(out + '…', size) > maxW) out = out.slice(0, -1)
  return out + '…'
}

interface Xform { toX: (x: number) => number; toY: (yTop: number) => number; s: number }

function drawShape(page: PDFPage, sh: EcfaShape, t: Xform, font: PDFFont) {
  const x = t.toX(sh.x)
  const yBottom = t.toY(sh.y + sh.h)   // pdf bottom edge
  const w = sh.w * t.s
  const h = sh.h * t.s
  const borderColor = sh.highlighted ? AMBER : sh.kind === 'condition' ? COND_L : sh.kind === 'incident' ? LOSS_L : EVENT_L
  const borderWidth = sh.highlighted ? 2 : 1
  const dash = sh.dashed ? [3, 2] : undefined
  const bg = sh.kind === 'condition' ? COND_BG : sh.kind === 'incident' ? LOSS_BG : EVENT_BG

  if (sh.kind === 'event') {
    page.drawRectangle({ x, y: yBottom, width: w, height: h, color: bg, borderColor, borderWidth, borderDashArray: dash })
  } else if (sh.kind === 'condition') {
    page.drawEllipse({ x: x + w / 2, y: yBottom + h / 2, xScale: w / 2, yScale: h / 2, color: bg, borderColor, borderWidth, borderDashArray: dash })
  } else {
    // Diamond via svg path anchored at the shape's top-left (svg y-down).
    const anchorY = t.toY(sh.y)
    page.drawSvgPath(`M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`,
      { x, y: anchorY, color: bg, borderColor, borderWidth })
  }

  // Label — up to two centered lines.
  const size = sh.kind === 'incident' ? 7 : 7.5
  const cx = x + w / 2
  const cyPdf = yBottom + h / 2
  const label = clip(sh.label, font, size, w - 8)
  page.drawText(label, { x: cx - font.widthOfTextAtSize(label, size) / 2, y: cyPdf - size / 2, size, font, color: INK })
}

export async function buildEcfaChartPdf(
  nodes: EcfaLayoutNode[],
  meta: { title: string; subtitle?: string },
): Promise<Uint8Array> {
  const geo = layoutEcfaChart(nodes)
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])

  page.drawText(sanitizeForWinAnsi(meta.title), { x: M, y: PAGE_H - M - 2, size: 14, font: bold, color: INK })
  if (meta.subtitle) page.drawText(sanitizeForWinAnsi(meta.subtitle), { x: M, y: PAGE_H - M - 18, size: 9, font, color: SEQ })

  const headerH = meta.subtitle ? 42 : 28
  const legendH = 20
  const areaTop = PAGE_H - M - headerH
  const areaW = PAGE_W - 2 * M
  const areaH = areaTop - M - legendH

  const s = geo.width > 0 && geo.height > 0 ? Math.min(areaW / geo.width, areaH / geo.height, 1) : 1
  const ox = M + Math.max(0, (areaW - geo.width * s) / 2)
  const t: Xform = { s, toX: (x) => ox + x * s, toY: (yTop) => areaTop - yTop * s }

  for (const e of geo.edges) {
    const color = e.kind === 'sequence' ? SEQ : COND_L
    page.drawLine({ start: { x: t.toX(e.fromX), y: t.toY(e.fromY) }, end: { x: t.toX(e.toX), y: t.toY(e.toY) }, thickness: e.kind === 'sequence' ? 1.3 : 1, color })
    if (e.kind === 'sequence') {
      // Simple right-pointing arrowhead at the edge end.
      const ex = t.toX(e.toX), ey = t.toY(e.toY)
      page.drawSvgPath(`M 0 0 L -6 -3 L -6 3 Z`, { x: ex, y: ey, color: SEQ, borderColor: SEQ, borderWidth: 0 })
    }
  }
  for (const sh of geo.shapes) drawShape(page, sh, t, font)

  page.drawText(
    sanitizeForWinAnsi('Legend:  [ ] Event   ( ) Condition   <> Loss   dashed = presumptive   amber = causal factor'),
    { x: M, y: M - 4, size: 7.5, font, color: SEQ },
  )

  return doc.save()
}

// Trigger a browser download of the ECFA chart PDF. Client-only.
export async function downloadEcfaChartPdf(nodes: EcfaLayoutNode[], meta: { title: string; subtitle?: string }) {
  const bytes = await buildEcfaChartPdf(nodes, meta)
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ecfa-chart.pdf'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
