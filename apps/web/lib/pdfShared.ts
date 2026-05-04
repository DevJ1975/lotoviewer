import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
import * as Sentry from '@sentry/nextjs'
import { hexToRgb01 } from '@/lib/energyCodes'

// Shared building blocks for the OSHA permit PDFs (Confined Space + Hot Work).
// Both generators use single-page portrait Letter, navy section bars, the same
// key/value rows, the same WinAnsi sanitiser, and the same QR pattern. Keeping
// them here means a fix to e.g. the WinAnsi substitution table or the wrap()
// algorithm reaches both permit prints in one place — historically that
// duplication was the largest source of drift in the PDF layer.
//
// pdfPlacard.ts intentionally keeps its own (simpler, no-normalisation)
// sanitiser and its own page geometry, since placards are landscape with a
// completely different layout.

// ── Page geometry ──────────────────────────────────────────────────────────
export const PAGE_W = 612    // 8.5" × 72
export const PAGE_H = 792    // 11"  × 72
export const MARGIN = 36

// ── Palette (matches the placard generator so prints feel cohesive) ────────
export const NAVY    = rgb(...hexToRgb01('#214488'))
export const SLATE   = rgb(0.15, 0.18, 0.23)
export const MUTED   = rgb(0.45, 0.50, 0.55)
export const RULE    = rgb(0.82, 0.85, 0.90)
export const WHITE   = rgb(1, 1, 1)
export const BLACK   = rgb(0, 0, 0)
export const RED     = rgb(...hexToRgb01('#BF1414'))
export const AMBER   = rgb(...hexToRgb01('#D97706'))
export const EMERALD = rgb(...hexToRgb01('#059669'))
export const FAINT   = rgb(0.96, 0.97, 0.99)

// ── WinAnsi sanitiser ──────────────────────────────────────────────────────
//
// pdf-lib's StandardFonts use WinAnsi (CP1252) which doesn't cover Unicode
// subscripts/superscripts or many typography chars. Hazard text from users
// or the AI suggester routinely contains O₂, H₂S, CO₂ (subscripts at U+2082)
// and would crash render with "WinAnsi cannot encode '₂'". Map to ASCII
// before any drawText / widthOfTextAtSize call.
// Pinned by __tests__/lib/pdfPermit.test.ts — a regression here once
// crashed the entire PDF generator in production.

// Chars in WinAnsi's 0x80-0x9F range that the engine CAN render even
// though they're outside Latin-1. Preserved by the catch-all so a pasted
// bullet (•), trademark (™), or currency (€) survives. Smart quotes /
// em-dash / ellipsis are normalized to ASCII earlier in the pipeline.
const WINANSI_HIGH_KEEP = '€‚ƒ„†‡ˆ‰Š‹ŒŽ•˜™š›œžŸ'

export function sanitizeForWinAnsi(s: string): string {
  if (!s) return s
  // Built per call (cheap; the kept chars are a fixed string).
  // The /u flag matters for supplementary-plane chars (e.g. emoji) so
  // surrogate pairs collapse to a single '?' instead of '??'.
  const stripOther = new RegExp(`[^\\x00-\\xFF\\n\\r\\t${WINANSI_HIGH_KEEP}]`, 'gu')
  return s
    .replace(/[₀-₉]/g, c => String.fromCharCode(0x30 + (c.charCodeAt(0) - 0x2080))) // ₀-₉
    .replace(/[⁰⁴-⁹]/g, c => String.fromCharCode(0x30 + (c.charCodeAt(0) - 0x2070))) // ⁰ ⁴-⁹
    .replace(/²/g, '2').replace(/³/g, '3').replace(/¹/g, '1') // ² ³ ¹ (in WinAnsi but normalize anyway)
    .replace(/⁺/g, '+').replace(/⁻/g, '-')                         // ⁺ ⁻
    .replace(/₊/g, '+').replace(/₋/g, '-')                         // ₊ ₋
    .replace(/[‐‑−]/g, '-')                                   // hyphens, minus
    .replace(/ /g, ' ')                                                // nbsp (U+00A0)
    .replace(/[‘’‚‛]/g, "'")                              // smart single quotes
    .replace(/[“”„‟]/g, '"')                              // smart double quotes
    .replace(/…/g, '...')                                                // …
    .replace(/[–—]/g, '-')                                          // – —
    .replace(/[×]/g, 'x')                                                // × (in WinAnsi but normalize)
    .replace(stripOther, '?')                                            // strip anything else (preserve WinAnsi 0x80-0x9F)
}

