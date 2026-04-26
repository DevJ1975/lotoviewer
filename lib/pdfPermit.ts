import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import { hexToRgb01 } from '@/lib/energyCodes'
import { effectiveThresholds, evaluateTest } from '@/lib/confinedSpaceThresholds'
import type {
  AtmosphericTest,
  ConfinedSpace,
  ConfinedSpacePermit,
} from '@/lib/types'

// Single-page portrait Letter permit print, modeled on the OSHA Permit-
// Required Confined Spaces Quick Card. Layout is single-column, flowing
// top-to-bottom with navy section bars matching the placard PDF's palette
// so a printed permit is immediately recognizable to anyone already
// familiar with the LOTO placards.
//
// Generated client-side (same pattern as lib/pdfPlacard.ts) so users can
// download without round-tripping a PDF service. pdf-lib + StandardFonts
// keep the bundle small (no font embedding).

// ── Page geometry ───────────────────────────────────────────────────────────
const PAGE_W = 612    // 8.5" × 72
const PAGE_H = 792    // 11"  × 72
const MARGIN = 36

// ── Palette (matches the placard generator so prints feel cohesive) ────────
const NAVY    = rgb(...hexToRgb01('#214488'))
const SLATE   = rgb(0.15, 0.18, 0.23)
const MUTED   = rgb(0.45, 0.50, 0.55)
const RULE    = rgb(0.82, 0.85, 0.90)
const WHITE   = rgb(1, 1, 1)
const BLACK   = rgb(0, 0, 0)
const RED     = rgb(...hexToRgb01('#BF1414'))
const AMBER   = rgb(...hexToRgb01('#D97706'))
const EMERALD = rgb(...hexToRgb01('#059669'))
const FAINT   = rgb(0.96, 0.97, 0.99)

// ── Text helpers ────────────────────────────────────────────────────────────
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of text.split(/\r?\n/)) {
    if (!para.trim()) { out.push(''); continue }
    const words = para.split(/\s+/)
    let cur = ''
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w
      if (font.widthOfTextAtSize(cand, size) <= maxWidth) cur = cand
      else { if (cur) out.push(cur); cur = w }
    }
    if (cur) out.push(cur)
  }
  return out
}

interface DrawCtx {
  doc:    PDFDocument
  page:   PDFPage
  font:   PDFFont
  bold:   PDFFont
  y:      number
  pageNo: number
}

// Reserve `needed` vertical points; if not enough, start a new page.
function reserveSpace(ctx: DrawCtx, needed: number): void {
  if (ctx.y - needed < MARGIN + 24) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
    ctx.pageNo += 1
    drawPageFooter(ctx)
    ctx.y = PAGE_H - MARGIN
  }
}

function drawPageFooter(ctx: DrawCtx): void {
  const text = `Page ${ctx.pageNo}  ·  OSHA 29 CFR 1910.146 Permit-Required Confined Space Entry Permit  ·  Generated ${new Date().toLocaleString()}`
  const w = ctx.font.widthOfTextAtSize(text, 7)
  ctx.page.drawText(text, {
    x: PAGE_W - MARGIN - w, y: 18, size: 7, font: ctx.font, color: MUTED,
  })
}

// ── Section drawing ────────────────────────────────────────────────────────
function drawSectionBar(ctx: DrawCtx, title: string): void {
  reserveSpace(ctx, 24)
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 18, width: PAGE_W - 2 * MARGIN, height: 18, color: NAVY,
  })
  ctx.page.drawText(title.toUpperCase(), {
    x: MARGIN + 8, y: ctx.y - 13, size: 9, font: ctx.bold, color: WHITE,
  })
  ctx.y -= 24
}

function drawKeyValue(ctx: DrawCtx, key: string, value: string, opts?: { wrap?: boolean }): void {
  const labelW = 110
  const valueX = MARGIN + labelW
  const valueMaxW = PAGE_W - MARGIN - valueX
  const lines = opts?.wrap ? wrap(value || '—', ctx.font, 9, valueMaxW) : [value || '—']
  reserveSpace(ctx, 12 * Math.max(1, lines.length) + 4)
  ctx.page.drawText(key, { x: MARGIN, y: ctx.y - 10, size: 8, font: ctx.bold, color: NAVY })
  for (let i = 0; i < lines.length; i++) {
    ctx.page.drawText(lines[i], {
      x: valueX, y: ctx.y - 10 - i * 11, size: 9, font: ctx.font, color: SLATE,
    })
  }
  ctx.y -= 12 * Math.max(1, lines.length) + 2
}

