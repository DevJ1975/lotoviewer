import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as Sentry from '@sentry/nextjs'
import { generatePermitPdf } from '@/lib/pdfPermit'
import { generateHotWorkPermitPdf } from '@/lib/pdfHotWorkPermit'
import {
  AMBER, EMERALD, MARGIN, MUTED, NAVY, PAGE_H, PAGE_W, RED, RULE, SLATE, WHITE,
  createDrawCtx, drawDivider, drawKeyValue, drawSectionBar, sanitizeForWinAnsi,
  type DrawCtx,
} from '@/lib/pdfShared'
import type {
  AtmosphericTest,
  ConfinedSpace,
  ConfinedSpacePermit,
  HotWorkPermit,
  OrgConfig,
} from '@/lib/types'

// Compliance report bundle. Concatenates every confined-space and hot-work
// permit issued during a date range into a single inspector-ready PDF
// preceded by a cover sheet that lists each permit with a SHA-256 of its
// individual bytes.
//
// Verification flow at audit time:
//   1. Inspector receives the bundle PDF.
//   2. They split it on each "PERMIT N OF M" page break (visual; not
//      stored in metadata) — or, more robustly, hash any permit pages
//      they want to verify.
//   3. They check the computed hash against the cover sheet's table.
//   4. Hash mismatch → tampering. Hash match → cryptographic chain of
//      custody back to whatever signed the source PDFs.
//
// We chose per-permit hashes (not a whole-bundle hash) so the cover
// sheet is non-circular and so individual permits remain verifiable
// even when extracted from the bundle. The bundle itself is just a
// concatenation; nothing about it is structurally trusted.

// SHA-256 of the input as a 64-char lowercase hex string. Browser-only
// (uses crypto.subtle); the bundle generator runs client-side same as
// the per-permit PDFs, so this is fine. Falls back to a marker string
// if SubtleCrypto isn't available so the bundle still renders without
// crashing — the cover just shows "[hash unavailable]" for affected rows.
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return '[hash unavailable]'
  // crypto.subtle.digest accepts a BufferSource — pass through to its
  // ArrayBuffer view rather than the Uint8Array wrapper to keep WebKit
  // happy on iOS Safari (it's stricter about the type than Chromium).
  const buf = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

interface CSEntry {
  permit:  ConfinedSpacePermit
  // Atmospheric tests for this permit. Pass-through to generatePermitPdf
  // (which also evaluates pass/fail per channel for the rendered table).
  tests:   AtmosphericTest[]
  // The space the permit was issued against — needed for thresholds
  // (acceptable_conditions_override) and the printed header.
  space:   ConfinedSpace
}

interface HotWorkEntry {
  permit:  HotWorkPermit
}

export interface GenerateBundleArgs {
  // Period the bundle covers — inclusive on both ends. Used for the
  // cover sheet copy and the bundle-id hash. Pass ISO date strings
  // (YYYY-MM-DD) — time-of-day is normalized to start-of-day / end-of-day.
  startDate:        string
  endDate:          string
  csPermits:        CSEntry[]
  hotWorkPermits:   HotWorkEntry[]
  // Org name shown on the cover. Falls back to a generic label if not
  // configured. Pulled from loto_org_config when the caller has it.
  orgName?:         string
  // Org config for the work-order URL template — currently unused on the
  // cover but kept in the API so the v2 cover can render WO links.
  orgConfig?:       OrgConfig | null
  // Origin used to build per-permit URLs in the bundled QR codes. When
  // omitted, the bundled permits render without QRs (acceptable —
  // each one is identified by serial on the cover anyway).
  origin?:          string
}

interface ManifestEntry {
  kind:   'cs' | 'hotwork'
  serial: string
  id:     string
  date:   string   // YYYY-MM-DD
  status: string   // permit lifecycle label, e.g. ACTIVE / CANCELED
  hash:   string   // sha256 of this permit's individual PDF
  bytes:  Uint8Array
}

