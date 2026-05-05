import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PATCH /api/admin/tenant-settings/risk
// Updates the active tenant's risk-specific settings keys
// (`risk_band_scheme` + `risk_acceptance_threshold`) inside the
// `tenants.settings` jsonb.
//
// Tenant-admin gate. The admin can only edit the tenant they're
// active on; superadmin would go through /api/superadmin/tenants.

const VALID_BAND_SCHEMES = ['3-band', '4-band'] as const
type BandScheme = typeof VALID_BAND_SCHEMES[number]

interface PatchBody {
  risk_band_scheme?:           unknown
  risk_acceptance_threshold?:  unknown
}

export async function PATCH(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PatchBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}

  if (body.risk_band_scheme !== undefined) {
    if (typeof body.risk_band_scheme !== 'string' || !(VALID_BAND_SCHEMES as readonly string[]).includes(body.risk_band_scheme)) {
      return NextResponse.json({ error: 'risk_band_scheme must be "3-band" or "4-band"' }, { status: 400 })
    }
    update.risk_band_scheme = body.risk_band_scheme as BandScheme
  }

  if (body.risk_acceptance_threshold !== undefined) {
    const v = body.risk_acceptance_threshold
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 25) {
      return NextResponse.json({ error: 'risk_acceptance_threshold must be an integer 1..25' }, { status: 400 })
    }
    update.risk_acceptance_threshold = v
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    // Read-modify-write the settings jsonb. Postgres jsonb has no
    // "merge a couple of keys" primitive that's safer than this from
    // the client side (jsonb_set chains get unwieldy for two keys).
    const { data: tenant, error: readErr } = await admin
      .from('tenants')
      .select('settings')
      .eq('id', gate.tenantId)
      .maybeSingle()
    if (readErr) throw new Error(readErr.message)
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

    const merged = { ...((tenant.settings ?? {}) as Record<string, unknown>), ...update }

    const { data, error } = await admin
      .from('tenants')
      .update({ settings: merged })
      .eq('id', gate.tenantId)
      .select('id, settings')
      .single()
    if (error) throw new Error(error.message)

    return NextResponse.json({ tenant: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'admin/tenant-settings/risk/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