function drawBullets(ctx: DrawCtx, items: string[]): void {
  if (items.length === 0) {
    drawKeyValue(ctx, '', '— none —')
    return
  }
  const maxW = PAGE_W - 2 * MARGIN - 14
  for (const item of items) {
    const lines = wrap(item, ctx.font, 9, maxW)
    reserveSpace(ctx, 12 * lines.length + 2)
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) {
        ctx.page.drawText('•', { x: MARGIN + 2, y: ctx.y - 10, size: 9, font: ctx.bold, color: NAVY })
      }
      ctx.page.drawText(lines[i], {
        x: MARGIN + 14, y: ctx.y - 10, size: 9, font: ctx.font, color: SLATE,
      })
      ctx.y -= 12
    }
  }
}

function drawDivider(ctx: DrawCtx): void {
  reserveSpace(ctx, 8)
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y - 4 },
    end:   { x: PAGE_W - MARGIN, y: ctx.y - 4 },
    color: RULE, thickness: 0.5,
  })
  ctx.y -= 8
}

// ── Top header (yellow band with title + key facts) ─────────────────────────
function drawHeader(ctx: DrawCtx, space: ConfinedSpace, permit: ConfinedSpacePermit): void {
  // Yellow band
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 56, width: PAGE_W - 2 * MARGIN, height: 56, color: rgb(...hexToRgb01('#FFD900')),
  })
  ctx.page.drawText('CONFINED SPACE ENTRY PERMIT', {
    x: MARGIN + 12, y: ctx.y - 24, size: 16, font: ctx.bold, color: BLACK,
  })
  ctx.page.drawText('OSHA 29 CFR 1910.146 — Permit-Required Confined Spaces', {
    x: MARGIN + 12, y: ctx.y - 40, size: 9, font: ctx.font, color: BLACK,
  })

  // Status badge (right side of band)
  const isCanceled  = !!permit.canceled_at
  const isSigned    = !!permit.entry_supervisor_signature_at
  const isExpired   = !isCanceled && !!permit.expires_at && new Date(permit.expires_at) < new Date()
  const status      = isCanceled ? 'CANCELED' : isExpired ? 'EXPIRED' : isSigned ? 'ACTIVE' : 'PENDING SIGNATURE'
  const statusColor = isCanceled ? SLATE : isExpired ? RED : isSigned ? EMERALD : AMBER
  const statusW     = ctx.bold.widthOfTextAtSize(status, 11)
  ctx.page.drawRectangle({
    x: PAGE_W - MARGIN - statusW - 18, y: ctx.y - 32, width: statusW + 14, height: 16, color: statusColor,
  })
  ctx.page.drawText(status, {
    x: PAGE_W - MARGIN - statusW - 11, y: ctx.y - 28, size: 10, font: ctx.bold, color: WHITE,
  })

  ctx.y -= 60

  // Space + permit ID line
  drawKeyValue(ctx, 'Space', `${space.space_id}  —  ${space.description}`, { wrap: true })
  drawKeyValue(ctx, 'Department', space.department)
  drawKeyValue(ctx, 'Permit ID', permit.id)
  drawKeyValue(ctx, 'Started', new Date(permit.started_at).toLocaleString())
  drawKeyValue(ctx, 'Expires', new Date(permit.expires_at).toLocaleString())
  if (permit.entry_supervisor_signature_at) {
    drawKeyValue(ctx, 'Signed at', new Date(permit.entry_supervisor_signature_at).toLocaleString())
  }
  if (permit.canceled_at) {
    drawKeyValue(ctx, 'Canceled at', new Date(permit.canceled_at).toLocaleString())
    drawKeyValue(ctx, 'Cancel reason', permit.cancel_reason ?? '—')
    if (permit.cancel_notes) drawKeyValue(ctx, 'Cancel notes', permit.cancel_notes, { wrap: true })
  }
  drawDivider(ctx)
}