// ── Drawing context ────────────────────────────────────────────────────────
//
// `drawFooter` is bound to the context so reserveSpace() can paint a footer
// on each freshly-added page without every caller threading a footer-drawer
// argument. The footer legend differs per permit type (CS vs hot-work);
// callers create the ctx via createDrawCtx() with their legend.
export interface DrawCtx {
  doc:        PDFDocument
  page:       PDFPage
  font:       PDFFont
  bold:       PDFFont
  y:          number
  pageNo:     number
  drawFooter: (ctx: DrawCtx) => void
}

export function createDrawCtx(args: {
  doc:    PDFDocument
  page:   PDFPage
  font:   PDFFont
  bold:   PDFFont
  legend: string
}): DrawCtx {
  const ctx: DrawCtx = {
    doc:    args.doc,
    page:   args.page,
    font:   args.font,
    bold:   args.bold,
    y:      PAGE_H - MARGIN,
    pageNo: 1,
    drawFooter: (c: DrawCtx) => {
      const text = sanitizeForWinAnsi(
        `Page ${c.pageNo}  ·  ${args.legend}  ·  Generated ${new Date().toLocaleString()}`
      )
      const w = c.font.widthOfTextAtSize(text, 7)
      c.page.drawText(text, {
        x: PAGE_W - MARGIN - w, y: 18, size: 7, font: c.font, color: MUTED,
      })
    },
  }
  ctx.drawFooter(ctx)
  return ctx
}

// ── Text helpers ────────────────────────────────────────────────────────────
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

// QR code embedded next to the title so anyone holding the printed permit
// can scan to the live digital permit. Generated at high error-correction
// (level Q) so a folded or smudged print still scans. `tag` is included in
// the failure log so you can tell which generator failed.
export async function embedQrCode(
  doc: PDFDocument,
  url: string,
  tag: string,
): Promise<PDFImage | null> {
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
    // stays traceable manually. Capture so we can tell whether QR
    // failures are an isolated incident or a regression.
    Sentry.captureException(err, { tags: { source: tag, stage: 'qr-encode' } })
    console.error(`[${tag}] QR generation failed`, err)
    return null
  }
}

// Reserve `needed` vertical points; if not enough, start a new page and
// paint the footer on it.
export function reserveSpace(ctx: DrawCtx, needed: number): void {
  if (ctx.y - needed < MARGIN + 24) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
    ctx.pageNo += 1
    ctx.drawFooter(ctx)
    ctx.y = PAGE_H - MARGIN
  }
}

// ── Section drawing ────────────────────────────────────────────────────────
export function drawSectionBar(ctx: DrawCtx, title: string): void {
  reserveSpace(ctx, 24)
  ctx.page.drawRectangle({
    x: MARGIN, y: ctx.y - 18, width: PAGE_W - 2 * MARGIN, height: 18, color: NAVY,
  })
  ctx.page.drawText(sanitizeForWinAnsi(title.toUpperCase()), {
    x: MARGIN + 8, y: ctx.y - 13, size: 9, font: ctx.bold, color: WHITE,
  })
  ctx.y -= 24
}

export function drawKeyValue(
  ctx: DrawCtx,
  key: string,
  value: string,
  opts?: { wrap?: boolean },
): void {
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

export function drawBullets(ctx: DrawCtx, items: string[]): void {
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

export function drawDivider(ctx: DrawCtx): void {
  reserveSpace(ctx, 8)
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y - 4 },
    end:   { x: PAGE_W - MARGIN, y: ctx.y - 4 },
    color: RULE, thickness: 0.5,
  })
  ctx.y -= 8
}
