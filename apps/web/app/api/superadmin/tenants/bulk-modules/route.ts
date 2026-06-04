import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { validateJsonBody } from '@/lib/security/validateBody'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getFeature } from '@soteria/core/features'

// Schema enforces what the hand-rolled checks did + adds tightenings:
//   - every tenant_id is a UUID (prior code took any string)
//   - tenant_ids min 1 / max 100 enforced in one place
const BulkModulesSchema = z.object({
  tenant_ids: z.array(z.string().uuid()).min(1).max(100),
  module_id:  z.string().trim().min(1),
  enabled:    z.boolean(),
})

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

  const parsed = await validateJsonBody(req, BulkModulesSchema)
  if (!parsed.ok) return parsed.response
  const { tenant_ids: tenantIds, module_id: moduleId, enabled } = parsed.data

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