// ── Atmospheric tests table ─────────────────────────────────────────────────
function drawTestsTable(ctx: DrawCtx, tests: AtmosphericTest[], thresholds: ReturnType<typeof effectiveThresholds>): void {
  if (tests.length === 0) {
    drawKeyValue(ctx, '', '— no readings recorded —')
    return
  }

  // Column layout
  const cols: Array<{ x: number; w: number; label: string }> = [
    { x: MARGIN,        w: 78,  label: 'Time' },
    { x: MARGIN + 78,   w: 50,  label: 'Kind' },
    { x: MARGIN + 128,  w: 44,  label: 'O₂ %' },
    { x: MARGIN + 172,  w: 44,  label: 'LEL %' },
    { x: MARGIN + 216,  w: 50,  label: 'H₂S ppm' },
    { x: MARGIN + 266,  w: 50,  label: 'CO ppm' },
    { x: MARGIN + 316,  w: 70,  label: 'Tester' },
    { x: MARGIN + 386,  w: PAGE_W - MARGIN - (MARGIN + 386), label: 'Status' },
  ]

  // Header row
  reserveSpace(ctx, 16)
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 14, width: PAGE_W - 2 * MARGIN, height: 14, color: FAINT,
  })
  for (const c of cols) {
    ctx.page.drawText(c.label, { x: c.x + 2, y: ctx.y - 11, size: 7, font: ctx.bold, color: NAVY })
  }
  ctx.y -= 16

  // Data rows. Tests come in newest-first; the printed permit reads naturally
  // chronologically, so reverse for the PDF.
  const ordered = [...tests].reverse()
  for (const t of ordered) {
    const evals  = evaluateTest(t, thresholds)
    const status = evals.status === 'pass' ? 'PASS' : evals.status === 'fail' ? 'FAIL' : 'INCOMPLETE'
    const color  = evals.status === 'pass' ? EMERALD : evals.status === 'fail' ? RED : AMBER

    reserveSpace(ctx, 14)
    const time = new Date(t.tested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const date = new Date(t.tested_at).toLocaleDateString([], { month: 'numeric', day: 'numeric' })

    ctx.page.drawText(`${date} ${time}`, { x: cols[0].x + 2, y: ctx.y - 10, size: 7, font: ctx.font, color: SLATE })
    ctx.page.drawText(t.kind.replace('_', ' '), { x: cols[1].x + 2, y: ctx.y - 10, size: 7, font: ctx.font, color: SLATE })
    ctx.page.drawText(t.o2_pct  != null ? String(t.o2_pct)  : '—', { x: cols[2].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: evals.channels.o2  === 'fail' ? RED : SLATE })
    ctx.page.drawText(t.lel_pct != null ? String(t.lel_pct) : '—', { x: cols[3].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: evals.channels.lel === 'fail' ? RED : SLATE })
    ctx.page.drawText(t.h2s_ppm != null ? String(t.h2s_ppm) : '—', { x: cols[4].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: evals.channels.h2s === 'fail' ? RED : SLATE })
    ctx.page.drawText(t.co_ppm  != null ? String(t.co_ppm)  : '—', { x: cols[5].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: evals.channels.co  === 'fail' ? RED : SLATE })
    ctx.page.drawText(t.tested_by.slice(0, 8), { x: cols[6].x + 2, y: ctx.y - 10, size: 7, font: ctx.font, color: MUTED })
    ctx.page.drawText(status, { x: cols[7].x + 2, y: ctx.y - 10, size: 7, font: ctx.bold, color })

    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y - 13.5 },
      end:   { x: PAGE_W - MARGIN, y: ctx.y - 13.5 },
      color: RULE, thickness: 0.3,
    })
    ctx.y -= 14
  }

  // Threshold legend below the table
  reserveSpace(ctx, 12)
  const legend = `Acceptable: O₂ ${thresholds.o2_min}–${thresholds.o2_max}%  ·  LEL <${thresholds.lel_max}%  ·  H₂S <${thresholds.h2s_max} ppm  ·  CO <${thresholds.co_max} ppm`
  ctx.page.drawText(legend, { x: MARGIN, y: ctx.y - 9, size: 7, font: ctx.font, color: MUTED })
  ctx.y -= 12
}

