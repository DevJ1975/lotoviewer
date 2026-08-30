import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { rejectAction } from '@/lib/ai/operator/actionQueue'

// POST /api/operator/approvals/[id]/reject  { reason: string }
//
// Decline a staged regulated action. A reason is required — it is recorded on the
// ledger row. Same gating as approve: admin/owner at the route, the action's
// authorizing role re-proved by the engine.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  let reason = ''
  try {
    const body = await req.json()
    reason = typeof body?.reason === 'string' ? body.reason : ''
  } catch {
    // Empty/invalid body → the engine rejects the missing reason with a 400.
  }

  const res = await rejectAction(
    { tenantId: gate.tenantId, userId: gate.userId, role: gate.role },
    id,
    reason,
  )
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ status: res.status, summary: res.summary })
}
