import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import {
  PAGE_W, PAGE_H, MARGIN, NAVY, WHITE, SLATE, MUTED, RULE, EMERALD, AMBER, RED, FAINT,
  createDrawCtx, drawSectionBar, drawKeyValue, drawDivider, drawBullets,
  sanitizeForWinAnsi, drawBrandMark, reserveSpace, type DrawCtx,
} from './pdfShared'
import type { IncidentRiskResult } from '@soteria/core/incidentRiskModel'

// Comprehensive, branded EHS Scorecard PDF. Replaces the previous minimal export
// (LOTO program metrics only). The route assembles the input — recomputing the
// predicted-risk score server-side for authority and accepting the already-
// rendered LOTO + incident metrics from the client — and this generator lays out
// a multi-page report using the shared pdf-lib primitives so it sits visually
// next to the permit/OSHA prints. All charts are native pdf-lib vector (no raster
// capture) so the report is deterministic and crisp at any zoom.

const ORANGE = rgb(0.76, 0.25, 0.05)

// ── Defensive input shapes (LOTO + incident arrive as JSON from the client) ──
interface LotoLike {
  totalPermits?: number
  cancelRate?: number
  avgPermitDurationMinutes?: number
  failingTestRate?: number
  photoCompletionPct?: number
  cancelReasonBreakdown?: { reason?: unknown; count?: unknown }[]
}
interface MonthLike { month?: unknown; count?: unknown }
interface IncidentLike {
  trir?: number | null
  dart?: number | null
  ltir?: number | null
  severityRate?: number | null
  totalRecordable?: number
  totalNearMiss?: number
  totalDeaths?: number
  daysSinceLastRecordable?: number
  nearMissToRecordableRatio?: number | null
  actionClosureOnTimePct?: number | null
  rcaCompletionPct?: number | null
  recordablesByMonth?: MonthLike[]
  nearMissByMonth?: MonthLike[]
}

export interface ScorecardPdfInput {
  tenantName: string
  /** Tenant logo bytes (PNG/JPG) for the header band; SVG/unsupported → skipped. */
  logo?: { bytes: Uint8Array; isPng: boolean } | null
  windowDays: number
  loto?: LotoLike | null
  incident?: IncidentLike | null
  /** Recomputed server-side — the authoritative predicted-risk headline. */
  risk?: IncidentRiskResult | null
}

