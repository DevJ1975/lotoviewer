import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { listPendingActions } from '@/lib/ai/operator/actionQueue'

// GET /api/operator/approvals
//
// The pending approval inbox for the active tenant — the regulated carve-outs an
// agent has staged and a qualified human must apply or reject. Any member may
// view the queue; the act endpoints (./[id]/approve|reject|rollback) re-prove the
// action's authorizing role before anything takes effect.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const pending = await listPendingActions(gate.tenantId)
  return NextResponse.json({ pending })
}
