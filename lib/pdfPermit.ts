import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
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

// pdf-lib's StandardFonts use WinAnsi (CP1252) which doesn't cover Unicode
// subscripts/superscripts or many typography chars. Hazard text from users
// or the AI suggester routinely contains O₂, H₂S, CO₂ (subscripts at U+2082)
// and would crash render with "WinAnsi cannot encode '₂'". Map to ASCII
// before any drawText / widthOfTextAtSize call.
// Exported so the unit tests in __tests__/lib/pdfPermit.test.ts can pin
// the WinAnsi-safe substitution table — a regression here turned out to
// crash the entire PDF generator in production once.
// Chars in WinAnsi's 0x80-0x9F range that the engine CAN render even
// though they're outside Latin-1. Preserved by the catch-all so a pasted
// bullet (•), trademark (™), or currency (€) survives. Smart quotes /
// em-dash / ellipsis are normalized to ASCII earlier in the pipeline.
const WINANSI_HIGH_KEEP = '€‚ƒ„†‡ˆ‰Š‹ŒŽ•˜™š›œžŸ'

export function sanitizeForWinAnsi(s: string): string {
  if (!s) return s
  // Built per call (cheap; the kept chars are a fixed string).
  const stripOther = new RegExp(`[^\\x00-\\xFF\\n\\r\\t${WINANSI_HIGH_KEEP}]`, 'g')
  return s
    .replace(/[₀-₉]/g, c => String.fromCharCode(0x30 + (c.charCodeAt(0) - 0x2080))) // ₀-₉
    .replace(/[⁰⁴-⁹]/g, c => String.fromCharCode(0x30 + (c.charCodeAt(0) - 0x2070))) // ⁰ ⁴-⁹
    .replace(/²/g, '2').replace(/³/g, '3').replace(/¹/g, '1') // ² ³ ¹ (in WinAnsi but normalize anyway)
    .replace(/⁺/g, '+').replace(/⁻/g, '-')                         // ⁺ ⁻
    .replace(/₊/g, '+').replace(/₋/g, '-')                         // ₊ ₋
    .replace(/[‐‑−]/g, '-')                                   // hyphens, minus
    .replace(/ /g, ' ')                                                  // nbsp
    .replace(/[‘’‚‛]/g, "'")                              // smart single quotes
    .replace(/[“”„‟]/g, '"')                              // smart double quotes
    .replace(/…/g, '...')                                                // …
    .replace(/[–—]/g, '-')                                          // – —
    .replace(/[×]/g, 'x')                                                // × (in WinAnsi but normalize)
    .replace(stripOther, '?')                                            // strip anything else (preserve WinAnsi 0x80-0x9F)
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of sanitizeForWinAnsi(text).split(/\r?\n/)) {
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

// QR code embedded next to the title so anyone holding the printed permit
// can scan to the live digital permit. Generated at high error-correction
// (level Q) so a folded or smudged print still scans.
async function embedQrCode(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'Q',
      margin: 1,
      width: 240,
      color: { dark: '#000000', light: '#ffffff' },
    })
    const base64 = dataUrl.split(',')[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return await doc.embedPng(bytes)
  } catch (err) {
    // Don't break PDF generation if QR encoding fails — just skip the
    // QR. The serial + permit ID are also on the page so the document
    // stays traceable manually.
    console.error('[pdfPermit] QR generation failed', err)
    return null
  }
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
  const text = sanitizeForWinAnsi(
    `Page ${ctx.pageNo}  ·  OSHA 29 CFR 1910.146 Permit-Required Confined Space Entry Permit  ·  Generated ${new Date().toLocaleString()}`
  )
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
  ctx.page.drawText(sanitizeForWinAnsi(title.toUpperCase()), {
    x: MARGIN + 8, y: ctx.y - 13, size: 9, font: ctx.bold, color: WHITE,
  })
  ctx.y -= 24
}

