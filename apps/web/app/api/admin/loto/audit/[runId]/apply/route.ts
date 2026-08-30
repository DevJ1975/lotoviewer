import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { regenerateAndUploadPlacard } from '@/lib/loto/regeneratePlacard'

// POST /api/admin/loto/audit/[runId]/apply — apply the APPROVED changes.
//
// Order is the safety contract:
//   1. capture_audit_snapshot  — the rollback save point, BEFORE any mutation.
//   2. apply_approved_audit_changes — applies only status='approved' rows.
//   3. regenerate placards for equipment whose printed content changed.
//
// Owner/admin only. This is the ONLY in-app path that writes audit fixes to the
// live LOTO tables, and it only touches rows a reviewer approved via the link.

export const runtime     = 'nodejs'
export const maxDuration = 300

// Applied changes of these kinds alter the printed placard and need a re-render.
// procedure_draft replaces the machine's entire step set — every printed line.
const PLACARD_AFFECTING = new Set(['placeholder_photo', 'equipment_field_edit', 'step_field_edit', 'procedure_draft'])

// Only a run whose change-set has been through human review may be applied.
// partially_applied is re-eligible so an errored apply can be retried.
const APPLY_ELIGIBLE = new Set(['awaiting_review', 'partially_applied'])

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { runId } = await ctx.params

  const admin = supabaseAdmin()
  const { data: run } = await admin
    .from('loto_audit_runs').select('id, status').eq('id', runId).eq('tenant_id', gate.tenantId).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  // Server-side review gate: an unreviewed run must never reach the snapshot or
  // apply RPCs, no matter what a client button allowed. The apply RPC itself
  // additionally proves the reviewer sign-off (migration 222).
  if (!APPLY_ELIGIBLE.has(run.status as string)) {
    return NextResponse.json(
      { error: `Run is '${run.status}' — only a reviewed run (awaiting_review / partially_applied) can be applied` },
      { status: 409 },
    )
  }

  // 1. Snapshot FIRST (rollback save point). If this fails, apply nothing.
  const { data: snapshotId, error: snapErr } = await admin.rpc('capture_audit_snapshot', {
    p_run_id: runId, p_captured_by: gate.userId, p_reason: 'pre_apply',
  })
  if (snapErr) {
    Sentry.captureException(snapErr, { tags: { route: 'admin/loto/audit/apply', stage: 'snapshot' } })
    return NextResponse.json({ error: `Snapshot failed: ${snapErr.message}` }, { status: 500 })
  }

  // 2. Apply approved changes only (idempotent, per-change error-isolated).
  const { data: appliedCount, error: applyErr } = await admin.rpc('apply_approved_audit_changes', {
    p_run_id: runId, p_applied_by: gate.userId,
  })
  if (applyErr) {
    Sentry.captureException(applyErr, { tags: { route: 'admin/loto/audit/apply', stage: 'apply' } })
    return NextResponse.json({ error: `Apply failed: ${applyErr.message}` }, { status: 500 })
  }

  // 3. Regenerate placards for equipment whose printed content changed.
  const { data: appliedChanges } = await admin
    .from('loto_audit_changes')
    .select('equipment_id, change_kind')
    .eq('run_id', runId).eq('tenant_id', gate.tenantId).eq('status', 'applied')
  const affected = [...new Set(
    (appliedChanges ?? [])
      .filter((c: { change_kind: string }) => PLACARD_AFFECTING.has(c.change_kind))
      .map((c: { equipment_id: string }) => c.equipment_id),
  )]

  const regen = { ok: 0, failed: 0 }
  for (const equipmentId of affected) {
    try {
      await regenerateAndUploadPlacard(admin, gate.tenantId, equipmentId)
      regen.ok += 1
    } catch (err) {
      regen.failed += 1
      Sentry.captureException(err, { tags: { route: 'admin/loto/audit/apply', stage: 'regen' }, extra: { equipmentId } })
    }
  }

  return NextResponse.json({
    applied: typeof appliedCount === 'number' ? appliedCount : 0,
    snapshot_id: snapshotId,
    placards_regenerated: regen,
  })
}
