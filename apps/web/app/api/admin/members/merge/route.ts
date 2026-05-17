import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface MergeBody {
  sourceMemberId?: unknown
  targetMemberId?: unknown
  reason?:         unknown
}

interface MemberCheck {
  id:         string
  tenant_id:  string
  profile_id: string | null
  status:     string
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: MergeBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const sourceId = typeof body.sourceMemberId === 'string' ? body.sourceMemberId : ''
  const targetId = typeof body.targetMemberId === 'string' ? body.targetMemberId : ''
  const reason   = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (!UUID_RE.test(sourceId) || !UUID_RE.test(targetId)) {
    return NextResponse.json({ error: 'Valid sourceMemberId and targetMemberId required' }, { status: 400 })
  }
  if (sourceId === targetId) {
    return NextResponse.json({ error: 'sourceMemberId and targetMemberId must differ' }, { status: 400 })
  }
  if (!reason) {
    return NextResponse.json({ error: 'Reason is required' }, { status: 400 })
  }

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
