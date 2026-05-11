import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { STRIKE_REQUIREMENT_SOURCE_TYPES, type StrikeRequirementSourceType } from '@soteria/core/strike'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Body {
  source_type?: unknown
  source_id?: unknown
  user_id?: unknown
  role?: unknown
  due_at?: unknown
  reason?: unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Body
  try { body = await req.json() as Body }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const sourceType = typeof body.source_type === 'string' && (STRIKE_REQUIREMENT_SOURCE_TYPES as readonly string[]).includes(body.source_type)
    ? body.source_type as StrikeRequirementSourceType
    : null
  if (!sourceType) return NextResponse.json({ error: 'Invalid source_type' }, { status: 400 })

  const sourceId = typeof body.source_id === 'string' && UUID_RE.test(body.source_id) ? body.source_id : null
  const userId = typeof body.user_id === 'string' && UUID_RE.test(body.user_id) ? body.user_id : null
  const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : null
  if (!userId && !role) return NextResponse.json({ error: 'user_id or role is required' }, { status: 400 })

  const dueAtRaw = typeof body.due_at === 'string' && body.due_at.trim() ? body.due_at.trim() : null
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : null
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return NextResponse.json({ error: 'Invalid due_at' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim()
    : `${sourceType.replace(/_/g, ' ')} retraining`

  try {
    const admin = supabaseAdmin()
    let requirementsQuery = admin
      .from('strike_training_requirements')
      .select('id,module_id,module_version_id,source_type,source_id')
      .eq('tenant_id', gate.tenantId)
      .eq('active', true)
      .eq('source_type', sourceType)

    if (sourceId) requirementsQuery = requirementsQuery.or(`source_id.eq.${sourceId},source_id.is.null`)
    else requirementsQuery = requirementsQuery.is('source_id', null)

    const { data: requirements, error: reqErr } = await requirementsQuery
    if (reqErr) throw new Error(reqErr.message)
    if (!requirements?.length) {
      return NextResponse.json({ assignments_created: 0, message: 'No active STRIKE requirements matched.' })
    }

    const inserts = requirements.map(reqRow => ({
      tenant_id: gate.tenantId,
      module_id: reqRow.module_id,
      module_version_id: reqRow.module_version_id,
      target_type: userId ? 'user' : 'role',
      target_id: userId ?? role,
      assigned_by: gate.userId,
      due_at: dueAt ? dueAt.toISOString() : null,
      reason,
      status: 'active',
    }))

    const { data, error: insertErr } = await admin
      .from('strike_assignments')
      .insert(inserts)
      .select('id,module_id,target_type,target_id')
    if (insertErr) throw new Error(insertErr.message)

    return NextResponse.json({ assignments_created: data?.length ?? 0, assignments: data ?? [] }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'strike/assign-from-source' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