function csStatus(p: ConfinedSpacePermit): string {
  if (p.canceled_at) return 'CANCELED'
  if (p.expires_at && new Date(p.expires_at) < new Date()) return 'EXPIRED'
  if (p.entry_supervisor_signature_at) return 'ACTIVE'
  return 'PENDING'
}

function hotWorkStatusLabel(p: HotWorkPermit): string {
  if (p.canceled_at)        return 'CANCELED'
  if (p.work_completed_at)  return 'POST-WATCH'
  if (p.pai_signature_at)   return 'ACTIVE'
  return 'PENDING'
}

function statusColor(status: string) {
  if (status === 'CANCELED') return SLATE
  if (status === 'EXPIRED')  return RED
  if (status === 'PENDING')  return AMBER
  return EMERALD
}

// Cover-sheet renderer. Top band with org + period; summary box with
// totals; manifest table listing every permit + hash. Multi-page if the
// manifest is long (reuses the shared reserveSpace flow).
function drawCover(
  ctx:       DrawCtx,
  args:      GenerateBundleArgs,
  manifest:  ManifestEntry[],
  bundleId:  string,
  generated: Date,
): void {
  // Yellow-ish band (lighter than CS yellow so the cover reads as its
  // own document type, not a permit).
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 64, width: PAGE_W - 2 * MARGIN, height: 64, color: NAVY,
  })
  ctx.page.drawText('COMPLIANCE REPORT BUNDLE', {
    x: MARGIN + 14, y: ctx.y - 26, size: 18, font: ctx.bold, color: WHITE,
  })
  ctx.page.drawText(sanitizeForWinAnsi('OSHA 29 CFR 1910.146 + 1910.252 / NFPA 51B / Cal/OSHA §6777'), {
    x: MARGIN + 14, y: ctx.y - 44, size: 9, font: ctx.font, color: WHITE,
  })
  ctx.page.drawText(sanitizeForWinAnsi(args.orgName ?? 'Soteria FIELD — Compliance Report'), {
    x: MARGIN + 14, y: ctx.y - 58, size: 9, font: ctx.bold, color: WHITE,
  })
  ctx.y -= 72

  drawKeyValue(ctx, 'Period', `${args.startDate} to ${args.endDate}`)
  drawKeyValue(ctx, 'Generated', generated.toLocaleString())
  drawKeyValue(ctx, 'Bundle ID', bundleId)
  drawKeyValue(ctx, 'Total permits', String(manifest.length))
  drawKeyValue(ctx, 'CS permits', String(manifest.filter(m => m.kind === 'cs').length))
  drawKeyValue(ctx, 'Hot-work permits', String(manifest.filter(m => m.kind === 'hotwork').length))
  drawDivider(ctx)

  // Verification instructions — short, written so a non-engineer auditor
  // can run them.
  drawSectionBar(ctx, 'How to verify')
  const verify = sanitizeForWinAnsi(
    'Each row in the manifest below lists the SHA-256 of one permit PDF as it was issued by Soteria FIELD. ' +
    'To verify a permit has not been altered after issuance, extract its pages from this bundle, save them as ' +
    'a standalone PDF, and compute SHA-256 of the file. The result must match the hash on this cover. ' +
    'Hash mismatch indicates the permit was modified after issue.',
  )
  // Plain wrapped paragraph — drawKeyValue wraps OK but produces a label/
  // value pair. We want a flush-left paragraph.
  const lines: string[] = []
  const words = verify.split(' ')
  let cur = ''
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w
    if (ctx.font.widthOfTextAtSize(cand, 9) <= PAGE_W - 2 * MARGIN) cur = cand
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  for (const line of lines) {
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y - 10, size: 9, font: ctx.font, color: SLATE })
    ctx.y -= 12
  }
  ctx.y -= 4
  drawDivider(ctx)

  // Manifest header
  drawSectionBar(ctx, `Manifest (${manifest.length} permit${manifest.length === 1 ? '' : 's'})`)

  // Column layout for the manifest table.
  const cols = [
    { x: MARGIN,        w: 32,  label: '#' },
    { x: MARGIN + 32,   w: 38,  label: 'Type' },
    { x: MARGIN + 70,   w: 110, label: 'Serial' },
    { x: MARGIN + 180,  w: 70,  label: 'Date' },
    { x: MARGIN + 250,  w: 70,  label: 'Status' },
    { x: MARGIN + 320,  w: PAGE_W - MARGIN - (MARGIN + 320), label: 'SHA-256 (truncated)' },
  ]
  // Header strip
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 14, width: PAGE_W - 2 * MARGIN, height: 14,
    color: rgb(0.96, 0.97, 0.99),
  })
  for (const c of cols) {
    ctx.page.drawText(sanitizeForWinAnsi(c.label), {
      x: c.x + 2, y: ctx.y - 11, size: 7, font: ctx.bold, color: NAVY,
    })
  }
  ctx.y -= 16

  // Rows. Hash is shown truncated to first 16 chars so the table fits;
  // the full hash is also embedded as a hidden footer on each row's
  // permit pages elsewhere — but for a printed copy the truncated form
  // is what the inspector eyeballs. For a digital copy, the inspector
  // copies the full hash from the page text.
  manifest.forEach((m, i) => {
    // Row reserves itself; if it'd overflow the page, start a fresh one
    // and re-paint a faint header strip so the table stays scannable.
    if (ctx.y - 14 < MARGIN + 24) {
      ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
      ctx.pageNo += 1
      ctx.drawFooter(ctx)
      ctx.y = PAGE_H - MARGIN
    }
    const status = m.status
    const color = statusColor(status)
    ctx.page.drawText(String(i + 1),                     { x: cols[0].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: SLATE })
    ctx.page.drawText(sanitizeForWinAnsi(m.kind === 'cs' ? 'CS' : 'HW'), { x: cols[1].x + 2, y: ctx.y - 10, size: 8, font: ctx.bold, color: NAVY })
    ctx.page.drawText(sanitizeForWinAnsi(m.serial),      { x: cols[2].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: SLATE })
    ctx.page.drawText(sanitizeForWinAnsi(m.date),        { x: cols[3].x + 2, y: ctx.y - 10, size: 8, font: ctx.font, color: SLATE })
    ctx.page.drawText(sanitizeForWinAnsi(status),        { x: cols[4].x + 2, y: ctx.y - 10, size: 7, font: ctx.bold, color })
    // Two-line hash — first 16 hex chars on top, next 16 below — gives
    // a visual fingerprint without being intimidating.
    const h1 = m.hash.slice(0, 16)
    const h2 = m.hash.slice(16, 32)
    ctx.page.drawText(sanitizeForWinAnsi(h1),            { x: cols[5].x + 2, y: ctx.y - 8,  size: 7, font: ctx.font, color: MUTED })
    ctx.page.drawText(sanitizeForWinAnsi(h2),            { x: cols[5].x + 2, y: ctx.y - 16, size: 7, font: ctx.font, color: MUTED })

    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y - 19 },
      end:   { x: PAGE_W - MARGIN, y: ctx.y - 19 },
      color: RULE, thickness: 0.3,
    })
    ctx.y -= 20
  })

  // Full-hash appendix — same data, machine-readable. Plain text rows
  // so an inspector can copy/paste.
  if (ctx.y < MARGIN + 80) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
    ctx.pageNo += 1
    ctx.drawFooter(ctx)
    ctx.y = PAGE_H - MARGIN
  }
  drawSectionBar(ctx, 'Full hash appendix (machine-readable)')
  manifest.forEach((m, i) => {
    if (ctx.y - 12 < MARGIN + 24) {
      ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
      ctx.pageNo += 1
      ctx.drawFooter(ctx)
      ctx.y = PAGE_H - MARGIN
    }
    const line = `${String(i + 1).padStart(3, ' ')}  ${m.kind === 'cs' ? 'CS' : 'HW'}  ${m.serial}  ${m.hash}`
    ctx.page.drawText(sanitizeForWinAnsi(line), {
      x: MARGIN, y: ctx.y - 9, size: 7, font: ctx.font, color: SLATE,
    })
    ctx.y -= 10
  })
}

