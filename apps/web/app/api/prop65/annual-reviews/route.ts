import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/prop65/annual-reviews — record (or sign) the yearly
// §25249.5 program review. Idempotent on (tenant, year): if a row
// already exists and is unsigned, the body updates it; if it's
// signed we 409 to prevent overwriting the artifact.

interface PostBody {
  review_year?:         unknown
  deviations?:          unknown
  corrective_actions?:  unknown
  signed?:              unknown
  signed_name?:         unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const year       = typeof body.review_year === 'number' ? body.review_year : null
  const deviations = typeof body.deviations === 'string' ? body.deviations : null
  const actions    = typeof body.corrective_actions === 'string' ? body.corrective_actions : null
  const signed     = body.signed === true
  const signedName = typeof body.signed_name === 'string' ? body.signed_name.trim() : ''

  if (!year || !Number.isInteger(year) || year < 2000 || year > 2100)
    return NextResponse.json({ error: 'review_year must be an integer in 2000..2100' }, { status: 400 })
  if (signed && !signedName)
    return NextResponse.json({ error: 'signed_name required when signed=true' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('prop65_annual_reviews')
      .select('id, signed')
      .eq('tenant_id', gate.tenantId)
      .eq('review_year', year)
      .maybeSingle()

    if (existing?.signed)
      return NextResponse.json({ error: 'Review already signed for this year' }, { status: 409 })

    const payload: Record<string, unknown> = {
      tenant_id:         gate.tenantId,
      review_year:       year,
      reviewer_user_id:  gate.userId,
      reviewed_at:       new Date().toISOString(),
      deviations,
      corrective_actions: actions,
    }
    if (signed) {
      payload.signed = true
      payload.signed_name = signedName
      payload.signed_at = new Date().toISOString()
    }

    let data, error
    if (existing) {
      ({ data, error } = await admin
        .from('prop65_annual_reviews')
        .update(payload)
        .eq('id', existing.id)
        .eq('tenant_id', gate.tenantId)
        .select('*')
        .single())
    } else {
      ({ data, error } = await admin
        .from('prop65_annual_reviews')
        .insert(payload)
        .select('*')
        .single())
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ review: data }, { status: existing ? 200 : 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
