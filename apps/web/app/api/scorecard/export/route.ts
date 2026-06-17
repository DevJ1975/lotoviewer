import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { computeIncidentRisk } from '@/lib/incidentRiskFeatures'
import { buildScorecardPdf, type ScorecardPdfInput } from '@/lib/pdfScorecard'

// Branded, comprehensive EHS Scorecard PDF. The client POSTs the LOTO + incident
// metrics it already rendered (admin-gated) + the window; this route embeds the
// tenant's logo, recomputes the predicted-risk score server-side (so the PDF's
// headline can't be tampered with), and hands everything to buildScorecardPdf.

export const runtime = 'nodejs'

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export async function POST(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: { metrics?: ScorecardPdfInput['loto']; incidentMetrics?: ScorecardPdfInput['incident']; windowDays?: number }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }
  const windowDays = num(body.windowDays, 30)

  try {
    const { data: tenant } = await g.authedClient
      .from('tenants').select('name, logo_url').eq('id', g.tenantId).maybeSingle()
    const tenantName = (tenant?.name as string | undefined) ?? 'Tenant'
    const logoUrl = (tenant?.logo_url as string | null | undefined) ?? null

    // Best-effort logo fetch (SVG/unsupported → skipped by the generator).
    let logo: ScorecardPdfInput['logo'] = null
    if (logoUrl) {
      try {
        const res = await fetch(logoUrl)
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer())
          const ct = (res.headers.get('content-type') ?? '').toLowerCase()
          const isPng = ct.includes('png') || logoUrl.toLowerCase().endsWith('.png')
          logo = { bytes, isPng }
        }
      } catch { /* logo is optional */ }
    }

    // Authoritative, deterministic risk — recomputed server-side, never trusted
    // from the client. Non-fatal: a failure just omits the risk section.
    let risk: ScorecardPdfInput['risk'] = null
    try { risk = await computeIncidentRisk(supabaseAdmin(), g.tenantId) } catch { risk = null }

    const bytes = await buildScorecardPdf({
      tenantName,
      logo,
      windowDays,
      loto: body.metrics ?? null,
      incident: body.incidentMetrics ?? null,
      risk,
    })

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
