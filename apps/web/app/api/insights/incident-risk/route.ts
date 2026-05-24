import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { computeIncidentRisk } from '@/lib/incidentRiskFeatures'

// Data-driven incident-risk score for the active tenant: a 0–100 score, a
// band, and the ranked drivers ("where to work"). Admin-gated; the score is
// deterministic (no LLM) and computed live from the leading/lagging
// indicators in @soteria/core/incidentRiskModel.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  try {
    const result = await computeIncidentRisk(supabaseAdmin(), g.tenantId)
    return Response.json(result)
  } catch (e) {
    return sanitizeError(e, 'GET /api/insights/incident-risk')
  }
}
