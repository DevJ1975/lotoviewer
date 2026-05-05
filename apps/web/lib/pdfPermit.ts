import { PDFDocument, PDFImage, StandardFonts, rgb } from 'pdf-lib'
import { hexToRgb01 } from '@soteria/core/energyCodes'
import { effectiveThresholds, evaluateTest } from '@soteria/core/confinedSpaceThresholds'
import type {
  AtmosphericTest,
  ConfinedSpace,
  ConfinedSpacePermit,
} from '@soteria/core/types'
import {
  AMBER, BLACK, EMERALD, FAINT, MARGIN, MUTED, NAVY, PAGE_H, PAGE_W, RED, RULE, SLATE, WHITE,
  createDrawCtx, drawBullets, drawDivider, drawKeyValue, drawSectionBar, embedQrCode,
  reserveSpace, sanitizeForWinAnsi,
  type DrawCtx,
} from '@/lib/pdfShared'

// Re-export so existing test imports (`import { sanitizeForWinAnsi } from '@/lib/pdfPermit'`)
// keep working — the function itself now lives in pdfShared.
export { sanitizeForWinAnsi }

// Single-page portrait Letter permit print, modeled on the OSHA Permit-
// Required Confined Spaces Quick Card. Layout is single-column, flowing
// top-to-bottom with navy section bars matching the placard PDF's palette
// so a printed permit is immediately recognizable to anyone already
// familiar with the LOTO placards.
//
// Generated client-side (same pattern as lib/pdfPlacard.ts) so users can
// download without round-tripping a PDF service. pdf-lib + StandardFonts
// keep the bundle small (no font embedding).

// ── Top header (yellow band with title + key facts) ─────────────────────────
function drawHeader(
  ctx: DrawCtx,
  space: ConfinedSpace,
  permit: ConfinedSpacePermit,
  qr: PDFImage | null,
  qrCaption: string,
): void {
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
    ctx.page.drawText(sanitizeForWinAnsi(qrCaption), {
      x: PAGE_W - MARGIN - QR_SIZE,
      y: ctx.y - QR_SIZE - 10,
      size: 7, font: ctx.font, color: MUTED,
    })
  }

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
  // Full URL the QR code should encode. When the permit has a sign-on
  // token (migration 024), pass `${origin}/permit-signon/<token>` so a
  // worker scanning the QR lands on the self-service sign-on page; in
  // any other case the live permit detail page is the right target.
  // Optional — falls back to a no-QR layout if omitted, so callers in
  // server contexts without a window object can still generate.
  permitUrl?: string
  // Caption rendered under the QR. Defaults to "Scan for live permit"
  // (supervisor flow); pass "Scan to sign in or out" when permitUrl is
  // a sign-on URL so a worker holding the printed permit knows what
  // tapping the QR will do.
  qrCaption?: string
}

export async function generatePermitPdf({ space, permit, tests, permitUrl, qrCaption }: GeneratePermitArgs): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const qr   = permitUrl ? await embedQrCode(doc, permitUrl, 'pdfPermit') : null
  const page = doc.addPage([PAGE_W, PAGE_H])
  const ctx  = createDrawCtx({
    doc, page, font, bold,
    legend: 'OSHA 29 CFR 1910.146 Permit-Required Confined Space Entry Permit',
  })

  drawHeader(ctx, space, permit, qr, qrCaption ?? 'Scan for live permit')

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
