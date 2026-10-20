import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { computeIncidentRisk } from '@/lib/incidentRiskFeatures'
import { buildScorecardPdf, type ScorecardPdfInput } from '@/lib/pdfScorecard'
import { loadExportMicrolearning, parseScorecardWindow, scorecardExportResponse } from '@/lib/scorecardExport'

// Branded, comprehensive EHS Scorecard PDF. The client POSTs the LOTO + incident
// metrics it already rendered (admin-gated) + the window; this route embeds the
// tenant's logo, recomputes the predicted-risk score server-side (so the PDF's
// headline can't be tampered with), computes the microlearning section
// server-side for the same reason, and hands everything to buildScorecardPdf.

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: { metrics?: ScorecardPdfInput['loto']; incidentMetrics?: ScorecardPdfInput['incident']; windowDays?: number }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }
  const windowDays = parseScorecardWindow(body.windowDays)

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
    const microlearning = await loadExportMicrolearning(supabaseAdmin(), g.tenantId, windowDays)

    const bytes = await buildScorecardPdf({
      tenantName,
      logo,
      windowDays,
      loto: body.metrics ?? null,
      incident: body.incidentMetrics ?? null,
      risk,
      microlearning,
    })

    return scorecardExportResponse(bytes, 'pdf')
  } catch (e) {
    return sanitizeError(e, 'POST /api/scorecard/export')
  }
}
