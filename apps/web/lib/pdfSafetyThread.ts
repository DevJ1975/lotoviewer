// Render a safety-board thread (post + replies + acknowledgements)
// to PDF for evidence / investigation files. Reuses the
// page-geometry constants from pdfShared.ts but stays standalone
// because the layout is markedly different from the permit forms
// (multi-page paginated, no section bars, no QR).

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib'
import * as Sentry from '@sentry/nextjs'
import { PAGE_W, PAGE_H, MARGIN } from '@/lib/pdfShared'

const LINE_HEIGHT = 14
const PARAGRAPH_GAP = 6
const TITLE_SIZE = 16
const META_SIZE = 9
const BODY_SIZE = 10

export interface SafetyThreadPdfInput {
  tenantName:   string | null
  boardName:    string
  thread: {
    kind:        string
    title:       string
    body:        string
    created_at:  string
    edited_at:   string | null
    is_anonymous: boolean
    pinned:      boolean
    locked:      boolean
    acknowledgement_required: boolean
    author_full_name: string | null
    author_email:     string | null
    linked_entity_type: string | null
  }
  replies: Array<{
    body: string
    created_at: string
    edited_at: string | null
    is_anonymous: boolean
    author_full_name: string | null
    author_email:     string | null
  }>
  acknowledgements: Array<{
    full_name: string | null
    email: string | null
    acknowledged_at: string
    comment: string | null
  }>
  spawnedActions: Array<{
    description: string
    status:      string
    due_at:      string | null
  }>
}

export async function renderSafetyThreadPdf(input: SafetyThreadPdfInput): Promise<Uint8Array> {
  try {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique)

    const ctx = newPage(pdf, font)

    // Header: tenant + board breadcrumb.
    const breadcrumb = [input.tenantName, input.boardName].filter(Boolean).join(' › ')
    drawText(ctx, breadcrumb || 'Safety board', { size: META_SIZE, color: 'muted' })
    skip(ctx, LINE_HEIGHT)

    // Title.
    drawWrapped(ctx, input.thread.title, { size: TITLE_SIZE, font: fontBold })
    skip(ctx, 4)

    // Meta line.
    const author = input.thread.is_anonymous
      ? 'Anonymous'
      : (input.thread.author_full_name || input.thread.author_email || 'Unknown')
    const flags: string[] = []
    flags.push(input.thread.kind.replace(/_/g, ' '))
    if (input.thread.pinned) flags.push('pinned')
    if (input.thread.locked) flags.push('locked')
    if (input.thread.acknowledgement_required) flags.push('acknowledgement required')
    if (input.thread.linked_entity_type) flags.push(`linked to ${input.thread.linked_entity_type.replace(/_/g, ' ')}`)
    const metaLine = `${author} · ${new Date(input.thread.created_at).toLocaleString()}` +
                     (input.thread.edited_at ? ' · edited' : '') +
                     ` · ${flags.join(' · ')}`
    drawWrapped(ctx, metaLine, { size: META_SIZE, color: 'muted', font: fontItalic })
    skip(ctx, PARAGRAPH_GAP)

    // Body.
    drawWrapped(ctx, input.thread.body, { size: BODY_SIZE, font })
    skip(ctx, PARAGRAPH_GAP * 2)

    // Spawned actions (if any).
    if (input.spawnedActions.length > 0) {
      drawText(ctx, 'Actions spawned from this thread:', { size: BODY_SIZE, font: fontBold })
      skip(ctx, PARAGRAPH_GAP)
      for (const a of input.spawnedActions) {
        const due = a.due_at ? ` (due ${new Date(a.due_at).toLocaleDateString()})` : ''
        drawWrapped(ctx, `• ${a.description} — ${a.status}${due}`, { size: BODY_SIZE, font })
      }
      skip(ctx, PARAGRAPH_GAP * 2)
    }

    // Replies.
    if (input.replies.length > 0) {
      drawText(ctx, `Replies (${input.replies.length})`, { size: BODY_SIZE, font: fontBold })
      skip(ctx, PARAGRAPH_GAP)
      for (const r of input.replies) {
        const a = r.is_anonymous
          ? 'Anonymous'
          : (r.author_full_name || r.author_email || 'Unknown')
        drawWrapped(ctx, `${a} · ${new Date(r.created_at).toLocaleString()}${r.edited_at ? ' · edited' : ''}`, { size: META_SIZE, color: 'muted', font: fontItalic })
        drawWrapped(ctx, r.body, { size: BODY_SIZE, font })
        skip(ctx, PARAGRAPH_GAP)
      }
      skip(ctx, PARAGRAPH_GAP)
    }

    // Acknowledgements (audit roster).
    if (input.acknowledgements.length > 0) {
      drawText(ctx, `Acknowledgements (${input.acknowledgements.length})`, { size: BODY_SIZE, font: fontBold })
      skip(ctx, PARAGRAPH_GAP)
      for (const ack of input.acknowledgements) {
        const who = ack.full_name || ack.email || 'Unknown'
        const when = new Date(ack.acknowledged_at).toLocaleString()
        const comment = ack.comment ? ` — "${ack.comment}"` : ''
        drawWrapped(ctx, `• ${who} · ${when}${comment}`, { size: BODY_SIZE, font })
      }
      skip(ctx, PARAGRAPH_GAP * 2)
    }

    // Footer on every page (printed from a second pass).
    finalizeFooters(ctx, font)

    return await pdf.save()
  } catch (e) {
    Sentry.captureException(e, { tags: { kind: 'pdf-safety-thread' } })
    throw e
  }
}