// ── Small formatters ────────────────────────────────────────────────────────
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function fmtRate(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—'
}
function fmtPct(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}%` : '—'
}
function humanizeMin(min: number): string {
  if (!min) return '0m'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const BAND_FILL: Record<string, ReturnType<typeof rgb>> = {
  low: EMERALD, moderate: AMBER, high: ORANGE, extreme: RED,
}

// ── Header band (page 1): brand mark + tenant logo + title ──────────────────
function drawHeaderBand(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  args: { tenantName: string; windowDays: number },
): void {
  const bandH = 84
  page.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: bandH, color: NAVY })
  drawBrandMark({ page, font, bold, x: MARGIN, y: PAGE_H - bandH + 50, height: 20, tone: 'light' })

  page.drawText(sanitizeForWinAnsi(args.tenantName), { x: MARGIN, y: PAGE_H - 50, size: 16, font: bold, color: WHITE })
  page.drawText(sanitizeForWinAnsi(`EHS Scorecard · last ${args.windowDays} days · generated ${new Date().toLocaleDateString()}`),
    { x: MARGIN, y: PAGE_H - 68, size: 9, font, color: rgb(0.85, 0.88, 0.95) })
}

// ── Native grouped monthly trend (near-miss vs recordable) ──────────────────
function drawMonthlyTrend(ctx: DrawCtx, rows: { label: string; nearMiss: number; recordable: number }[]): void {
  const plotH = 110
  reserveSpace(ctx, plotH + 46)
  const x0 = MARGIN
  const plotW = PAGE_W - 2 * MARGIN
  const yBase = ctx.y - plotH
  const maxV = Math.max(1, ...rows.map(r => Math.max(r.nearMiss, r.recordable)))
  const n = Math.max(1, rows.length)
  const slot = plotW / n
  const barW = Math.max(2, Math.min(9, slot / 3))

  // Baseline + a faint max gridline.
  ctx.page.drawLine({ start: { x: x0, y: yBase }, end: { x: x0 + plotW, y: yBase }, color: RULE, thickness: 0.8 })
  ctx.page.drawLine({ start: { x: x0, y: yBase + plotH }, end: { x: x0 + plotW, y: yBase + plotH }, color: FAINT, thickness: 0.6 })
  ctx.page.drawText(`max ${maxV}`, { x: x0, y: yBase + plotH + 2, size: 6, font: ctx.font, color: MUTED })

  rows.forEach((r, i) => {
    const cx = x0 + i * slot + slot / 2
    const nmH = (r.nearMiss / maxV) * plotH
    const recH = (r.recordable / maxV) * plotH
    ctx.page.drawRectangle({ x: cx - barW - 1, y: yBase, width: barW, height: nmH, color: EMERALD })
    ctx.page.drawRectangle({ x: cx + 1, y: yBase, width: barW, height: recH, color: RED })
    if (n <= 13 || i % 2 === 0) {
      const w = ctx.font.widthOfTextAtSize(r.label, 6)
      ctx.page.drawText(r.label, { x: cx - w / 2, y: yBase - 9, size: 6, font: ctx.font, color: MUTED })
    }
  })
  ctx.y = yBase - 16

  // Legend.
  reserveSpace(ctx, 14)
  let lx = MARGIN
  for (const [color, label] of [[EMERALD, 'Near-miss'], [RED, 'Recordable']] as const) {
    ctx.page.drawRectangle({ x: lx, y: ctx.y - 8, width: 8, height: 8, color })
    ctx.page.drawText(label, { x: lx + 12, y: ctx.y - 8, size: 8, font: ctx.font, color: SLATE })
    lx += 14 + ctx.font.widthOfTextAtSize(label, 8) + 18
  }
  ctx.y -= 16
}

// ── Risk driver table with native contribution bars ─────────────────────────
function drawDriverTable(ctx: DrawCtx, risk: IncidentRiskResult): void {
  const drivers = risk.drivers.filter(d => d.contribution > 0)
  if (drivers.length === 0) {
    drawBullets(ctx, ['No elevated drivers — program indicators are healthy.'])
    return
  }
  const maxC = Math.max(...drivers.map(d => d.contribution), 1)
  const barX = PAGE_W - MARGIN - 120
  const barMaxW = 96
  for (const d of drivers) {
    reserveSpace(ctx, 22)
    const tone = d.pressure >= 66 ? RED : d.pressure >= 33 ? AMBER : EMERALD
    ctx.page.drawText(sanitizeForWinAnsi(`${d.label} (${d.kind})`), { x: MARGIN, y: ctx.y - 9, size: 8.5, font: ctx.bold, color: NAVY })
    ctx.page.drawText(sanitizeForWinAnsi(`${d.value} · target ${d.target}`), { x: MARGIN + 6, y: ctx.y - 19, size: 8, font: ctx.font, color: MUTED })
    // Contribution bar.
    const w = (d.contribution / maxC) * barMaxW
    ctx.page.drawRectangle({ x: barX, y: ctx.y - 14, width: barMaxW, height: 6, color: FAINT })
    ctx.page.drawRectangle({ x: barX, y: ctx.y - 14, width: Math.max(1, w), height: 6, color: tone })
    ctx.page.drawText(`+${d.contribution}`, { x: barX + barMaxW + 6, y: ctx.y - 15, size: 8, font: ctx.bold, color: SLATE })
    ctx.y -= 24
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
export async function buildScorecardPdf(input: ScorecardPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`EHS Scorecard · ${input.tenantName}`)
  doc.setAuthor('SoteriaField')
  doc.setSubject('EHS Scorecard')
  doc.setCreationDate(new Date())

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])

  drawHeaderBand(page, font, bold, { tenantName: input.tenantName, windowDays: input.windowDays })

  // Best-effort tenant logo on the right of the band.
  if (input.logo) {
    try {
      const img = input.logo.isPng ? await doc.embedPng(input.logo.bytes) : await doc.embedJpg(input.logo.bytes)
      const h = 38
      const w = img.width * (h / img.height)
      page.drawImage(img, { x: PAGE_W - MARGIN - w, y: PAGE_H - 84 + (84 - h) / 2, width: w, height: h })
    } catch { /* logo optional — band still carries the brand mark + name */ }
  }

  const ctx = createDrawCtx({ doc, page, font, bold, legend: `${input.tenantName} · EHS Scorecard` })
  ctx.y = PAGE_H - 84 - 18

  const inc = input.incident ?? {}
  const risk = input.risk ?? null

  // ── Executive summary ─────────────────────────────────────────────────────
  drawSectionBar(ctx, 'Executive summary')
  if (risk) {
    reserveSpace(ctx, 16)
    ctx.page.drawText('Predicted risk', { x: MARGIN, y: ctx.y - 10, size: 8, font: ctx.bold, color: NAVY })
    const valueX = MARGIN + 110
    ctx.page.drawText(`${Math.round(risk.score)} / 100`, { x: valueX, y: ctx.y - 10, size: 9, font: ctx.font, color: SLATE })
    // Band chip, colored like the on-screen gauge.
    const chipLabel = risk.band.toUpperCase()
    const chipW = ctx.bold.widthOfTextAtSize(chipLabel, 7) + 10
    const cx = valueX + 52
    ctx.page.drawRectangle({ x: cx, y: ctx.y - 12, width: chipW, height: 11, color: BAND_FILL[risk.band] ?? MUTED })
    ctx.page.drawText(chipLabel, { x: cx + 5, y: ctx.y - 10, size: 7, font: ctx.bold, color: WHITE })
    ctx.y -= 14
  }
  drawKeyValue(ctx, 'TRIR', `${fmtRate(inc.trir)} per 100 FTE`)
  drawKeyValue(ctx, 'DART', `${fmtRate(inc.dart)} per 100 FTE`)
  drawKeyValue(ctx, 'LTIR', `${fmtRate(inc.ltir)} per 100 FTE`)
  drawKeyValue(ctx, 'Severity rate', fmtRate(inc.severityRate))
  drawKeyValue(ctx, 'Days since recordable', (inc.daysSinceLastRecordable ?? -1) < 0 ? 'none on file' : String(inc.daysSinceLastRecordable))

  // ── Predicted risk + drivers ──────────────────────────────────────────────
  if (risk) {
    drawDivider(ctx)
    drawSectionBar(ctx, 'Predicted risk — where to work')
    drawDriverTable(ctx, risk)

    // Leading vs lagging split.
    drawDivider(ctx)
    drawSectionBar(ctx, 'Leading vs lagging indicators')
    const leading = risk.drivers.filter(d => d.kind === 'leading')
    const lagging = risk.drivers.filter(d => d.kind === 'lagging')
    drawKeyValue(ctx, 'Leading (preventive)', leading.map(d => `${d.label}: ${d.value}`).join('  ·  ') || '—', { wrap: true })
    drawKeyValue(ctx, 'Lagging (outcomes)', lagging.map(d => `${d.label}: ${d.value}`).join('  ·  ') || '—', { wrap: true })
  }

  // ── Recordable & near-miss trend ──────────────────────────────────────────
  const monthly = mergeMonthly(inc.recordablesByMonth, inc.nearMissByMonth)
  if (monthly.length > 0) {
    drawDivider(ctx)
    drawSectionBar(ctx, 'Recordable & near-miss trend (monthly)')
    drawMonthlyTrend(ctx, monthly)
  }

  // ── Investigation & reporting quality ─────────────────────────────────────
  drawDivider(ctx)
  drawSectionBar(ctx, 'Reporting & investigation quality')
  drawKeyValue(ctx, 'Near-miss : recordable', inc.nearMissToRecordableRatio == null ? '—' : `${inc.nearMissToRecordableRatio.toFixed(1)} : 1`)
  drawKeyValue(ctx, 'CAPA on time', fmtPct(inc.actionClosureOnTimePct))
  drawKeyValue(ctx, 'RCA completion', fmtPct(inc.rcaCompletionPct))

  // ── LOTO / permit program metrics ─────────────────────────────────────────
  const loto = input.loto ?? {}
  drawDivider(ctx)
  drawSectionBar(ctx, 'Permits & LOTO program')
  drawKeyValue(ctx, 'Permit load', `${num(loto.totalPermits)} permits`)
  drawKeyValue(ctx, 'Cancel pressure', `${num(loto.cancelRate)}% non-routine`)
  drawKeyValue(ctx, 'Permit cycle', `${humanizeMin(num(loto.avgPermitDurationMinutes))} closed average`)
  drawKeyValue(ctx, 'Atmospheric control', `${num(loto.failingTestRate)}% failed tests`)
  drawKeyValue(ctx, 'LOTO photo readiness', `${num(loto.photoCompletionPct)}% complete`)

  const reasons = Array.isArray(loto.cancelReasonBreakdown) ? loto.cancelReasonBreakdown : []
  if (reasons.length > 0) {
    drawDivider(ctx)
    drawSectionBar(ctx, 'Cancellation drivers')
    for (const r of reasons) drawKeyValue(ctx, String(r.reason ?? '—'), String(num(r.count)))
  }

  return await doc.save()
}

// Merge the two monthly series into a sorted, aligned trend for the chart.
function mergeMonthly(rec?: MonthLike[], nm?: MonthLike[]): { label: string; nearMiss: number; recordable: number }[] {
  const map = new Map<string, { recordable: number; nearMiss: number }>()
  for (const b of rec ?? []) {
    const m = String(b.month ?? '')
    if (m) map.set(m, { recordable: num(b.count), nearMiss: map.get(m)?.nearMiss ?? 0 })
  }
  for (const b of nm ?? []) {
    const m = String(b.month ?? '')
    if (!m) continue
    const e = map.get(m) ?? { recordable: 0, nearMiss: 0 }
    e.nearMiss = num(b.count)
    map.set(m, e)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ label: monthShort(month), nearMiss: v.nearMiss, recordable: v.recordable }))
}

function monthShort(ym: string): string {
  const [y, mo] = ym.split('-').map(Number)
  if (!y || !mo) return ym
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-US', { month: 'short' })
}
