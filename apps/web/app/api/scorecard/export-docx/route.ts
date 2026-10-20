import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { computeIncidentRisk } from '@/lib/incidentRiskFeatures'
import { buildScorecardDocx, type ScorecardDocumentInput } from '@/lib/scorecardDocument'
import { loadExportMicrolearning, parseScorecardWindow, scorecardExportResponse } from '@/lib/scorecardExport'

// Word (.docx) EHS Scorecard. Same sourcing as the PDF and Excel routes: the
// client POSTs the LOTO + incident metrics it already rendered; the
// predicted-risk score and the microlearning section are computed here, never
// taken from the client.

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: { metrics?: ScorecardDocumentInput['loto']; incidentMetrics?: ScorecardDocumentInput['incident']; windowDays?: number }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }
  const windowDays = parseScorecardWindow(body.windowDays)

  try {
    const { data: tenant } = await g.authedClient
      .from('tenants').select('name').eq('id', g.tenantId).maybeSingle()
    const tenantName = (tenant?.name as string | undefined) ?? 'Tenant'

    // Non-fatal like the other formats: a failure just omits the risk rows.
    let risk: ScorecardDocumentInput['risk'] = null
    try { risk = await computeIncidentRisk(supabaseAdmin(), g.tenantId) } catch { risk = null }
    const microlearning = await loadExportMicrolearning(supabaseAdmin(), g.tenantId, windowDays)

    const bytes = await buildScorecardDocx({
      tenantName,
      windowDays,
      loto: body.metrics ?? null,
      incident: body.incidentMetrics ?? null,
      risk,
      microlearning,
    })
    return scorecardExportResponse(bytes, 'docx')
  } catch (e) {
    return sanitizeError(e, 'POST /api/scorecard/export-docx')
  }
}