// ── Public API ──────────────────────────────────────────────────────────────
export interface GeneratePermitArgs {
  space:  ConfinedSpace
  permit: ConfinedSpacePermit
  tests:  AtmosphericTest[]
}

export async function generatePermitPdf({ space, permit, tests }: GeneratePermitArgs): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])
  const ctx: DrawCtx = { doc, page, font, bold, y: PAGE_H - MARGIN, pageNo: 1 }
  drawPageFooter(ctx)

  drawHeader(ctx, space, permit)

  // Personnel
  drawSectionBar(ctx, '1. Personnel')
  drawKeyValue(ctx, 'Entry supervisor', `User ${permit.entry_supervisor_id.slice(0, 8)} · signs by clicking in the app`, { wrap: true })
  drawKeyValue(ctx, 'Authorized entrants', permit.entrants.length === 0 ? '—' : permit.entrants.join(', '), { wrap: true })
  drawKeyValue(ctx, 'Attendant(s)',         permit.attendants.length === 0 ? '—' : permit.attendants.join(', '), { wrap: true })
  drawDivider(ctx)

  // Purpose & hazards
  drawSectionBar(ctx, '2. Purpose & Hazards')
  drawKeyValue(ctx, 'Purpose of entry', permit.purpose, { wrap: true })
  drawKeyValue(ctx, 'Hazards present', '')
  drawBullets(ctx, permit.hazards_present)
  drawDivider(ctx)

  // Isolation
  drawSectionBar(ctx, '3. Isolation Measures')
  drawBullets(ctx, permit.isolation_measures)
  drawDivider(ctx)

  // Atmospheric
  drawSectionBar(ctx, '4. Atmospheric Tests')
  const thresholds = effectiveThresholds(permit, space)
  drawTestsTable(ctx, tests, thresholds)
  drawDivider(ctx)

  // Communication & rescue
  drawSectionBar(ctx, '5. Communication & Rescue')
  drawKeyValue(ctx, 'Communication', permit.communication_method ?? '—', { wrap: true })
  const r = permit.rescue_service
  const rescueLine = [
    r.name,
    r.phone ? `phone ${r.phone}` : null,
    r.eta_minutes != null ? `ETA ${r.eta_minutes} min` : null,
  ].filter(Boolean).join(' · ') || '—'
  drawKeyValue(ctx, 'Rescue service', rescueLine, { wrap: true })
  if (r.equipment && r.equipment.length > 0) {
    drawKeyValue(ctx, 'Rescue equipment', '')
    drawBullets(ctx, r.equipment)
  }
  drawDivider(ctx)

  // Equipment
  drawSectionBar(ctx, '6. Equipment in Use')
  drawBullets(ctx, permit.equipment_list)
  drawDivider(ctx)

  // Concurrent permits + notes
  if (permit.concurrent_permits || permit.notes) {
    drawSectionBar(ctx, '7. Other')
    if (permit.concurrent_permits) drawKeyValue(ctx, 'Concurrent permits', permit.concurrent_permits, { wrap: true })
    if (permit.notes)              drawKeyValue(ctx, 'Notes', permit.notes, { wrap: true })
    drawDivider(ctx)
  }

  // Signature block
  drawSectionBar(ctx, '8. Authorization')
  if (permit.entry_supervisor_signature_at) {
    drawKeyValue(ctx, 'Authorized by',  `User ${permit.entry_supervisor_id.slice(0, 8)} (electronic signature)`)
    drawKeyValue(ctx, 'Signed at',      new Date(permit.entry_supervisor_signature_at).toLocaleString())
  } else {
    drawKeyValue(ctx, 'Status', 'NOT YET SIGNED — entry not authorized')
  }
  if (permit.canceled_at) {
    drawKeyValue(ctx, 'Canceled at',    new Date(permit.canceled_at).toLocaleString())
    drawKeyValue(ctx, 'Cancel reason',  permit.cancel_reason ?? '—')
    if (permit.cancel_notes) drawKeyValue(ctx, 'Cancel notes', permit.cancel_notes, { wrap: true })
  }

  return doc.save()
}
