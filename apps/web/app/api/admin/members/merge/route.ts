import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { validateJsonBody } from '@/lib/security/validateBody'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/admin/members/merge
//
// Merges two duplicate members rows in the active tenant. The heavy
// lifting (re-pointing FKs, marking the source as merged, emitting a
// member_status_events row) happens in the merge_members() SP — see
// migration 184. This route validates the request, enforces the
// "both-have-login → 409" pre-check, and forwards to the SP.
//
// The SP enforces tenant equality and the both-have-login guard a
// second time as defence in depth.

const MergeBodySchema = z.object({
  sourceMemberId: z.string().uuid(),
  targetMemberId: z.string().uuid(),
  reason:         z.string().trim().min(1).max(500),
}).refine(b => b.sourceMemberId !== b.targetMemberId, {
  message: 'sourceMemberId and targetMemberId must differ',
  path:    ['targetMemberId'],
})

interface MemberCheck {
  id:         string
  tenant_id:  string
  profile_id: string | null
  status:     string
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const parsed = await validateJsonBody(req, MergeBodySchema)
  if (!parsed.ok) return parsed.response
  const { sourceMemberId: sourceId, targetMemberId: targetId, reason } = parsed.data

  const admin = supabaseAdmin()
  const { data: members, error: lookupErr } = await admin
    .from('members')
    .select('id, tenant_id, profile_id, status')
    .in('id', [sourceId, targetId])
    .eq('tenant_id', gate.tenantId)
  if (lookupErr) return sanitizeError(lookupErr, 'admin/members/merge lookup')

  const rows = (members ?? []) as MemberCheck[]
  if (rows.length !== 2) {
    return NextResponse.json({
      error: 'One or both members were not found in the active tenant.',
    }, { status: 404 })
  }
  const source = rows.find(m => m.id === sourceId)
  const target = rows.find(m => m.id === targetId)
  if (!source || !target) {
    return NextResponse.json({ error: 'Could not resolve source/target rows.' }, { status: 404 })
  }
  if (source.status === 'merged' || target.status === 'merged') {
    return NextResponse.json({ error: 'One side is already merged.' }, { status: 409 })
  }
  if (source.profile_id && target.profile_id) {
    return NextResponse.json({
      error: 'BOTH_HAVE_LOGIN',
      message: 'Revoke one login before merging.',
    }, { status: 409 })
  }

  const { data: rpcData, error: rpcErr } = await admin.rpc('merge_members', {
    p_source_id: sourceId,
    p_target_id: targetId,
    p_actor_id:  gate.userId,
    p_reason:    reason,
  })
  if (rpcErr) return sanitizeError(rpcErr, 'admin/members/merge rpc')

  return NextResponse.json({ targetMemberId: (rpcData as string) ?? targetId })
}
