import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/prop65/sites — create a CA facility row.
// public_slug is auto-assigned by the BEFORE INSERT trigger (migration 172).

interface PostBody {
  name?:            unknown
  address?:         unknown
  city?:            unknown
  employee_count?:  unknown
  public_slug?:     unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const address = typeof body.address === 'string' ? body.address : null
  const city = typeof body.city === 'string' ? body.city : null
  const employeeCount = typeof body.employee_count === 'number' ? body.employee_count : null
  const explicitSlug  = typeof body.public_slug === 'string' && body.public_slug.trim()
    ? body.public_slug.trim().toLowerCase() : null

  if (!name)
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (employeeCount !== null && (!Number.isInteger(employeeCount) || employeeCount < 0))
    return NextResponse.json({ error: 'employee_count must be a non-negative integer' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    // public_slug=null lets the BEFORE INSERT trigger
    // (prop65_sites_assign_slug) compute a unique slug from the name.
    // CHECK + NOT NULL fire AFTER the trigger so this path is valid.
    const insert: Record<string, unknown> = {
      tenant_id:       gate.tenantId,
      name,
      address,
      city,
      state:           'CA',
      employee_count:  employeeCount,
    }
    if (explicitSlug) insert.public_slug = explicitSlug
    const { data, error } = await admin
      .from('prop65_sites')
      .insert(insert)
      .select('id, tenant_id, name, address, city, state, employee_count, public_slug, created_at, updated_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ site: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
