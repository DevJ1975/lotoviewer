import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { runAudit, type RunAuditScope } from '@/lib/loto/audit/runAudit'

// /api/admin/loto/audit
//   GET  — list audit runs for the active tenant (newest first).
//   POST — start a run. Body: { department?, equipment_ids?, only_active?, limit? }.
//
// The run is kicked in the background (the engine writes progress incrementally
// and is resumable), so the POST returns 202 + run_id immediately. A full
// several-hundred-equipment sweep should be driven by scripts/run-loto-audit.mjs
// — a serverless invocation can be reclaimed mid-run; the script can't.
//
// Owner/admin only: this spends Anthropic tokens against the tenant budget.

export const runtime     = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await supabaseAdmin()
    .from('loto_audit_runs')
    .select('id, status, scope, total_equipment, processed_equipment, review_link_id, started_at, finished_at, error')
    .eq('tenant_id', gate.tenantId)
    .order('started_at', { ascending: false })
    .limit(50)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'admin/loto/audit/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ runs: data ?? [] })
}

interface PostBody {
  department?:    unknown
  equipment_ids?: unknown
  only_active?:   unknown
  limit?:         unknown
  // Continue an existing run instead of creating a new one. The engine skips
  // equipment already at agent_phase='ehs_done', so resuming a serverless run
  // reclaimed mid-sweep is safe and idempotent.
  resume_run_id?: unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody = {}
  try { body = await req.json() } catch { /* empty body = full active sweep */ }
  const admin = supabaseAdmin()

  // ── Resume an existing run ───────────────────────────────────────────────
  if (typeof body.resume_run_id === 'string' && body.resume_run_id) {
    const { data: existing } = await admin
      .from('loto_audit_runs').select('id, scope').eq('id', body.resume_run_id).eq('tenant_id', gate.tenantId).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    await admin.from('loto_audit_runs').update({ status: 'running', error: null, finished_at: null }).eq('id', existing.id)
    void runAudit({ tenantId: gate.tenantId, runId: existing.id, userId: gate.userId, scope: (existing.scope ?? {}) as RunAuditScope })
      .catch(err => Sentry.captureException(err, { tags: { route: 'admin/loto/audit/POST', stage: 'resume' }, extra: { runId: existing.id } }))
    return NextResponse.json({ run_id: existing.id, status: 'running', resumed: true }, { status: 202 })
  }

  const scope: RunAuditScope = {
    department:    typeof body.department === 'string' && body.department.trim() ? body.department.trim() : undefined,
    equipment_ids: Array.isArray(body.equipment_ids)
      ? body.equipment_ids.filter((v): v is string => typeof v === 'string').slice(0, 5000)
      : undefined,
    only_active:   body.only_active === false ? false : true,
    limit:         typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : undefined,
  }

  const { data: run, error } = await admin
    .from('loto_audit_runs')
    .insert({ tenant_id: gate.tenantId, status: 'running', scope, created_by: gate.userId })
    .select('id')
    .single()
  if (error || !run) {
    Sentry.captureException(error, { tags: { route: 'admin/loto/audit/POST' } })
    return NextResponse.json({ error: error?.message ?? 'Failed to create run' }, { status: 500 })
  }

  // Fire-and-forget: the engine persists progress per equipment, so a reclaimed
  // invocation leaves resumable state rather than a corrupt run.
  void runAudit({ tenantId: gate.tenantId, runId: run.id, userId: gate.userId, scope })
    .catch(err => Sentry.captureException(err, { tags: { route: 'admin/loto/audit/POST', stage: 'runAudit' }, extra: { runId: run.id } }))

  return NextResponse.json({ run_id: run.id, status: 'running' }, { status: 202 })
}