// ─── Drawing primitives ────────────────────────────────────────────────────

interface PageCtx {
  pdf:  PDFDocument
  font: PDFFont
  page: PDFPage
  pages: PDFPage[]
  cursorY: number
}

function newPage(pdf: PDFDocument, font: PDFFont): PageCtx {
  const ctx: PageCtx = { pdf, font, page: pdf.addPage([PAGE_W, PAGE_H]), pages: [], cursorY: PAGE_H - MARGIN }
  ctx.pages.push(ctx.page)
  return ctx
}

function ensureRoom(ctx: PageCtx, needed: number) {
  if (ctx.cursorY - needed < MARGIN + 24) {
    ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H])
    ctx.pages.push(ctx.page)
    ctx.cursorY = PAGE_H - MARGIN
  }
}

function skip(ctx: PageCtx, n: number) {
  ctx.cursorY -= n
}

interface DrawOpts {
  size?: number
  color?: 'default' | 'muted'
  font?: PDFFont
}

function drawText(ctx: PageCtx, text: string, opts: DrawOpts = {}) {
  const size = opts.size ?? BODY_SIZE
  ensureRoom(ctx, size + 2)
  ctx.page.drawText(sanitize(text), {
    x: MARGIN,
    y: ctx.cursorY - size,
    size,
    font: opts.font ?? ctx.font,
    color: opts.color === 'muted' ? rgb(0.45, 0.5, 0.58) : rgb(0.13, 0.18, 0.27),
  })
  ctx.cursorY -= size + 2
}

function drawWrapped(ctx: PageCtx, text: string, opts: DrawOpts = {}) {
  const size = opts.size ?? BODY_SIZE
  const font = opts.font ?? ctx.font
  const maxWidth = PAGE_W - MARGIN * 2
  const paragraphs = text.split(/\n\n+/)
  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx]
    const lines = wrap(para, font, size, maxWidth)
    for (const line of lines) {
      ensureRoom(ctx, size + 2)
      ctx.page.drawText(sanitize(line), {
        x: MARGIN,
        y: ctx.cursorY - size,
        size,
        font,
        color: opts.color === 'muted' ? rgb(0.45, 0.5, 0.58) : rgb(0.13, 0.18, 0.27),
      })
      ctx.cursorY -= size + 2
    }
    if (pIdx < paragraphs.length - 1) skip(ctx, PARAGRAPH_GAP)
  }
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(/\s+/)
    let cur = ''
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w
      if (font.widthOfTextAtSize(sanitize(test), size) > maxWidth && cur) {
        lines.push(cur)
        cur = w
      } else {
        cur = test
      }
    }
    if (cur) lines.push(cur)
  }
  return lines
}

function finalizeFooters(ctx: PageCtx, font: PDFFont) {
  const total = ctx.pages.length
  for (let i = 0; i < total; i++) {
    const pg = ctx.pages[i]
    pg.drawText(sanitize(`SoteriaField · ${new Date().toLocaleString()} · page ${i + 1} of ${total}`), {
      x: MARGIN,
      y: MARGIN / 2,
      size: 8,
      font,
      color: rgb(0.55, 0.6, 0.66),
    })
  }
}

// pdf-lib's Helvetica is WinAnsi-only. Replace common Unicode
// punctuation that would otherwise throw at draw-time.
function sanitize(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/–/g, '-')   // en dash
    .replace(/—/g, '-')   // em dash
    .replace(/…/g, '...') // ellipsis
    .replace(/ /g, ' ')   // nbsp
}
