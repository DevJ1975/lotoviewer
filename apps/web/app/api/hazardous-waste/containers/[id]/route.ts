import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  HAZARDOUS_WASTE_CONTAINER_STATUSES,
  HAZARDOUS_WASTE_VOLUME_UNITS,
} from '@soteria/core/hazardousWaste'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ id: string }> }

function trimOrNull(value: unknown, max?: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t) return null
  return max && t.length > max ? t.slice(0, max) : t
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await gate.authedClient
    .from('hazardous_waste_containers')
    .select('*, stream:stream_id (id, name, generator_category, long_haul, waste_codes)')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ container: data })
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

  if ('label' in body)                  patch.label = trimOrNull(body.label, 120)
  if ('area_location' in body)          patch.area_location = trimOrNull(body.area_location, 200)
  if ('accumulation_started_at' in body) patch.accumulation_started_at = trimOrNull(body.accumulation_started_at)
  if ('notes' in body)                  patch.notes = trimOrNull(body.notes, 2000)

  if ('volume_quantity' in body) {
    const v = body.volume_quantity
    patch.volume_quantity = typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim()
        ? Number(v)
        : null
  }
  if ('volume_unit' in body) {
    const raw = typeof body.volume_unit === 'string' ? body.volume_unit : null
    patch.volume_unit = raw && (HAZARDOUS_WASTE_VOLUME_UNITS as readonly string[]).includes(raw) ? raw : null
  }
  if ('status' in body) {
    const raw = typeof body.status === 'string' ? body.status : null
    if (!raw || !(HAZARDOUS_WASTE_CONTAINER_STATUSES as readonly string[]).includes(raw)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    patch.status = raw
    patch.archived_at = raw === 'disposed' ? new Date().toISOString() : null
  }

  if ('label' in body && (!patch.label || (patch.label as string).length < 1)) {
    return NextResponse.json({ error: 'label: Label is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin()
    .from('hazardous_waste_containers')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*, stream:stream_id (id, name, generator_category, long_haul, waste_codes)')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ container: data })
}
