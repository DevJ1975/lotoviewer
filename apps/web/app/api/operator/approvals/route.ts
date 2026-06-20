import { NextResponse } from 'next/server'
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

  const [pending, recent] = await Promise.all([
    listPendingActions(gate.tenantId),
    listRecentActions(gate.tenantId),
  ])
  return NextResponse.json({ pending, recent })
}
