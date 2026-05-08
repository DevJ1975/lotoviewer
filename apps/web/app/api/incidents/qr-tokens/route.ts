import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { writeQrTokenAudit, type QrAuditEvent } from '@/lib/anonReport/audit'

// GET    /api/incidents/qr-tokens         List (any tenant member)
// POST   /api/incidents/qr-tokens         Create (admin)
// PATCH  /api/incidents/qr-tokens?id=     Update / toggle / configure (admin)
// DELETE /api/incidents/qr-tokens?id=     Owner only — destroys posted-sign target
//
// Phase 3+4 additions:
//   - PATCH accepts default_assigned_investigator, auto_route_enabled,
//     require_captcha, site_geo_lat/lng, geofence_radius_m.
//   - Every successful mutation writes an entry to qr_token_audit_log.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const COLS = [
  'id', 'tenant_id', 'label', 'token',
  'rate_limit_per_hour', 'enabled',
  'total_reports', 'last_used_at',
  'created_at', 'updated_at', 'created_by', 'updated_by',
  'default_assigned_investigator', 'auto_route_enabled',
  'require_captcha',
  'site_geo_lat', 'site_geo_lng', 'geofence_radius_m',
].join(', ')

interface PostBody {
  label:                          string
  rate_limit_per_hour?:           number
  default_assigned_investigator?: string | null
  auto_route_enabled?:            boolean
  require_captcha?:               boolean
  site_geo_lat?:                  number | null
  site_geo_lng?:                  number | null
  geofence_radius_m?:             number | null
}

