import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { HazardousWasteAreaType } from '@soteria/core/hazardousWaste'

// /api/hazardous-waste/areas/[id]
//   PATCH  — rename, retype, retune cadence, or archive (set
//            archived_at = now()). Tenant admin/owner only.
//   DELETE — hard delete an area. Cascades to its inspections via the
//            FK in migration 142. Tenant admin/owner only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const AREA_TYPES: ReadonlyArray<HazardousWasteAreaType> = [
  'satellite_accumulation',
  'central_accumulation',
  'universal_waste',
  'used_oil',
  'inspection_only',
]

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = { updated_by: gate.userId }

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name || name.length > 120) {
      return NextResponse.json({ error: 'name must be 1-120 characters' }, { status: 400 })
    }
    patch.name = name
  }
  if (typeof body.area_type === 'string') {
    if (!(AREA_TYPES as readonly string[]).includes(body.area_type)) {
      return NextResponse.json({ error: `area_type must be one of ${AREA_TYPES.join(', ')}` }, { status: 400 })
    }
    patch.area_type = body.area_type
  }
  if (body.weekly_cadence_days !== undefined) {
    const n = typeof body.weekly_cadence_days === 'number'
      ? body.weekly_cadence_days
      : Number.parseInt(String(body.weekly_cadence_days), 10)
    if (!Number.isFinite(n) || n < 1 || n > 90) {
      return NextResponse.json({ error: 'weekly_cadence_days must be 1-90' }, { status: 400 })
    }
    patch.weekly_cadence_days = n
  }
  if (body.location_notes !== undefined) {
    patch.location_notes = typeof body.location_notes === 'string' && body.location_notes.trim()
      ? body.location_notes.trim()
      : null
  }
  if (body.archived === true) patch.archived_at = new Date().toISOString()
  if (body.archived === false) patch.archived_at = null

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'No supported fields supplied' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('hazardous_waste_areas')
      .update(patch)
      .eq('tenant_id', gate.tenantId)
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An area with that name already exists' }, { status: 409 })
      }
      Sentry.captureException(error, { tags: { route: 'hazardous-waste/areas/PATCH' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Area not found' }, { status: 404 })
    return NextResponse.json({ area: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/areas/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('hazardous_waste_areas')
      .delete()
      .eq('tenant_id', gate.tenantId)
      .eq('id', id)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'hazardous-waste/areas/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'hazardous-waste/areas/DELETE' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
