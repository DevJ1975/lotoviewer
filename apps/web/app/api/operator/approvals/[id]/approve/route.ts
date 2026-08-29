import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { approveAndApply } from '@/lib/ai/operator/actionQueue'

// POST /api/operator/approvals/[id]/approve
//
// Apply a staged regulated action — one-tap approval. Coarse gate: admin/owner.
// The engine then re-proves the action's SPECIFIC authorizing role (some actions
// require owner) against tenant_memberships before the mutation runs.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  const res = await approveAndApply(
    { tenantId: gate.tenantId, userId: gate.userId, role: gate.role },
    id,
  )
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ status: res.status, summary: res.summary })
}
