import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/admin/loto/audit/[runId] — run header, per-equipment results, and
// change-set counts by status + severity. Owner/admin only, tenant-scoped.

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { runId } = await ctx.params

  const admin = supabaseAdmin()
  const { data: run, error: runErr } = await admin
    .from('loto_audit_runs')
    .select('*')
    .eq('id', runId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (runErr) {
    Sentry.captureException(runErr, { tags: { route: 'admin/loto/audit/[runId]/GET' } })
    return NextResponse.json({ error: runErr.message }, { status: 500 })
  }
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const [{ data: results }, { data: changes }, { data: snapshots }] = await Promise.all([
    admin.from('loto_audit_equipment_results')
      .select('equipment_id, equip_photo_verdict, iso_photo_verdict, ds_equipment_confidence, ehs_pass, agent_phase')
      .eq('run_id', runId).eq('tenant_id', gate.tenantId)
      .order('equipment_id', { ascending: true }),
    admin.from('loto_audit_changes')
      .select('status, severity')
      .eq('run_id', runId).eq('tenant_id', gate.tenantId),
    admin.from('loto_audit_snapshots')
      .select('id, reason, captured_at, equipment_count, step_count')
      .eq('run_id', runId).eq('tenant_id', gate.tenantId)
      .order('captured_at', { ascending: false }),
  ])

  const byStatus: Record<string, number> = {}
  const bySeverity: Record<string, number> = {}
  for (const c of (changes ?? []) as { status: string; severity: string | null }[]) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
    if (c.severity) bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1
  }

  return NextResponse.json({
    run,
    results: results ?? [],
    snapshots: snapshots ?? [],
    change_counts: { by_status: byStatus, by_severity: bySeverity, total: (changes ?? []).length },
  })
}