interface PatchBody {
  label?:                          string
  enabled?:                        boolean
  rate_limit_per_hour?:            number | null
  default_assigned_investigator?:  string | null
  auto_route_enabled?:             boolean
  require_captcha?:                boolean
  site_geo_lat?:                   number | null
  site_geo_lng?:                   number | null
  geofence_radius_m?:              number | null
  context?:                        string | null
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('incident_anon_intake_tokens')
      .select(COLS)
      .eq('tenant_id', gate.tenantId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return NextResponse.json({ tokens: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'qr-tokens/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = (await req.json()) as PostBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.label || !body.label.trim()) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }
  const rateErr = validateRate(body.rate_limit_per_hour)
  if (rateErr) return NextResponse.json({ error: rateErr }, { status: 400 })
  const geoErr = validateGeo(body.site_geo_lat, body.site_geo_lng, body.geofence_radius_m)
  if (geoErr) return NextResponse.json({ error: geoErr }, { status: 400 })

  // 32 bytes of randomness → 64 hex chars. Same shape as the
  // witness-statement token so /report and /witness can share
  // validation regex.
  const token = randomBytes(32).toString('hex')

  try {
    const admin = supabaseAdmin()
    const insertRow: Record<string, unknown> = {
      tenant_id:                     gate.tenantId,
      label:                         body.label.trim(),
      token,
      rate_limit_per_hour:           body.rate_limit_per_hour ?? null,
      created_by:                    gate.userId,
      updated_by:                    gate.userId,
      default_assigned_investigator: body.default_assigned_investigator ?? null,
      auto_route_enabled:            body.auto_route_enabled ?? true,
      require_captcha:               body.require_captcha ?? false,
      site_geo_lat:                  body.site_geo_lat ?? null,
      site_geo_lng:                  body.site_geo_lng ?? null,
      geofence_radius_m:             body.geofence_radius_m ?? null,
    }
    const { data, error } = await admin
      .from('incident_anon_intake_tokens')
      .insert(insertRow)
      .select(COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'qr-tokens/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const created = data as unknown as { id: string }
    void writeQrTokenAudit(admin, {
      tenant_id:   gate.tenantId,
      token_id:    created.id,
      event_type:  'create',
      after_row:   data as unknown as Record<string, unknown>,
      actor_id:    gate.userId,
      actor_email: gate.userEmail,
    })
    return NextResponse.json({ qr_token: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'qr-tokens/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: '?id= is required' }, { status: 400 })

  let body: PatchBody
  try { body = (await req.json()) as PatchBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const rateErr = validateRate(body.rate_limit_per_hour)
  if (rateErr) return NextResponse.json({ error: rateErr }, { status: 400 })
  const geoErr = validateGeo(body.site_geo_lat, body.site_geo_lng, body.geofence_radius_m)
  if (geoErr) return NextResponse.json({ error: geoErr }, { status: 400 })

  const update: Record<string, unknown> = { updated_by: gate.userId }
  if (typeof body.label === 'string')   update.label   = body.label.trim() || null
  if (typeof body.enabled === 'boolean') update.enabled = body.enabled
  if ('rate_limit_per_hour' in body)            update.rate_limit_per_hour            = body.rate_limit_per_hour
  if ('default_assigned_investigator' in body)  update.default_assigned_investigator  = body.default_assigned_investigator ?? null
  if (typeof body.auto_route_enabled === 'boolean') update.auto_route_enabled = body.auto_route_enabled
  if (typeof body.require_captcha === 'boolean')    update.require_captcha    = body.require_captcha
  if ('site_geo_lat' in body)        update.site_geo_lat        = body.site_geo_lat
  if ('site_geo_lng' in body)        update.site_geo_lng        = body.site_geo_lng
  if ('geofence_radius_m' in body)   update.geofence_radius_m   = body.geofence_radius_m

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    // Fetch the prior row for the audit log's before-snapshot. If
    // it's missing we'll let the update fail naturally.
    const { data: before } = await admin
      .from('incident_anon_intake_tokens')
      .select(COLS)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()

    const { data, error } = await admin
      .from('incident_anon_intake_tokens')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select(COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'qr-tokens/PATCH' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    void writeQrTokenAudit(admin, {
      tenant_id:   gate.tenantId,
      token_id:    id,
      event_type:  inferEventType(body),
      before_row:  before as unknown as Record<string, unknown> | null,
      after_row:   data as unknown as Record<string, unknown>,
      actor_id:    gate.userId,
      actor_email: gate.userEmail,
      context:     body.context ?? null,
    })

    return NextResponse.json({ qr_token: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'qr-tokens/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  if (gate.role !== 'owner' && gate.role !== 'superadmin') {
    return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  }
  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: '?id= is required' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: before } = await admin
      .from('incident_anon_intake_tokens')
      .select(COLS)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()

    const { error } = await admin
      .from('incident_anon_intake_tokens')
      .delete()
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'qr-tokens/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    void writeQrTokenAudit(admin, {
      tenant_id:   gate.tenantId,
      token_id:    id,
      event_type:  'delete',
      before_row:  before as unknown as Record<string, unknown> | null,
      actor_id:    gate.userId,
      actor_email: gate.userEmail,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'qr-tokens/DELETE' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function validateRate(v: number | null | undefined): string | null {
  if (v == null) return null
  if (!Number.isInteger(v) || v <= 0) {
    return 'rate_limit_per_hour must be a positive integer'
  }
  return null
}

function validateGeo(
  lat: number | null | undefined,
  lng: number | null | undefined,
  radius: number | null | undefined,
): string | null {
  if (lat == null && lng == null && radius == null) return null
  if (lat != null && (lat < -90 || lat > 90))    return 'site_geo_lat out of range'
  if (lng != null && (lng < -180 || lng > 180))  return 'site_geo_lng out of range'
  // The DB constraint enforces (lat null) = (lng null); mirror that here
  // so the API returns a clearer message than the Postgres error string.
  if ((lat == null) !== (lng == null)) return 'site_geo_lat and site_geo_lng must both be set or both null'
  if (radius != null && (radius < 50 || radius > 50_000)) {
    return 'geofence_radius_m must be between 50 and 50000'
  }
  return null
}

// Pick the most descriptive audit event name based on which fields
// the patch touched. If a patch combines multiple concerns we fall
// back to 'update' rather than logging multiple events.
function inferEventType(b: PatchBody): QrAuditEvent {
  if (typeof b.enabled === 'boolean' && Object.keys(b).length === 1) {
    return b.enabled ? 'enable' : 'disable'
  }
  if (b.site_geo_lat !== undefined || b.site_geo_lng !== undefined || b.geofence_radius_m !== undefined) {
    return 'config_geofence'
  }
  if (b.require_captcha !== undefined) return 'config_captcha'
  return 'update'
}
