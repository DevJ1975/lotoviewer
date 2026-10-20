import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeMember } from '@/lib/strike/gate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { issueKioskToken } from '@/lib/strike/kioskToken'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Issues a "Train now" link for one roster member and one module. Any
// member of the tenant who can edit may issue one — the supervisor standing
// at the permit is usually not an admin — and they are recorded as the
// issuer on the resulting completion. A viewer can't: being named on a
// completion is the same act as signing one off, which viewers can't do.
export async function POST(req: Request) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  if (gate.role === 'viewer') return NextResponse.json({ error: 'View-only accounts can’t issue training links.' }, { status: 403 })

  const limit = checkMemoryRateLimit(`strike-kiosk-token:${gate.tenantId}:${gate.userId}`, 30, 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  let body: { member_id?: unknown; module_id?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const memberId = typeof body.member_id === 'string' ? body.member_id : ''
  const moduleId = typeof body.module_id === 'string' ? body.module_id : ''
  if (!UUID_RE.test(memberId) || !UUID_RE.test(moduleId)) {
    return NextResponse.json({ error: 'Invalid member or module id' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const [{ data: member, error: memberErr }, { data: moduleRow, error: moduleErr }] = await Promise.all([
      admin.from('members').select('id,tenant_id,status').eq('id', memberId).maybeSingle(),
      admin.from('strike_modules').select('id,tenant_id,library_scope,status').eq('id', moduleId).maybeSingle(),
    ])
    if (memberErr || moduleErr) throw new Error((memberErr ?? moduleErr)?.message)
    if (!member || member.tenant_id !== gate.tenantId || member.status !== 'active') {
      return NextResponse.json({ error: 'Worker not found on this roster.' }, { status: 404 })
    }
    const visible = moduleRow?.status === 'published'
      && (moduleRow.library_scope === 'global' || moduleRow.tenant_id === gate.tenantId)
    if (!visible) return NextResponse.json({ error: 'Training module not found.' }, { status: 404 })

    const { token, expiresAt } = issueKioskToken({ tenantId: gate.tenantId, memberId, moduleId, issuedBy: gate.userId })
    const origin = new URL(req.url).origin
    return NextResponse.json({
      token,
      url: `${origin}/train/${encodeURIComponent(token)}`,
      expires_at: new Date(expiresAt).toISOString(),
    }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/kiosk/token' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
