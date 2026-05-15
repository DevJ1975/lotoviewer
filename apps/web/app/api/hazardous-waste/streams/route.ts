import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  HAZARDOUS_WASTE_PHYSICAL_STATES,
  HAZARDOUS_WASTE_STREAM_STATUSES,
  validateHazardousWasteStreamInput,
  type HazardousWasteStreamInput,
} from '@soteria/core/hazardousWaste'

// GET  /api/hazardous-waste/streams        List the tenant's waste streams.
// POST /api/hazardous-waste/streams        Create a waste-stream master row.

const RCRA_CATEGORIES = ['lqg', 'sqg', 'vsqg'] as const

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim())
}

function trimOrNull(value: unknown, max?: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t) return null
  return max && t.length > max ? t.slice(0, max) : t
}

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status')?.trim() ?? ''
  const includeArchived = url.searchParams.get('include_archived') === 'true'

  try {
    let q = gate.authedClient
      .from('hazardous_waste_streams')
      .select('*', { count: 'exact' })
      .eq('tenant_id', gate.tenantId)

    if (!includeArchived) q = q.is('archived_at', null)
    if (statusFilter && (HAZARDOUS_WASTE_STREAM_STATUSES as readonly string[]).includes(statusFilter)) {
      q = q.eq('status', statusFilter)
    }
    q = q.order('updated_at', { ascending: false })

    const { data, count, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ streams: data ?? [], total: count ?? 0 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const generator_category_raw = typeof body.generator_category === 'string' ? body.generator_category : 'lqg'
  const generator_category = (RCRA_CATEGORIES as readonly string[]).includes(generator_category_raw)
    ? (generator_category_raw as typeof RCRA_CATEGORIES[number])
    : 'lqg'

  const physical_state_raw = typeof body.physical_state === 'string' ? body.physical_state : null
  const physical_state = physical_state_raw && (HAZARDOUS_WASTE_PHYSICAL_STATES as readonly string[]).includes(physical_state_raw)
    ? (physical_state_raw as typeof HAZARDOUS_WASTE_PHYSICAL_STATES[number])
    : null

  const status_raw = typeof body.status === 'string' ? body.status : 'draft'
  const status = (HAZARDOUS_WASTE_STREAM_STATUSES as readonly string[]).includes(status_raw)
    ? (status_raw as typeof HAZARDOUS_WASTE_STREAM_STATUSES[number])
    : 'draft'

  const input: HazardousWasteStreamInput = {
    name:                trimOrNull(body.name, 200) ?? '',
    generating_process:  trimOrNull(body.generating_process, 500),
    description:         trimOrNull(body.description, 4000),
    physical_state,
    hazards:             pickStringArray(body.hazards),
    waste_codes:         pickStringArray(body.waste_codes).map(c => c.toUpperCase()),
    generator_category,
    long_haul:           body.long_haul === true,
    determination_basis: trimOrNull(body.determination_basis, 2000),
    status,
    owner_user_id:       typeof body.owner_user_id === 'string' && body.owner_user_id ? body.owner_user_id : null,
    review_due_date:     trimOrNull(body.review_due_date, 30),
    notes:               trimOrNull(body.notes, 4000),
  }

  const errors = validateHazardousWasteStreamInput(input)
  if (errors.length > 0) {
    return NextResponse.json({
      error: errors.map(e => `${e.field}: ${e.message}`).join('; '),
    }, { status: 400 })
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from('hazardous_waste_streams')
      .insert({
        tenant_id:  gate.tenantId,
        created_by: gate.userId,
        updated_by: gate.userId,
        ...input,
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ stream: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
