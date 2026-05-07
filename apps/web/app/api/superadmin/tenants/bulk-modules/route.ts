import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getFeature } from '@soteria/core/features'

// POST /api/superadmin/tenants/bulk-modules
//   { tenant_ids: string[], module_id: string, enabled: boolean }
//
// Toggle one module's flag across many tenants in a single round-trip.
// Use case: rolling out a new module — flip it on across the 5 paying
// tenants without clicking through 5 edit forms.
//
// Each tenant's modules JSONB is patched individually (the pg jsonb
// concat operator merges keys), so existing settings + other module
// flags stay intact.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { tenant_ids?: unknown; module_id?: unknown; enabled?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const tenantIds = Array.isArray(body.tenant_ids) ? body.tenant_ids.filter((x): x is string => typeof x === 'string') : []
  const moduleId  = typeof body.module_id === 'string' ? body.module_id : ''
  const enabled   = body.enabled === true

  if (tenantIds.length === 0) return NextResponse.json({ error: 'tenant_ids: at least one required' }, { status: 400 })
  if (tenantIds.length > 100)  return NextResponse.json({ error: 'tenant_ids: max 100 per call' }, { status: 400 })
  if (!getFeature(moduleId)) {
    return NextResponse.json({ error: `Unknown module_id: ${moduleId}` }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Fetch current modules JSON for each tenant — needed because we
  // merge instead of replacing. Single round-trip for all of them.
  const { data: rows, error: readErr } = await admin
    .from('tenants')
    .select('id, modules')
    .in('id', tenantIds)
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

  // Update each tenant. Could be a single Postgres function but
  // doing it per-row in JS keeps the audit trail clean (one
  // audit_log entry per tenant) and the round-trip count is small
  // (≤ 100 by validation above).
  type BulkResult = { ok: boolean; tenantId: string; error?: string }
  const updates: Array<Promise<BulkResult>> = []
  for (const r of (rows ?? []) as Array<{ id: string; modules: Record<string, boolean> | null }>) {
    const merged = { ...(r.modules ?? {}), [moduleId]: enabled }
    updates.push(
      Promise.resolve(
        admin.from('tenants').update({ modules: merged }).eq('id', r.id),
      ).then((res): BulkResult => res.error
        ? { ok: false, tenantId: r.id, error: res.error.message }
        : { ok: true,  tenantId: r.id }),
    )
  }
  const results = await Promise.all(updates)

  const ok = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)

  return NextResponse.json({
    requested: tenantIds.length,
    updated:   ok,
    failed:    failed.map(f => ({ tenant_id: f.tenantId, error: f.error })),
    module_id: moduleId,
    enabled,
  })
}