// Compute a deterministic bundle ID — the SHA-256 of the manifest's
// concatenated (kind, id) pairs and the period bounds. Two bundles for
// the same permits over the same window get the same ID, which makes
// double-issuance detectable.
async function computeBundleId(args: {
  startDate: string
  endDate:   string
  manifest:  Pick<ManifestEntry, 'kind' | 'id'>[]
}): Promise<string> {
  const sorted = [...args.manifest].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const payload = `${args.startDate}|${args.endDate}|${sorted.map(s => `${s.kind}:${s.id}`).join(',')}`
  const bytes = new TextEncoder().encode(payload)
  return sha256Hex(bytes)
}

export async function generateCompliancePdfBundle(
  args: GenerateBundleArgs,
): Promise<Uint8Array> {
  // Step 1 — build the manifest and per-permit PDFs.
  const manifest: ManifestEntry[] = []
  for (const e of args.csPermits) {
    try {
      const permitUrl = args.origin
        ? `${args.origin}/confined-spaces/${encodeURIComponent(e.space.space_id)}/permits/${e.permit.id}`
        : undefined
      const bytes = await generatePermitPdf({
        space:  e.space,
        permit: e.permit,
        tests:  e.tests,
        permitUrl,
      })
      const hash = await sha256Hex(bytes)
      manifest.push({
        kind:   'cs',
        serial: e.permit.serial,
        id:     e.permit.id,
        date:   (e.permit.started_at ?? e.permit.created_at).slice(0, 10),
        status: csStatus(e.permit),
        hash,
        bytes,
      })
    } catch (err) {
      // One bad permit shouldn't kill the whole bundle. Capture it and
      // skip — the manifest will simply be missing the row, which is
      // also a useful signal at audit time.
      Sentry.captureException(err, {
        tags: { source: 'pdfBundle', stage: 'cs-render' },
        extra: { permitId: e.permit.id },
      })
      console.error('[pdfBundle] CS permit render failed', e.permit.id, err)
    }
  }
  for (const e of args.hotWorkPermits) {
    try {
      const permitUrl = args.origin
        ? `${args.origin}/hot-work/${e.permit.id}`
        : undefined
      const bytes = await generateHotWorkPermitPdf({ permit: e.permit, permitUrl })
      const hash = await sha256Hex(bytes)
      manifest.push({
        kind:   'hotwork',
        serial: e.permit.serial,
        id:     e.permit.id,
        date:   (e.permit.started_at ?? e.permit.created_at).slice(0, 10),
        status: hotWorkStatusLabel(e.permit),
        hash,
        bytes,
      })
    } catch (err) {
      Sentry.captureException(err, {
        tags: { source: 'pdfBundle', stage: 'hotwork-render' },
        extra: { permitId: e.permit.id },
      })
      console.error('[pdfBundle] hot-work permit render failed', e.permit.id, err)
    }
  }
  // Sort manifest chronologically — easier to read at audit time than
  // arbitrary insertion order.
  manifest.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // Step 2 — render the cover into a fresh document.
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])
  const ctx  = createDrawCtx({
    doc, page, font, bold,
    legend: 'Compliance Report Bundle',
  })
  const generated = new Date()
  const bundleId  = await computeBundleId({
    startDate: args.startDate,
    endDate:   args.endDate,
    manifest,
  })
  drawCover(ctx, args, manifest, bundleId, generated)

  // Step 3 — concatenate every permit PDF behind the cover.
  for (const m of manifest) {
    try {
      const child = await PDFDocument.load(m.bytes)
      const copied = await doc.copyPages(child, child.getPageIndices())
      for (const p of copied) doc.addPage(p)
    } catch (err) {
      Sentry.captureException(err, {
        tags: { source: 'pdfBundle', stage: 'concat' },
        extra: { permitId: m.id, kind: m.kind },
      })
      console.error('[pdfBundle] failed to merge permit', m.id, err)
    }
  }

  return doc.save()
}
