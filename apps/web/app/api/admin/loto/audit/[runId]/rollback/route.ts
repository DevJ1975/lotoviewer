import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { regenerateAndUploadPlacard } from '@/lib/loto/regeneratePlacard'

// POST /api/admin/loto/audit/[runId]/rollback  body: { snapshot_id }
//
// Emergency last resort. Restores the equipment + steps captured in the named
// snapshot, then rebuilds the affected placards from the restored data. Owner/
// admin only; the UI gates this behind a typed confirmation.

export const runtime     = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { runId } = await ctx.params

  let body: { snapshot_id?: unknown } = {}
  try { body = await req.json() } catch { /* validated below */ }
  const snapshotId = typeof body.snapshot_id === 'string' ? body.snapshot_id : ''
  if (!snapshotId) return NextResponse.json({ error: 'snapshot_id required' }, { status: 400 })

  const admin = supabaseAdmin()
  // Confirm the snapshot belongs to this run + tenant before restoring.
  const { data: snapshot } = await admin
    .from('loto_audit_snapshots')
    .select('id')
    .eq('id', snapshotId).eq('run_id', runId).eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (!snapshot) return NextResponse.json({ error: 'Snapshot not found for this run' }, { status: 404 })

  const { data: result, error: restoreErr } = await admin.rpc('restore_audit_snapshot', {
    p_snapshot_id: snapshotId, p_restored_by: gate.userId,
  })
  if (restoreErr) {
    Sentry.captureException(restoreErr, { tags: { route: 'admin/loto/audit/rollback', stage: 'restore' } })
    return NextResponse.json({ error: `Rollback failed: ${restoreErr.message}` }, { status: 500 })
  }

  // Rebuild placards for every equipment in the snapshot (restore nulled their
  // placard_url). Best-effort per equipment.
  const { data: snapEquipment } = await admin
    .from('loto_audit_snapshot_equipment')
    .select('equipment_id')
    .eq('snapshot_id', snapshotId)
  const regen = { ok: 0, failed: 0 }
  for (const row of (snapEquipment ?? []) as { equipment_id: string }[]) {
    try {
      await regenerateAndUploadPlacard(admin, gate.tenantId, row.equipment_id)
      regen.ok += 1
    } catch (err) {
      regen.failed += 1
      Sentry.captureException(err, { tags: { route: 'admin/loto/audit/rollback', stage: 'regen' }, extra: { equipmentId: row.equipment_id } })
    }
  }

  return NextResponse.json({ restored: result, placards_regenerated: regen })
}
