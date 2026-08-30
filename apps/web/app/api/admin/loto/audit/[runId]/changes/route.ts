import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/admin/loto/audit/[runId]/changes — the staged change-set, optionally
// filtered by ?status= or ?equipment_id=. Owner/admin only, tenant-scoped.

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { runId } = await ctx.params

  const url    = new URL(req.url)
  const status = url.searchParams.get('status')?.trim()
  const equip  = url.searchParams.get('equipment_id')?.trim()

  let q = supabaseAdmin()
    .from('loto_audit_changes')
    .select('*')
    .eq('run_id', runId)
    .eq('tenant_id', gate.tenantId)
    .order('equipment_id', { ascending: true })
    .order('created_at', { ascending: true })
  if (status) q = q.eq('status', status)
  if (equip)  q = q.eq('equipment_id', equip)

  const { data, error } = await q
  if (error) {
    Sentry.captureException(error, { tags: { route: 'admin/loto/audit/[runId]/changes/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ changes: data ?? [] })
}
