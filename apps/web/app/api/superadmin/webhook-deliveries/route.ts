import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/webhook-deliveries
//   ?days=7&status=ok|fail|pending&event=permit.signed
//   &subscription_id=<uuid>&tenant_number=0042
//
// Lists recent rows from loto_webhook_deliveries with subscription
// + tenant name resolved. Default window is 7 days; max 90.
//
// Status mapping (display layer — DB stores raw status code + error):
//   pending → completed_at IS NULL
//   ok      → response_status BETWEEN 200 AND 299
//   fail    → everything else (incl. error rows + non-2xx responses)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 7
const MAX_DAYS     = 90
const MAX_LIMIT    = 500

export interface WebhookDeliveryRow {
  id:                number
  tenant_id:         string | null
  tenant_name:       string | null
  tenant_number:     string | null
  subscription_id:   string | null
  subscription_name: string | null
  subscription_url:  string
  event:             string
  request_id:        number | null
  response_status:   number | null
  response_body:     string | null
  error:             string | null
  duration_ms:       number | null
  fired_at:          string
  completed_at:      string | null
}

export interface WebhookDeliveriesResponse {
  windowDays: number
  rows:       WebhookDeliveryRow[]
  counts:     { ok: number; fail: number; pending: number }
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const daysRaw = Number(url.searchParams.get('days') ?? DEFAULT_DAYS)
  const days = Number.isFinite(daysRaw) && daysRaw > 0
    ? Math.min(Math.floor(daysRaw), MAX_DAYS)
    : DEFAULT_DAYS
  const status         = url.searchParams.get('status')          || null
  const event          = url.searchParams.get('event')           || null
  const subscriptionId = url.searchParams.get('subscription_id') || null
  const tenantNumber   = url.searchParams.get('tenant_number')   || null
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const admin = supabaseAdmin()

  // tenant_number → tenant_id resolution before the main query so we
  // can filter at the database layer (not in JS).
  let tenantIdFilter: string | null = null
  if (tenantNumber) {
    if (!/^\d{4}$/.test(tenantNumber)) {
      return NextResponse.json({ error: 'tenant_number must be 4 digits' }, { status: 400 })
    }
    const { data: t, error: tErr } = await admin
      .from('tenants')
      .select('id')
      .eq('tenant_number', tenantNumber)
      .maybeSingle()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!t)   return NextResponse.json({ windowDays: days, rows: [], counts: { ok: 0, fail: 0, pending: 0 } })
    tenantIdFilter = t.id as string
  }

  let q = admin
    .from('loto_webhook_deliveries')
    .select('id, tenant_id, subscription_id, subscription_name, subscription_url, event, request_id, response_status, response_body, error, duration_ms, fired_at, completed_at')
    .gte('fired_at', since)
    .order('fired_at', { ascending: false })
    .limit(MAX_LIMIT)
  if (event)          q = q.eq('event', event)
  if (subscriptionId) q = q.eq('subscription_id', subscriptionId)
  if (tenantIdFilter) q = q.eq('tenant_id', tenantIdFilter)

  if (status === 'pending')      q = q.is('completed_at', null)
  else if (status === 'ok')      q = q.gte('response_status', 200).lte('response_status', 299)
  else if (status === 'fail')    q = q.not('completed_at', 'is', null).or('response_status.is.null,response_status.lt.200,response_status.gte.300')

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<Omit<WebhookDeliveryRow, 'tenant_name' | 'tenant_number'>>

  const tenantIds = Array.from(new Set(rows.map(r => r.tenant_id).filter((x): x is string => !!x)))
  const tenantById = new Map<string, { name: string; tenant_number: string }>()
  if (tenantIds.length > 0) {
    const { data: tenants } = await admin
      .from('tenants')
      .select('id, name, tenant_number')
      .in('id', tenantIds)
    for (const t of (tenants ?? []) as Array<{ id: string; name: string; tenant_number: string }>) {
      tenantById.set(t.id, { name: t.name, tenant_number: t.tenant_number })
    }
  }

  const enriched: WebhookDeliveryRow[] = rows.map(r => {
    const meta = r.tenant_id ? tenantById.get(r.tenant_id) : null
    return {
      ...r,
      tenant_name:   meta?.name          ?? null,
      tenant_number: meta?.tenant_number ?? null,
    }
  })

  const counts = { ok: 0, fail: 0, pending: 0 }
  for (const r of enriched) {
    if (r.completed_at == null)                                            counts.pending += 1
    else if (r.response_status != null && r.response_status >= 200 && r.response_status < 300) counts.ok += 1
    else                                                                   counts.fail += 1
  }

  return NextResponse.json({ windowDays: days, rows: enriched, counts } as WebhookDeliveriesResponse)
}
