import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { formatDeviceCredential, newDeviceSecret } from '@/lib/strike/deviceAuth'
import { requireStrikeAdmin } from '@/lib/strike/gate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const MAX_LABEL = 80

const DEVICE_COLUMNS = 'id,name,department,site_label,created_at,last_seen_at,revoked_at'

// Shared tablets for the Soteria STRIKE app. Admin only: an enrolled device
// can record training for any worker on its roster, so who may enroll one is
// who may vouch for that tablet.

export async function GET(req: Request) {
  const gate = await requireStrikeAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await supabaseAdmin()
      .from('strike_devices')
      .select(DEVICE_COLUMNS)
      .eq('tenant_id', gate.tenantId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return NextResponse.json({ devices: data ?? [] })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/devices', method: 'GET' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireStrikeAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const limit = checkMemoryRateLimit(`strike-device-enroll:${gate.tenantId}:${gate.userId}`, 10, 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const department = optionalLabel(body.department)
  const siteLabel = optionalLabel(body.site_label)
  if (name.length < 1 || name.length > MAX_LABEL || department === undefined || siteLabel === undefined) {
    return NextResponse.json({ error: `Give the tablet a name of up to ${MAX_LABEL} characters.` }, { status: 400 })
  }

  try {
    const { secret, hash } = newDeviceSecret()
    const { data, error } = await supabaseAdmin()
      .from('strike_devices')
      .insert({ tenant_id: gate.tenantId, name, department, site_label: siteLabel, secret_hash: hash, enrolled_by: gate.userId })
      .select(DEVICE_COLUMNS)
      .single()
    if (error) throw new Error(error.message)
    // The secret is shown once, here. Only its hash is kept.
    return NextResponse.json({ device: data, credential: formatDeviceCredential(data.id as string, secret) }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/devices', method: 'POST' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

/** A trimmed label, null when blank or absent, undefined when present but unusable. */
function optionalLabel(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return null
  return trimmed.length <= MAX_LABEL ? trimmed : undefined
}