function drawKeyValue(ctx: DrawCtx, key: string, value: string, opts?: { wrap?: boolean }): void {
  const labelW = 110
  const valueX = MARGIN + labelW
  const valueMaxW = PAGE_W - MARGIN - valueX
  const lines = opts?.wrap
    ? wrap(value || '—', ctx.font, 9, valueMaxW)
    : [sanitizeForWinAnsi(value || '—')]
  reserveSpace(ctx, 12 * Math.max(1, lines.length) + 4)
  ctx.page.drawText(sanitizeForWinAnsi(key), { x: MARGIN, y: ctx.y - 10, size: 8, font: ctx.bold, color: NAVY })
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
function drawHeader(ctx: DrawCtx, space: ConfinedSpace, permit: ConfinedSpacePermit, qr: PDFImage | null): void {
  // Yellow band
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 56, width: PAGE_W - 2 * MARGIN, height: 56, color: rgb(...hexToRgb01('#FFD900')),
  })
  ctx.page.drawText('CONFINED SPACE ENTRY PERMIT', {
    x: MARGIN + 12, y: ctx.y - 24, size: 16, font: ctx.bold, color: BLACK,
  })
  ctx.page.drawText(sanitizeForWinAnsi('OSHA 29 CFR 1910.146 — Permit-Required Confined Spaces'), {
    x: MARGIN + 12, y: ctx.y - 40, size: 9, font: ctx.font, color: BLACK,
  })
  // Serial — large, bold, mono — directly under the title for at-a-glance
  // identification on a printed permit.
  ctx.page.drawText(sanitizeForWinAnsi(permit.serial), {
    x: MARGIN + 12, y: ctx.y - 53, size: 9, font: ctx.bold, color: BLACK,
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
  ctx.page.drawText(sanitizeForWinAnsi(status), {
    x: PAGE_W - MARGIN - statusW - 11, y: ctx.y - 28, size: 10, font: ctx.bold, color: WHITE,
  })

  ctx.y -= 60

  // QR code — top-right, large enough to scan from a printed permit at
  // arm's length. Sits below the yellow band to avoid the status badge.
  if (qr) {
    const QR_SIZE = 80
    ctx.page.drawImage(qr, {
      x: PAGE_W - MARGIN - QR_SIZE,
      y: ctx.y - QR_SIZE,
      width: QR_SIZE, height: QR_SIZE,
    })
    ctx.page.drawText(sanitizeForWinAnsi('Scan for live permit'), {
      x: PAGE_W - MARGIN - QR_SIZE,
      y: ctx.y - QR_SIZE - 10,
      size: 7, font: ctx.font, color: MUTED,
    })
  }

  // Space + permit ID line — narrowed to leave room for the QR
  const headerRightLimit = qr ? PAGE_W - MARGIN - 90 : PAGE_W - MARGIN
  void headerRightLimit  // currently the key-value helper uses full width;
                         // wrap text already keeps things clipped reasonably.
  drawKeyValue(ctx, 'Space', `${space.space_id}  —  ${space.description}`, { wrap: true })
  drawKeyValue(ctx, 'Department', space.department)
  drawKeyValue(ctx, 'Serial', permit.serial)
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

  // Column layout. Subscripts intentionally avoided — pdf-lib's WinAnsi
  // can't encode '₂' / '₃'; sanitizeForWinAnsi handles dynamic data, but
  // for static labels it's clearer to write ASCII at source.
  const cols: Array<{ x: number; w: number; label: string }> = [
    { x: MARGIN,        w: 78,  label: 'Time' },
    { x: MARGIN + 78,   w: 50,  label: 'Kind' },
    { x: MARGIN + 128,  w: 44,  label: 'O2 %' },
    { x: MARGIN + 172,  w: 44,  label: 'LEL %' },
    { x: MARGIN + 216,  w: 50,  label: 'H2S ppm' },
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
    ctx.page.drawText(sanitizeForWinAnsi(c.label), { x: c.x + 2, y: ctx.y - 11, size: 7, font: ctx.bold, color: NAVY })
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

    ctx.page.drawText(sanitizeForWinAnsi(`${date} ${time}`), { x: cols[0].x + 2, y: ctx.y - 10, size: 7, font: ctx.font, color: SLATE })
    ctx.page.drawText(sanitizeForWinAnsi(t.kind.replace('_', ' ')), { x: cols[1].x + 2, y: ctx.y - 10, size: 7, font: ctx.font, color: SLATE })
    ctx.page.drawText(sanitizeForWinAnsi(t.o2_pct  != null ? String(t.o2_pct)  : '—'), { x: cols[2].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: evals.channels.o2  === 'fail' ? RED : SLATE })
    ctx.page.drawText(sanitizeForWinAnsi(t.lel_pct != null ? String(t.lel_pct) : '—'), { x: cols[3].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: evals.channels.lel === 'fail' ? RED : SLATE })
    ctx.page.drawText(sanitizeForWinAnsi(t.h2s_ppm != null ? String(t.h2s_ppm) : '—'), { x: cols[4].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: evals.channels.h2s === 'fail' ? RED : SLATE })
    ctx.page.drawText(sanitizeForWinAnsi(t.co_ppm  != null ? String(t.co_ppm)  : '—'), { x: cols[5].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: evals.channels.co  === 'fail' ? RED : SLATE })
    ctx.page.drawText(sanitizeForWinAnsi(t.tested_by.slice(0, 8)), { x: cols[6].x + 2, y: ctx.y - 10, size: 7, font: ctx.font, color: MUTED })
    ctx.page.drawText(sanitizeForWinAnsi(status), { x: cols[7].x + 2, y: ctx.y - 10, size: 7, font: ctx.bold, color })

    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y - 13.5 },
      end:   { x: PAGE_W - MARGIN, y: ctx.y - 13.5 },
      color: RULE, thickness: 0.3,
    })
    ctx.y -= 14
  }

  // Threshold legend below the table. Subscripts deliberately written as
  // ASCII (O2/H2S) at source so this stays readable even after sanitize.
  reserveSpace(ctx, 12)
  const legend = sanitizeForWinAnsi(
    `Acceptable: O2 ${thresholds.o2_min}–${thresholds.o2_max}%  ·  LEL <${thresholds.lel_max}%  ·  H2S <${thresholds.h2s_max} ppm  ·  CO <${thresholds.co_max} ppm`
  )
  ctx.page.drawText(legend, { x: MARGIN, y: ctx.y - 9, size: 7, font: ctx.font, color: MUTED })
  ctx.y -= 12
}

// ── Public API ──────────────────────────────────────────────────────────────
export interface GeneratePermitArgs {
  space:  ConfinedSpace
  permit: ConfinedSpacePermit
  tests:  AtmosphericTest[]
  // Full URL the QR code should encode (e.g. `${origin}/confined-spaces/...`).
  // Optional — falls back to a no-QR layout if omitted, so callers in
  // server contexts without a window object can still generate.
  permitUrl?: string
}

export async function generatePermitPdf({ space, permit, tests, permitUrl }: GeneratePermitArgs): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const qr   = permitUrl ? await embedQrCode(doc, permitUrl) : null
  const page = doc.addPage([PAGE_W, PAGE_H])
  const ctx: DrawCtx = { doc, page, font, bold, y: PAGE_H - MARGIN, pageNo: 1 }
  drawPageFooter(ctx)

  drawHeader(ctx, space, permit, qr)

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
