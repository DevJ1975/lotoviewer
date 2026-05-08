import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  BBS_KINDS,
  BBS_SEVERITY,
  BBS_LIKELIHOOD,
  BBS_STATUSES,
  validateBBSCreateInput,
  type BBSKind,
  type BBSSeverity,
  type BBSLikelihood,
  type BBSStatus,
} from '@soteria/core/bbs'

// GET  /api/bbs/observations    List with filters (any tenant member).
// POST /api/bbs/observations    Authenticated submission. Anonymous
//                               submissions go through /api/bbs/intake
//                               which validates the QR token instead.

const VALID_SORTS = ['created_at', 'observed_at', 'risk_score', 'report_number'] as const
const VALID_DIRS  = ['asc', 'desc'] as const

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)

  const kindRaw = url.searchParams.get('kind')
  const kinds = kindRaw
    ? kindRaw.split(',').map(s => s.trim()).filter((s): s is BBSKind =>
        (BBS_KINDS as readonly string[]).includes(s))
    : []

  const statusRaw = url.searchParams.get('status')
  const statuses = statusRaw
    ? statusRaw.split(',').map(s => s.trim()).filter((s): s is BBSStatus =>
        (BBS_STATUSES as readonly string[]).includes(s))
    : []

  const search = url.searchParams.get('search')?.trim() ?? ''
  const sortRaw = url.searchParams.get('sort')
  const sort = (VALID_SORTS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as typeof VALID_SORTS[number]) : 'created_at'
  const dirRaw = url.searchParams.get('dir')
  const dir = (VALID_DIRS as readonly string[]).includes(dirRaw ?? '')
    ? (dirRaw as typeof VALID_DIRS[number]) : 'desc'

  const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit')  ?? '50', 10) || 50))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

  try {
    let q = gate.authedClient
      .from('bbs_observations')
      .select('*', { count: 'exact' })
      .eq('tenant_id', gate.tenantId)

    if (kinds.length    > 0) q = q.in('kind', kinds)
    if (statuses.length > 0) q = q.in('status', statuses)
    if (search) {
      const safe = search.replace(/[,()]/g, ' ').trim()
      if (safe) q = q.or(`description.ilike.%${safe}%,report_number.ilike.%${safe}%,location_text.ilike.%${safe}%`)
    }

    q = q.order(sort, { ascending: dir === 'asc' }).range(offset, offset + limit - 1)

    const { data, count, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({
      observations: data ?? [],
      total:        count ?? 0,
      limit,
      offset,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const kind = typeof body.kind === 'string' && (BBS_KINDS as readonly string[]).includes(body.kind)
    ? (body.kind as BBSKind) : null
  const severity = typeof body.severity === 'string' && (BBS_SEVERITY as readonly string[]).includes(body.severity)
    ? (body.severity as BBSSeverity) : null
  const likelihood = typeof body.likelihood === 'string' && (BBS_LIKELIHOOD as readonly string[]).includes(body.likelihood)
    ? (body.likelihood as BBSLikelihood) : null

  if (!kind) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })

  const errors = validateBBSCreateInput({
    kind,
    description: typeof body.description === 'string' ? body.description : '',
    severity,
    likelihood,
  })
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.map(e => `${e.field}: ${e.message}`).join('; ') }, { status: 400 })
  }

  // Optional QR location — must belong to the active tenant if provided.
  const qrLocationId = typeof body.qr_location_id === 'string' && body.qr_location_id ? body.qr_location_id : null

  const insert = {
    tenant_id:              gate.tenantId,
    submitted_by:           gate.userId,
    submitted_name:         null,
    qr_location_id:         qrLocationId,
    observed_at:            typeof body.observed_at === 'string' ? body.observed_at : new Date().toISOString(),
    location_text:          typeof body.location_text === 'string' && body.location_text.trim() ? body.location_text.trim() : null,
    department:             typeof body.department === 'string' && body.department.trim() ? body.department.trim() : null,
    kind,
    category:               typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null,
    description:            (body.description as string).trim(),
    immediate_action_taken: typeof body.immediate_action_taken === 'string' && body.immediate_action_taken.trim() ? body.immediate_action_taken.trim() : null,
    abc_antecedent:         typeof body.abc_antecedent === 'string' && body.abc_antecedent.trim() ? body.abc_antecedent.trim() : null,
    abc_behavior:           typeof body.abc_behavior === 'string' && body.abc_behavior.trim() ? body.abc_behavior.trim() : null,
    abc_consequence:        typeof body.abc_consequence === 'string' && body.abc_consequence.trim() ? body.abc_consequence.trim() : null,
    severity,
    likelihood,
    status:                 'open' as const,
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('bbs_observations')
      .insert(insert)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ observation: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
