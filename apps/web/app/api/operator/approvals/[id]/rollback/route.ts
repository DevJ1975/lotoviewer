import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { rollbackAction } from '@/lib/ai/operator/actionQueue'

// POST /api/operator/approvals/[id]/rollback
//
// Reverse a previously-applied, reversible action (e.g. un-sign a hot-work
// permit). 409 if the action is not applied, or not reversible. Same gating as
// approve: admin/owner at the route, the action's authorizing role re-proved by
// the engine.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  const res = await rollbackAction(
    { tenantId: gate.tenantId, userId: gate.userId, role: gate.role },
    id,
  )
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ status: res.status, summary: res.summary })
}
