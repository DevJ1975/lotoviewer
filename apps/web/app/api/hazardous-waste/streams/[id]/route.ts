import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  HAZARDOUS_WASTE_PHYSICAL_STATES,
  HAZARDOUS_WASTE_STREAM_STATUSES,
} from '@soteria/core/hazardousWaste'

// GET   /api/hazardous-waste/streams/[id]   Fetch a single stream row.
// PATCH /api/hazardous-waste/streams/[id]   Partial update — only known
//                                            columns are accepted; unknown
//                                            keys are silently ignored.

const RCRA_CATEGORIES = ['lqg', 'sqg', 'vsqg'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ id: string }> }

function trimOrNull(value: unknown, max?: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t) return null
  return max && t.length > max ? t.slice(0, max) : t
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim())
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await gate.authedClient
    .from('hazardous_waste_streams')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ stream: data })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = { updated_by: gate.userId }

  if ('name' in body)               patch.name = trimOrNull(body.name, 200)
  if ('generating_process' in body) patch.generating_process = trimOrNull(body.generating_process, 500)
  if ('description' in body)        patch.description = trimOrNull(body.description, 4000)
  if ('determination_basis' in body) patch.determination_basis = trimOrNull(body.determination_basis, 2000)
  if ('notes' in body)              patch.notes = trimOrNull(body.notes, 4000)
  if ('review_due_date' in body)    patch.review_due_date = trimOrNull(body.review_due_date, 30)
  if ('owner_user_id' in body)      patch.owner_user_id = typeof body.owner_user_id === 'string' && body.owner_user_id ? body.owner_user_id : null
  if ('long_haul' in body)          patch.long_haul = body.long_haul === true
  if ('hazards' in body)            patch.hazards = pickStringArray(body.hazards)
  if ('waste_codes' in body)        patch.waste_codes = pickStringArray(body.waste_codes).map(c => c.toUpperCase())

  if ('physical_state' in body) {
    const raw = typeof body.physical_state === 'string' ? body.physical_state : null
    patch.physical_state = raw && (HAZARDOUS_WASTE_PHYSICAL_STATES as readonly string[]).includes(raw) ? raw : null
  }

  if ('generator_category' in body) {
    const raw = typeof body.generator_category === 'string' ? body.generator_category : null
    if (!raw || !(RCRA_CATEGORIES as readonly string[]).includes(raw)) {
      return NextResponse.json({ error: 'Invalid generator_category' }, { status: 400 })
    }
    patch.generator_category = raw
  }

  if ('status' in body) {
    const raw = typeof body.status === 'string' ? body.status : null
    if (!raw || !(HAZARDOUS_WASTE_STREAM_STATUSES as readonly string[]).includes(raw)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    patch.status = raw
    // When archiving, stamp archived_at; when un-archiving, clear it.
    patch.archived_at = raw === 'archived' ? new Date().toISOString() : null
  }

  if ('name' in body && (!patch.name || (patch.name as string).length < 1)) {
    return NextResponse.json({ error: 'name: Name is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin()
    .from('hazardous_waste_streams')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ stream: data })
}
