import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { computeSafetyBriefing } from '@/lib/safetyBriefingFeatures'
import { precursorRuleCatalog } from '@soteria/core/precursorRules'

// GET /api/insights/briefing — the proactive safety briefing for the active
// tenant: a ranked list of moves, each with the evidence that put it there.
//
// Every number is deterministic and computed in @soteria/core — the ranking,
// the score, and the "score reduction if cleared" arithmetic. No model is
// called on this path at all. That matters for the claim the endpoint makes:
// the reduction figure is arithmetic on the risk model's fixed weight vector,
// not a predicted change in incident probability, and it is named accordingly.
//
// Admin-gated, matching /api/insights/incident-risk. The briefing exposes the
// same risk drivers plus hazard findings from field photos, so it must not be
// reachable at a lower gate than the score it is built from.
//
// ?rules=1 returns the precursor rule catalog — each rule's stated premise —
// so the UI (and an auditor) can read what the system is claiming and why
// before looking at what fired.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  if (url.searchParams.get('rules') === '1') {
    return NextResponse.json({ rules: precursorRuleCatalog() })
  }

  const requested = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(requested, MAX_LIMIT))
    : DEFAULT_LIMIT

  try {
    const briefing = await computeSafetyBriefing(supabaseAdmin(), gate.tenantId, { limit })
    return NextResponse.json(briefing)
  } catch (err) {
    return sanitizeError(err, 'GET /api/insights/briefing')
  }
}
