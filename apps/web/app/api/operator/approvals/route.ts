import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { listPendingActions, listRecentActions } from '@/lib/ai/operator/actionQueue'

// GET /api/operator/approvals
//
// The approval inbox for the active tenant — the regulated carve-outs an agent
// has staged. Returns the `pending` queue (awaiting a decision) plus a short
// `recent` history (applied / rejected / rolled_back), which carries the
// rollback affordance for an applied, reversible action. Any member may view;
// the act endpoints (./[id]/approve|reject|rollback) re-prove the action's
// authorizing role before anything takes effect.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  // Never mask a load failure as an empty inbox — surface it so the UI shows an
  // error rather than implying nothing is awaiting approval.
  try {
    const [pending, recent] = await Promise.all([
      listPendingActions(gate.tenantId),
      listRecentActions(gate.tenantId),
    ])
    return NextResponse.json({ pending, recent })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/operator/approvals' } })
    return NextResponse.json({ error: 'Could not load the approval queue. Please retry.' }, { status: 500 })
  }
}
