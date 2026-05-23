import { PDFDocument, StandardFonts } from 'pdf-lib'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  PAGE_W, PAGE_H, MARGIN, NAVY, WHITE,
  createDrawCtx, drawSectionBar, drawKeyValue, drawDivider, sanitizeForWinAnsi,
} from '@/lib/pdfShared'

// Branded EHS Scorecard PDF. The client POSTs the metrics it already rendered
// (admin-gated) + the window; this route embeds the tenant's logo in the header
// and lays out the program metrics. Returns a PDF attachment.

export const runtime = 'nodejs'

interface ScorecardLike {
  totalPermits?: number
  cancelRate?: number
  avgPermitDurationMinutes?: number
  failingTestRate?: number
  photoCompletionPct?: number
  cancelReasonBreakdown?: { reason?: unknown; count?: unknown }[]
}

function humanizeMin(min: number): string {
  if (!min) return '0m'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export async function POST(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: { metrics?: ScorecardLike; windowDays?: number }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }
  const m = body.metrics ?? {}
  const windowDays = num(body.windowDays, 30)

  try {
    const { data: tenant } = await g.authedClient
      .from('tenants').select('name, logo_url').eq('id', g.tenantId).maybeSingle()
    const tenantName = (tenant?.name as string | undefined) ?? 'Tenant'
    const logoUrl = (tenant?.logo_url as string | null | undefined) ?? null

    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const page = doc.addPage([PAGE_W, PAGE_H])

    // Header band with the tenant logo (best-effort; SVG/unsupported → skipped).
    const bandH = 64
    page.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: bandH, color: NAVY })
    if (logoUrl) {
      try {
        const res = await fetch(logoUrl)
        if (res.ok) {
          const buf = new Uint8Array(await res.arrayBuffer())
          const ct = (res.headers.get('content-type') ?? '').toLowerCase()
          const isPng = ct.includes('png') || logoUrl.toLowerCase().endsWith('.png')
          const img = isPng ? await doc.embedPng(buf) : await doc.embedJpg(buf)
          const h = 40
          const w = img.width * (h / img.height)
          page.drawImage(img, { x: PAGE_W - MARGIN - w, y: PAGE_H - bandH + (bandH - h) / 2, width: w, height: h })
        }
      } catch { /* logo is optional — header still has the tenant name */ }
    }
    page.drawText(sanitizeForWinAnsi(tenantName), { x: MARGIN, y: PAGE_H - 26, size: 14, font: bold, color: WHITE })
    page.drawText(sanitizeForWinAnsi(`EHS Scorecard · last ${windowDays} days`), { x: MARGIN, y: PAGE_H - 45, size: 10, font, color: WHITE })

    const ctx = createDrawCtx({ doc, page, font, bold, legend: `${tenantName} · EHS Scorecard` })
    ctx.y = PAGE_H - bandH - 16

    drawSectionBar(ctx, 'Program metrics')
    drawKeyValue(ctx, 'Permit Load', `${num(m.totalPermits)} permits`)
    drawKeyValue(ctx, 'Cancel Pressure', `${num(m.cancelRate)}% non-routine`)
    drawKeyValue(ctx, 'Permit Cycle', `${humanizeMin(num(m.avgPermitDurationMinutes))} closed average`)
    drawKeyValue(ctx, 'Atmospheric Control', `${num(m.failingTestRate)}% failed tests`)
    drawKeyValue(ctx, 'LOTO Photo Readiness', `${num(m.photoCompletionPct)}% complete`)

    const reasons = Array.isArray(m.cancelReasonBreakdown) ? m.cancelReasonBreakdown : []
    if (reasons.length > 0) {
      drawDivider(ctx)
      drawSectionBar(ctx, 'Cancellation drivers')
      for (const r of reasons) {
        drawKeyValue(ctx, String(r.reason ?? '—'), String(num(r.count)))
      }
    }

    const bytes = await doc.save()
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="ehs-scorecard-${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    })
  } catch (e) {
    return sanitizeError(e, 'POST /api/scorecard/export')
  }
}
