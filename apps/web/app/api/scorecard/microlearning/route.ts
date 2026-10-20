import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { loadMicrolearningSummary } from '@/lib/strike/scorecardData'
import { parseScorecardWindow } from '@/lib/scorecardExport'

// The EHS Scorecard's microlearning (STRIKE) section for the active tenant.
// `summary` is null when STRIKE is turned off, so the section hides itself.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const windowDays = parseScorecardWindow(new URL(req.url).searchParams.get('window'))
  try {
    const summary = await loadMicrolearningSummary(supabaseAdmin(), g.tenantId, windowDays)
    return Response.json({ summary }, { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    return sanitizeError(e, 'GET /api/scorecard/microlearning')
  }
}
